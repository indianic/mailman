import { z } from 'zod';

// Credentials are stored in plaintext through Phase 1 — Phase 3 wraps this
// same field in AES-256-GCM ciphertext (keytar-backed master key), not a
// schema shape change, so this stays the source of truth for the fields
// each method needs either way.
export const AppPasswordCredentialsSchema = z.object({
  user: z.string().email(),
  pass: z.string().min(1),
});

export const OAuth2CredentialsSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  refreshToken: z.string().min(1),
});

export const AccountSchema = z.discriminatedUnion('method', [
  z.object({
    alias: z.string().min(1),
    email: z.string().email(),
    method: z.literal('app-password'),
    isDefault: z.boolean(),
    credentials: AppPasswordCredentialsSchema,
  }),
  z.object({
    alias: z.string().min(1),
    email: z.string().email(),
    method: z.literal('oauth2'),
    isDefault: z.boolean(),
    credentials: OAuth2CredentialsSchema,
  }),
]);

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
