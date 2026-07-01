import { z } from 'zod';

// Plaintext shapes — only ever held in memory, right after decryption
// (see src/accounts.ts's getDecryptedCredentials). Never written to disk
// directly; on disk they're wrapped in EncryptedBlobSchema below.
export const AppPasswordCredentialsSchema = z.object({
  user: z.string().email(),
  pass: z.string().min(1),
});

export const OAuth2CredentialsSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  refreshToken: z.string().min(1),
});

// What actually lives in accounts.json: AES-256-GCM ciphertext of the
// method-specific plaintext credentials above, keyed by the keytar-backed
// master key. See docs/PLAN.md's "Security model" section.
export const EncryptedBlobSchema = z.object({
  ciphertext: z.string(),
  iv: z.string(),
  authTag: z.string(),
});

// No isDefault field here — settings.json's defaultAccount is the single
// source of truth (see docs/PLAN.md's "Multi-account + settings" section).
// A redundant per-account flag would let the two disagree.
export const AccountSchema = z.object({
  alias: z.string().min(1),
  email: z.string().email(),
  method: z.enum(['app-password', 'oauth2']),
  credentials: EncryptedBlobSchema,
});

export const AccountsFileSchema = z.object({
  schemaVersion: z.literal(1),
  accounts: z.array(AccountSchema),
});

export const SettingsFileSchema = z.object({
  schemaVersion: z.literal(1),
  defaultAccount: z.string().nullable(),
  draftTtlMinutes: z.number().int().positive(),
  alwaysConfirm: z.boolean(),
});

export type Account = z.infer<typeof AccountSchema>;
export type AccountsFile = z.infer<typeof AccountsFileSchema>;
export type SettingsFile = z.infer<typeof SettingsFileSchema>;

export const DEFAULT_ACCOUNTS_FILE: AccountsFile = { schemaVersion: 1, accounts: [] };

export const DEFAULT_SETTINGS_FILE: SettingsFile = {
  schemaVersion: 1,
  defaultAccount: null,
  draftTtlMinutes: 10,
  alwaysConfirm: true,
};

// "google-contacts" is never stored here — it's fetched live from the
// People API per suggest_recipients/list_contacts call, never cached to
// disk. Only what mailman itself learned locally lives in this file.
export const ContactSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  source: z.enum(['manual', 'recents']),
  useCount: z.number().int().nonnegative(),
  lastUsedAt: z.string().nullable(),
});

export const ContactsFileSchema = z.object({
  schemaVersion: z.literal(1),
  contacts: z.array(ContactSchema),
});

export type Contact = z.infer<typeof ContactSchema>;
export type ContactsFile = z.infer<typeof ContactsFileSchema>;

export const DEFAULT_CONTACTS_FILE: ContactsFile = { schemaVersion: 1, contacts: [] };

// A scheduled email's recipient/subject/body sitting in plaintext on disk
// until it fires is a real exposure — `content` gets the same encrypted-
// blob treatment as account credentials. `scheduledId`/`account`/`sendAt`/
// `status`/`attempts` stay plaintext so the ticker's due-scan doesn't need
// to decrypt every entry just to check what's due. See docs/PLAN.md's
// "Scheduled sends" section.
export const ScheduledMessageContentSchema = z.object({
  to: z.array(z.string().email()),
  cc: z.array(z.string().email()),
  bcc: z.array(z.string().email()),
  subject: z.string(),
  body: z.string(),
  bodyType: z.enum(['text', 'html']),
  // Raw paths/globs/dirs — re-resolved fresh at fire time, never
  // snapshotted (see docs/PLAN.md's "Scheduled sends" section).
  attachments: z.array(z.string()),
  recursive: z.boolean().optional(),
});

export const ScheduledEntrySchema = z.object({
  scheduledId: z.string(),
  account: z.string(),
  sendAt: z.string(),
  status: z.enum(['pending', 'sent', 'failed']),
  attempts: z.number().int().nonnegative(),
  content: EncryptedBlobSchema,
  result: z.object({ messageId: z.string(), sentAt: z.string() }).optional(),
  lastError: z.string().optional(),
});

export const ScheduledFileSchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.array(ScheduledEntrySchema),
});

export type ScheduledMessageContent = z.infer<typeof ScheduledMessageContentSchema>;
export type ScheduledEntry = z.infer<typeof ScheduledEntrySchema>;
export type ScheduledFile = z.infer<typeof ScheduledFileSchema>;

export const DEFAULT_SCHEDULED_FILE: ScheduledFile = { schemaVersion: 1, entries: [] };
