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
