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
  // "From Name" shown to recipients (e.g., "Kalpesh Gamit" for
  // "Kalpesh Gamit <you@gmail.com>") and a per-account signature block
  // appended at draft time. Both plaintext — display name and a
  // signature aren't secrets, so they don't need the encrypted-blob
  // treatment credentials get.
  displayName: z.string().optional(),
  signature: z.string().optional(),
  /**
   * Absolute path to a signature photo, attached inline (Content-ID) on every
   * HTML send whose signature references it. A path rather than the bytes: the
   * file lives in the config dir, is re-read at send time like every other
   * attachment, and keeping ~40KB of base64 out of accounts.json means the
   * credential file stays small and diffable.
   */
  signatureImage: z.string().optional(),
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
  // Used by draft_email when a call doesn't pass bodyType explicitly.
  // Defaults to 'html' — modern mail is HTML, and it enables the polished
  // theme + rich signatures. .default() rather than a bare required field so
  // settings.json files written before this field existed still load.
  // (Existing configs that explicitly stored 'text' keep it; flip with
  //  `mailman settings set defaultBodyType html`.)
  defaultBodyType: z.enum(['text', 'html']).default('html'),
  // Native desktop notification (macOS Notification Center / Linux
  // notify-send / Windows toast) after a successful send. On by default;
  // disable with `mailman settings set desktopNotifications false`.
  // .default(true) so settings.json files written before this field
  // existed still load (and pick up the notification).
  desktopNotifications: z.boolean().default(true),
  // Default visual treatment for HTML bodies. 'plain' sends the composed HTML
  // as-is (current behaviour); 'polished' wraps it in a clean, minimal shell
  // (readable font stack, ~600px column, comfortable line-height, a subtle
  // divider before the signature). Opt-in so existing draft_email calls are
  // unchanged; override per call with draft_email's `theme` param.
  emailTheme: z.enum(['plain', 'polished']).default('polished'),
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
  defaultBodyType: 'html',
  desktopNotifications: true,
  emailTheme: 'polished',
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
  // RFC 5322 threading, so a reply scheduled for 9am still lands in its thread.
  // Optional so entries written before 1.4.0 still parse.
  inReplyTo: z.string().optional(),
  references: z.array(z.string()).optional(),
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

// --- Campaigns (personalised merge) --------------------------------------
//
// A campaign is N messages, one per recipient, rendered from one template.
// See docs/CAMPAIGNS.md.
//
// The split between encrypted `content` and plaintext per-recipient rows is
// the same call scheduled.json makes, for the same reason: who a campaign is
// addressed to and what it says are exactly as sensitive as a scheduled
// message, while *whether recipient 17 has been sent yet* has to be written
// after every single send. Keeping the bookkeeping in the clear means the
// idempotency record survives a run without decrypting and re-encrypting the
// whole recipient list 39 times.
//
// Recipients are therefore keyed by `seq` — their index in the encrypted
// recipient list — not by address, so no address leaks into the plaintext half.
export const CampaignContentSchema = z.object({
  /** May contain {{placeholders}}; rendered per recipient at send time. */
  subjectTemplate: z.string(),
  /**
   * Fully composed: the caller's body with the account signature appended and
   * the polished shell applied, exactly as draft_email would have produced it.
   * Baking that in at draft time is what makes the approved preview and the
   * dispatched message the same object.
   */
  bodyTemplate: z.string(),
  bodyType: z.enum(['text', 'html']),
  /** Raw paths/globs/dirs — re-resolved fresh at send time, never snapshotted. */
  attachments: z.array(z.string()),
  recursive: z.boolean().optional(),
  /** Attached to the first message that actually sends, then dropped (§4.5). */
  ccFirstOnly: z.array(z.string().email()),
  /**
   * Same first-message-only rule, invisibly. Optional so campaigns written
   * before this field existed still read back — `decryptCampaignContent` casts
   * rather than parses, so a missing key arrives as undefined, and every reader
   * defaults it to [].
   */
  bccFirstOnly: z.array(z.string().email()).optional(),
  /**
   * Render inputs frozen at draft time. A contact renamed mid-campaign must not
   * produce two different greetings within one run (docs/CAMPAIGNS.md §4.1).
   */
  recipients: z.array(
    z.object({
      email: z.string().email(),
      vars: z.record(z.string()),
    }),
  ),
});

