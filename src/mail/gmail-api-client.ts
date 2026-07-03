import nodemailer from 'nodemailer';
import { withOAuth2Retry, type OAuth2Credentials } from '../auth/oauth2.js';
import { buildMailOptions } from '../auth/app-password.js';
import { fetchGoogleContacts } from './google-contacts.js';
import { truncateSnippet, truncateBody } from './normalize.js';
import type { MailProvider, Folder, Page, EmailSummary, EmailDetail, OutboundMessage, Contact } from './provider.js';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

/**
 * Build the raw RFC-822 message the Gmail API's messages.send expects,
 * base64url-encoded. We reuse buildMailOptions (same From/To/Cc/Bcc/Subject/
 * body/attachments/Message-ID/X-Mailer as the App Password path) and let
 * nodemailer's streamTransport compile it to bytes WITHOUT sending — no SMTP
 * connection, no network. Exported for unit testing. The returned messageId is
 * our own branded Message-ID header, so callers can report it after send.
 */
export async function buildRawMessage(
  fromEmail: string,
  message: OutboundMessage,
): Promise<{ raw: string; messageId: string }> {
  const options = buildMailOptions({ user: fromEmail, pass: '' }, message);
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  const built = await transport.sendMail(options);
  return { raw: (built.message as Buffer).toString('base64url'), messageId: String(options.messageId) };
}

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

  /**
   * Send via the Gmail REST API (messages.send), NOT SMTP. The old SMTP
   * XOAUTH2 path failed with "Can't create new access token for user" because
   * SMTP requires the broad `https://mail.google.com/` scope, whereas we
   * (correctly) request only `gmail.send` — which the REST API honors.
   */
  async send(message: OutboundMessage): Promise<{ messageId: string }> {
    const { raw, messageId } = await buildRawMessage(this.fromEmail, message);
    return withOAuth2Retry(
      this.credentials,
      async (accessToken) => {
        const response = await fetch(`${GMAIL_API_BASE}/messages/send`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw }),
        });
        if (!response.ok) {
          throw new GmailApiError(`Gmail API send failed: ${await response.text()}`, response.status);
        }
        await response.json();
        return { messageId };
      },
      classifyHttpError,
    );
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
