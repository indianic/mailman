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

export const AccountSchema = z.object({
  alias: z.string().min(1),
  email: z.string().email(),
  method: z.enum(['app-password', 'oauth2']),
  isDefault: z.boolean(),
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