export const CampaignRecipientStateSchema = z.object({
  /** Index into CampaignContent.recipients — the join key between the two halves. */
  seq: z.number().int().nonnegative(),
  status: z.enum(['pending', 'sent', 'failed', 'skipped']),
  attempts: z.number().int().nonnegative(),
  messageId: z.string().optional(),
  sentAt: z.string().optional(),
  error: z.string().optional(),
});

export const CampaignEntrySchema = z.object({
  campaignId: z.string(),
  account: z.string(),
  status: z.enum(['draft', 'sending', 'sent', 'cancelled', 'failed']),
  createdAt: z.string(),
  throttlePerMinute: z.number().int().positive(),
  maxAttempts: z.number().int().positive(),
  content: EncryptedBlobSchema,
  recipients: z.array(CampaignRecipientStateSchema),
  /**
   * Which recipient the Cc list actually rode along with. Set only after that
   * message is confirmed sent, so a failed first message hands the Cc to
   * whoever genuinely goes out first — leadership gets exactly one copy.
   */
  ccAppliedToSeq: z.number().int().nonnegative().optional(),
  /** Set with status 'failed' when a run is aborted wholesale (§4.6). */
  abortReason: z.string().optional(),
});

export const CampaignsFileSchema = z.object({
  schemaVersion: z.literal(1),
  campaigns: z.array(CampaignEntrySchema),
});

export type CampaignContent = z.infer<typeof CampaignContentSchema>;
export type CampaignRecipientState = z.infer<typeof CampaignRecipientStateSchema>;
export type CampaignEntry = z.infer<typeof CampaignEntrySchema>;
export type CampaignsFile = z.infer<typeof CampaignsFileSchema>;
export type CampaignStatus = CampaignEntry['status'];
export type RecipientStatus = CampaignRecipientState['status'];

export const DEFAULT_CAMPAIGNS_FILE: CampaignsFile = { schemaVersion: 1, campaigns: [] };

// keystore.json — which backend holds the master key, and the non-secret inputs
// needed to use it. Deliberately holds NO key material: a scrypt salt is not a
// secret, and the file's whole job is to make backend resolution deterministic.
//
// Without it, a failed Secret Service probe is indistinguishable from "no key
// was ever stored here" — and guessing wrong means minting a fresh key on
// another backend while accounts.json stays encrypted under the old one. See
// docs/HEADLESS-KEYSTORE.md.
export const KeystoreKdfSchema = z.object({
  algorithm: z.literal('scrypt'),
  salt: z.string().min(1), // base64
  N: z.number().int().positive(),
  r: z.number().int().positive(),
  p: z.number().int().positive(),
  /**
   * HMAC of the derived key, so a wrong passphrase is rejected with a sentence
   * rather than a GCM auth-tag failure from inside a send. Not key material and
   * not a weakening: accounts.json is already an oracle for candidate
   * passphrases, and scrypt dominates the cost of a guess either way. Optional
   * so a record written before this existed still parses.
   */
  verifier: z.string().min(1).optional(),
});

export const KeystoreRecordSchema = z.object({
  backend: z.enum(['os-keychain', 'passphrase', 'env', 'file']),
  /** `passphrase` only — the scrypt inputs the key is derived from. */
  kdf: KeystoreKdfSchema.optional(),
  /** `file` only — where the key file was written, so reset/migrate can find it. */
  keyFile: z.string().min(1).optional(),
  createdAt: z.string(),
});

export const KeystoreFileSchema = z.object({
  schemaVersion: z.literal(1),
  /** null on a legacy install that predates this file — resolution falls back to os-keychain. */
  active: KeystoreRecordSchema.nullable(),
});

export type KeystoreKdf = z.infer<typeof KeystoreKdfSchema>;
export type KeystoreRecord = z.infer<typeof KeystoreRecordSchema>;
export type KeystoreFile = z.infer<typeof KeystoreFileSchema>;

export const DEFAULT_KEYSTORE_FILE: KeystoreFile = { schemaVersion: 1, active: null };
