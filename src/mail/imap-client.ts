import { ImapFlow, type FetchMessageObject, type MessageAddressObject, type MessageStructureObject, type SearchObject } from 'imapflow';
import type { AppPasswordCredentials } from '../auth/app-password.js';
import { sendViaAppPassword } from '../auth/app-password.js';
import { truncateSnippet, truncateBody } from './normalize.js';
import type { MailProvider, Folder, Page, EmailSummary, EmailDetail, OutboundMessage, Contact } from './provider.js';

const ID_PREFIX = 'imap:';

function folderToMailboxPath(folder: Folder): string {
  if (folder === 'inbox') return 'INBOX';
  if (folder === 'sent') return '[Gmail]/Sent Mail';
  return '[Gmail]/All Mail';
}

export function encodeId(mailboxPath: string, uid: number): string {
  return `${ID_PREFIX}${encodeURIComponent(mailboxPath)}:${uid}`;
}

export function decodeId(id: string): { mailboxPath: string; uid: number } {
  if (!id.startsWith(ID_PREFIX)) {
    throw new Error(`Not an IMAP message id: ${id}`);
  }
  const [mailboxPathEncoded, uidStr] = id.slice(ID_PREFIX.length).split(':');
  return { mailboxPath: decodeURIComponent(mailboxPathEncoded), uid: Number(uidStr) };
}

export function formatAddress(addr: MessageAddressObject): string {
  if (addr.name && addr.address) return `${addr.name} <${addr.address}>`;
  return addr.address ?? '';
}

// IMAP search is a real capability gap vs Gmail's native query syntax
// (see docs/PLAN.md's "Reading, listing, and searching mail" section) —
// only from:/subject:/after:/before: are recognized; anything else falls
// into a generic text search across headers+body.
export function parseSimpleQuery(query: string): SearchObject {
  const search: SearchObject = {};
  const remaining: string[] = [];
  for (const token of query.split(/\s+/).filter(Boolean)) {
    const match = /^(from|subject|after|before):(.+)$/i.exec(token);
    if (match) {
      const [, key, value] = match;
      if (key.toLowerCase() === 'from') search.from = value;
      else if (key.toLowerCase() === 'subject') search.subject = value;
      else if (key.toLowerCase() === 'after') search.since = value;
      else if (key.toLowerCase() === 'before') search.before = value;
      continue;
    }
    remaining.push(token);
  }
  if (remaining.length > 0) {
    search.text = remaining.join(' ');
  }
  return search;
}

export function structureHasAttachments(node: MessageStructureObject | undefined): boolean {
  if (!node) return false;
  const filename = node.dispositionParameters?.filename ?? node.parameters?.name;
  if (filename && node.disposition !== 'inline') return true;
  return (node.childNodes ?? []).some(structureHasAttachments);
}

export interface FoundPart {
  part: string;
  encoding?: string;
}

export function findFirstPartByType(node: MessageStructureObject | undefined, mimeType: string): FoundPart | undefined {
  if (!node) return undefined;
  if (node.type === mimeType) return { part: node.part ?? '1', encoding: node.encoding };
  for (const child of node.childNodes ?? []) {
    const found = findFirstPartByType(child, mimeType);
    if (found) return found;
  }
  return undefined;
}

/**
 * IMAP hands back each part's raw transfer-encoded bytes — unlike Gmail's
 * REST API, which already decodes for you. quoted-printable and base64
 * are the two transfer encodings Gmail actually uses for text parts; 7bit/
 * 8bit/binary need no decoding.
 */
export function decodePartContent(buf: Buffer, encoding: string | undefined): string {
  const enc = (encoding ?? '7bit').toLowerCase();
  if (enc === 'quoted-printable') {
    return decodeQuotedPrintable(buf.toString('binary'));
  }
  if (enc === 'base64') {
    return Buffer.from(buf.toString('ascii').replace(/[^A-Za-z0-9+/=]/g, ''), 'base64').toString('utf8');
  }
  return buf.toString('utf8');
}

