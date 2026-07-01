import { withOAuth2Retry, sendViaOAuth2, type OAuth2Credentials } from '../auth/oauth2.js';
import { fetchGoogleContacts } from './google-contacts.js';
import { truncateSnippet, truncateBody } from './normalize.js';
import type { MailProvider, Folder, Page, EmailSummary, EmailDetail, OutboundMessage, Contact } from './provider.js';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

class GmailApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

function classifyHttpError(err: unknown): 'auth' | 'transient' | 'fatal' {
  if (err instanceof GmailApiError) {
    if (err.status === 401) return 'auth';
    if (err.status === 429 || err.status >= 500) return 'transient';
  }
  return 'fatal';
}

async function gmailFetch(accessToken: string, url: URL): Promise<unknown> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    throw new GmailApiError(`Gmail API request failed: ${await response.text()}`, response.status);
  }
  return response.json();
}

interface GmailListResponse {
  messages?: Array<{ id: string }>;
  nextPageToken?: string;
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  snippet?: string;
  labelIds?: string[];
  payload?: GmailPart;
}

function headerValue(headers: GmailHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function splitAddresses(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function hasAttachmentParts(part: GmailPart | undefined): boolean {
  if (!part) return false;
  if (part.filename && part.body?.attachmentId) return true;
  return (part.parts ?? []).some(hasAttachmentParts);
}

function walkBodyParts(
  part: GmailPart | undefined,
  acc: { textParts: string[]; htmlParts: string[]; attachments: EmailDetail['attachments'] },
): void {
  if (!part) return;
  const mimeType = part.mimeType ?? '';
  if (part.filename && part.body?.attachmentId) {
    acc.attachments.push({ name: part.filename, sizeBytes: part.body.size ?? 0, mimeType: mimeType || 'application/octet-stream' });
  } else if (mimeType === 'text/plain' && part.body?.data) {
    acc.textParts.push(Buffer.from(part.body.data, 'base64url').toString('utf8'));
  } else if (mimeType === 'text/html' && part.body?.data) {
    acc.htmlParts.push(Buffer.from(part.body.data, 'base64url').toString('utf8'));
  }
  for (const child of part.parts ?? []) {
    walkBodyParts(child, acc);
  }
}

function folderLabelIds(folder: Folder): string[] {
  if (folder === 'inbox') return ['INBOX'];
  if (folder === 'sent') return ['SENT'];
  return [];
}

export class GmailApiProvider implements MailProvider {
  constructor(
    private credentials: OAuth2Credentials,
    private fromEmail: string,
  ) {}

  send(message: OutboundMessage): Promise<{ messageId: string }> {
    return sendViaOAuth2(this.credentials, this.fromEmail, message);
  }

  private async listMessageIds(
    folder: Folder,
    limit: number,
    pageToken: string | undefined,
    query?: string,
  ): Promise<{ ids: string[]; nextPageToken?: string }> {
    return withOAuth2Retry(
      this.credentials,
      async (accessToken) => {
        const url = new URL(`${GMAIL_API_BASE}/messages`);
        url.searchParams.set('maxResults', String(limit));
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        for (const labelId of folderLabelIds(folder)) {
          url.searchParams.append('labelIds', labelId);
        }
        if (query) url.searchParams.set('q', query);

        const data = (await gmailFetch(accessToken, url)) as GmailListResponse;
        return { ids: (data.messages ?? []).map((m) => m.id), nextPageToken: data.nextPageToken };
      },
      classifyHttpError,
    );
  }

  private async getMessage(id: string, format: 'metadata' | 'full'): Promise<GmailMessage> {
    return withOAuth2Retry(
      this.credentials,
      async (accessToken) => {
        const url = new URL(`${GMAIL_API_BASE}/messages/${id}`);
        url.searchParams.set('format', format);
        if (format === 'metadata') {
          for (const header of ['From', 'To', 'Cc', 'Subject', 'Date']) {
            url.searchParams.append('metadataHeaders', header);
          }
        }
        return (await gmailFetch(accessToken, url)) as GmailMessage;
      },
      classifyHttpError,
    );
  }

  private toSummary(message: GmailMessage): EmailSummary {
    const headers = message.payload?.headers;
    return {
      id: message.id,
      from: headerValue(headers, 'From'),
      to: splitAddresses(headerValue(headers, 'To')),
      subject: headerValue(headers, 'Subject'),
      snippet: truncateSnippet(message.snippet ?? ''),
      date: headerValue(headers, 'Date'),
      hasAttachments: hasAttachmentParts(message.payload),
      isUnread: (message.labelIds ?? []).includes('UNREAD'),
    };
  }

  private async listOrSearch(opts: { folder: Folder; limit: number; pageToken?: string; query?: string }): Promise<Page<EmailSummary>> {
    const { ids, nextPageToken } = await this.listMessageIds(opts.folder, opts.limit, opts.pageToken, opts.query);
    const items = await Promise.all(ids.map((id) => this.getMessage(id, 'metadata').then((m) => this.toSummary(m))));
    return { items, nextPageToken };
  }

  list(opts: { folder: Folder; limit: number; pageToken?: string }): Promise<Page<EmailSummary>> {
    return this.listOrSearch(opts);
  }

  search(opts: { query: string; folder: Folder; limit: number; pageToken?: string }): Promise<Page<EmailSummary>> {
    return this.listOrSearch(opts);
  }

  async read(id: string): Promise<EmailDetail> {
    const message = await this.getMessage(id, 'full');
    const headers = message.payload?.headers;
    const acc = { textParts: [] as string[], htmlParts: [] as string[], attachments: [] as EmailDetail['attachments'] };
    walkBodyParts(message.payload, acc);

    const bodyTextResult = truncateBody(acc.textParts.join('\n'));
    const bodyHtmlJoined = acc.htmlParts.join('\n');
    const bodyHtmlResult = bodyHtmlJoined ? truncateBody(bodyHtmlJoined) : undefined;

    return {
      id: message.id,
      from: headerValue(headers, 'From'),
      to: splitAddresses(headerValue(headers, 'To')),
      cc: splitAddresses(headerValue(headers, 'Cc')),
      subject: headerValue(headers, 'Subject'),
      date: headerValue(headers, 'Date'),
      bodyText: bodyTextResult.text,
      bodyHtml: bodyHtmlResult?.text,
      truncated: bodyTextResult.truncated || Boolean(bodyHtmlResult?.truncated),
      attachments: acc.attachments,
    };
  }

  async listContacts(): Promise<Contact[]> {
    const contacts = await fetchGoogleContacts(this.credentials);
    return contacts.map((c) => ({ email: c.email, name: c.name, source: 'google-contacts' as const }));
  }
}
