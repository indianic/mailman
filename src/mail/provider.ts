export type Folder = 'inbox' | 'sent' | 'all';

export interface Page<T> {
  items: T[];
  nextPageToken?: string;
}

export interface OutboundMessage {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  bodyType?: 'text' | 'html';
  attachments?: Array<{ path: string; name: string; mimeType: string }>;
  /**
   * Images referenced from the HTML body by `cid:` — the signature photo. Sent
   * inline rather than linked, so they render without the recipient having to
   * allow remote images, which Gmail and Outlook block by default.
   */
  inlineImages?: Array<{ cid: string; path: string }>;
  // "From Name" shown to recipients, e.g. "Kalpesh Gamit" for
  // "Kalpesh Gamit <you@gmail.com>" — omitted for a bare-address From.
  fromDisplayName?: string;
  /**
   * RFC 5322 threading. Without these a reply arrives as a brand-new message:
   * Gmail's web UI often regroups it by subject, but every client that threads
   * strictly (Outlook, Apple Mail, Thunderbird) shows it detached. Set both from
   * the Message-ID that `read_email` now returns.
   */
  inReplyTo?: string;
  references?: string[];
}

export interface EmailSummary {
  id: string;
  from: string;
  to: string[];
  subject: string;
  snippet: string;
  date: string;
  hasAttachments: boolean;
  isUnread: boolean;
}

export interface EmailDetail {
  id: string;
  /**
   * The original's RFC 5322 Message-ID, e.g. "<abc@mail.gmail.com>". Exposed
   * because a reply cannot be threaded without it, and nothing else in the
   * surface carried it — `id` is a provider-local handle (an IMAP UID or a Gmail
   * API id), not something that can go in an In-Reply-To header.
   */
  messageId?: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  date: string;
  bodyText: string;
  bodyHtml?: string;
  truncated: boolean;
  attachments: Array<{ name: string; sizeBytes: number; mimeType: string }>;
}

export interface Contact {
  email: string;
  name?: string;
  source: 'recents' | 'manual' | 'google-contacts';
  useCount?: number;
  lastUsedAt?: string;
}

/**
 * One interface, two backends (GmailApiProvider for oauth2 accounts,
 * ImapSmtpProvider for app-password accounts) — tools call getProvider()
 * and never branch on auth method themselves. See docs/PLAN.md's
 * "Provider abstraction" section.
 */
export interface MailProvider {
  send(message: OutboundMessage): Promise<{ messageId: string }>;
  list(opts: { folder: Folder; limit: number; pageToken?: string }): Promise<Page<EmailSummary>>;
  search(opts: {
    query: string;
    folder: Folder;
    limit: number;
    pageToken?: string;
  }): Promise<Page<EmailSummary>>;
  read(id: string): Promise<EmailDetail>;
  listContacts(): Promise<Contact[]>;
}