function decodeQuotedPrintable(input: string): string {
  const withoutSoftBreaks = input.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < withoutSoftBreaks.length; i++) {
    const hexPair = withoutSoftBreaks.slice(i + 1, i + 3);
    if (withoutSoftBreaks[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(hexPair)) {
      bytes.push(parseInt(hexPair, 16));
      i += 2;
    } else {
      bytes.push(withoutSoftBreaks.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

export function collectAttachments(
  node: MessageStructureObject | undefined,
  acc: EmailDetail['attachments'] = [],
): EmailDetail['attachments'] {
  if (!node) return acc;
  const filename = node.dispositionParameters?.filename ?? node.parameters?.name;
  if (filename && node.disposition !== 'inline') {
    acc.push({ name: filename, sizeBytes: node.size ?? 0, mimeType: node.type });
  }
  for (const child of node.childNodes ?? []) {
    collectAttachments(child, acc);
  }
  return acc;
}

export function extractSnippetFromTextSection(buf: Buffer | undefined): string {
  if (!buf) return '';
  const cleaned = buf
    .toString('utf8')
    // The raw TEXT section may span multiple parts with different transfer
    // encodings, so a full decode isn't possible here — but stripping
    // quoted-printable soft line breaks (before splitting on \n) removes
    // the most visible noise.
    .replace(/=\r?\n/g, '')
    .split('\n')
    .filter((line) => !line.startsWith('--') && !/^(Content-Type|Content-Transfer-Encoding|Content-Disposition):/i.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return truncateSnippet(cleaned);
}

function isConnectionDropError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /closed|econnreset|no connection|not available|timed?out/i.test(message);
}

async function fetchOne(
  client: ImapFlow,
  uid: number,
  query: Parameters<ImapFlow['fetch']>[1],
): Promise<FetchMessageObject | undefined> {
  for await (const msg of client.fetch(uid, query, { uid: true })) {
    return msg;
  }
  return undefined;
}

export class ImapSmtpProvider implements MailProvider {
  constructor(private credentials: AppPasswordCredentials) {}

  send(message: OutboundMessage): Promise<{ messageId: string }> {
    return sendViaAppPassword(this.credentials, message);
  }

  /** Reconnect once on an unexpected drop — a transient Wi-Fi blip shouldn't fail the call outright. */
  private async withReconnect<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    try {
      return await this.withClient(fn);
    } catch (err) {
      if (isConnectionDropError(err)) {
        return await this.withClient(fn);
      }
      throw err;
    }
  }

  private async withClient<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: { user: this.credentials.user, pass: this.credentials.pass },
      logger: false,
    });
    try {
      await client.connect();
    } catch (err) {
      const detail = (err as { authenticationFailed?: boolean; responseText?: string }).authenticationFailed
        ? ((err as { responseText?: string }).responseText ?? 'authentication failed')
        : err instanceof Error
          ? err.message
          : String(err);
      throw new Error(`IMAP connection to imap.gmail.com failed: ${detail}`);
    }
    try {
      return await fn(client);
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  private toSummary(mailboxPath: string, msg: FetchMessageObject): EmailSummary {
    return {
      id: encodeId(mailboxPath, msg.uid),
      from: msg.envelope?.from?.[0] ? formatAddress(msg.envelope.from[0]) : '',
      to: (msg.envelope?.to ?? []).map(formatAddress),
      subject: msg.envelope?.subject ?? '',
      snippet: extractSnippetFromTextSection(msg.bodyParts?.get('TEXT')),
      date: msg.envelope?.date ? new Date(msg.envelope.date).toISOString() : '',
      hasAttachments: structureHasAttachments(msg.bodyStructure),
      isUnread: !msg.flags?.has('\\Seen'),
    };
  }

  private async fetchPage(folder: Folder, limit: number, pageToken?: string, query?: string): Promise<Page<EmailSummary>> {
    return this.withReconnect(async (client) => {
      const mailboxPath = folderToMailboxPath(folder);
      const lock = await client.getMailboxLock(mailboxPath);
      try {
        const searchObj: SearchObject = query ? parseSimpleQuery(query) : { all: true };
        const result = await client.search(searchObj, { uid: true });
        let uids = (result === false ? [] : [...result]).sort((a, b) => b - a); // newest first

        if (pageToken) {
          const cursor = Number(pageToken);
          uids = uids.filter((uid) => uid < cursor);
        }
        const pageUids = uids.slice(0, limit);
        const nextPageToken = uids.length > limit ? String(pageUids[pageUids.length - 1]) : undefined;

        if (pageUids.length === 0) {
          return { items: [], nextPageToken: undefined };
        }

        const messages = new Map<number, FetchMessageObject>();
        for await (const msg of client.fetch(
          pageUids,
          { envelope: true, flags: true, bodyStructure: true, uid: true, bodyParts: ['TEXT'] },
          { uid: true },
        )) {
          messages.set(msg.uid, msg);
        }

        const items = pageUids
          .map((uid) => messages.get(uid))
          .filter((m): m is FetchMessageObject => Boolean(m))
          .map((m) => this.toSummary(mailboxPath, m));
        return { items, nextPageToken };
      } finally {
        lock.release();
      }
    });
  }

  list(opts: { folder: Folder; limit: number; pageToken?: string }): Promise<Page<EmailSummary>> {
    return this.fetchPage(opts.folder, opts.limit, opts.pageToken);
  }

  search(opts: { query: string; folder: Folder; limit: number; pageToken?: string }): Promise<Page<EmailSummary>> {
    return this.fetchPage(opts.folder, opts.limit, opts.pageToken, opts.query);
  }

  async read(id: string): Promise<EmailDetail> {
    const { mailboxPath, uid } = decodeId(id);
    return this.withReconnect(async (client) => {
      const lock = await client.getMailboxLock(mailboxPath);
      try {
        const structureMsg = await fetchOne(client, uid, { envelope: true, bodyStructure: true, uid: true });
        if (!structureMsg) {
          throw new Error(`Message not found: ${id}`);
        }

        const textPart = findFirstPartByType(structureMsg.bodyStructure, 'text/plain');
        const htmlPart = findFirstPartByType(structureMsg.bodyStructure, 'text/html');
        const attachments = collectAttachments(structureMsg.bodyStructure);

        const partsToFetch = [textPart?.part, htmlPart?.part].filter((p): p is string => Boolean(p));
        let bodyText = '';
        let bodyHtml: string | undefined;
        if (partsToFetch.length > 0) {
          const contentMsg = await fetchOne(client, uid, { uid: true, bodyParts: partsToFetch });
          if (textPart) {
            const raw = contentMsg?.bodyParts?.get(textPart.part);
            bodyText = raw ? decodePartContent(raw, textPart.encoding) : '';
          }
          if (htmlPart) {
            const raw = contentMsg?.bodyParts?.get(htmlPart.part);
            bodyHtml = raw ? decodePartContent(raw, htmlPart.encoding) : undefined;
          }
        }

        const bodyTextResult = truncateBody(bodyText);
        const bodyHtmlResult = bodyHtml ? truncateBody(bodyHtml) : undefined;

        return {
          id,
          from: structureMsg.envelope?.from?.[0] ? formatAddress(structureMsg.envelope.from[0]) : '',
          to: (structureMsg.envelope?.to ?? []).map(formatAddress),
          cc: (structureMsg.envelope?.cc ?? []).map(formatAddress),
          subject: structureMsg.envelope?.subject ?? '',
          date: structureMsg.envelope?.date ? new Date(structureMsg.envelope.date).toISOString() : '',
          bodyText: bodyTextResult.text,
          bodyHtml: bodyHtmlResult?.text,
          truncated: bodyTextResult.truncated || Boolean(bodyHtmlResult?.truncated),
          attachments,
        };
      } finally {
        lock.release();
      }
    });
  }

  // App Password accounts have no Google API access at all (SMTP/IMAP
  // login grants no OAuth scopes) — no equivalent contacts source exists.
  async listContacts(): Promise<Contact[]> {
    return [];
  }
}
