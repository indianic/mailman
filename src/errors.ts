/**
 * Structured error codes every failable tool can return, per the table in
 * docs/PLAN.md's "Concurrency, resilience & idempotency" section. Defined
 * up front in Phase 1 even though most aren't thrown until their owning
 * phase lands, so `{ code, message }` stays consistent from day one.
 */
export const ErrorCodes = {
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  AMBIGUOUS_ACCOUNT: 'AMBIGUOUS_ACCOUNT',
  DRAFT_EXPIRED: 'DRAFT_EXPIRED',
  DRAFT_ALREADY_SENT: 'DRAFT_ALREADY_SENT',
  DRAFT_NOT_FOUND: 'DRAFT_NOT_FOUND',
  ATTACHMENT_TOO_LARGE: 'ATTACHMENT_TOO_LARGE',
  ATTACHMENT_NOT_FOUND: 'ATTACHMENT_NOT_FOUND',
  AUTH_EXPIRED: 'AUTH_EXPIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  NO_MASTER_KEY: 'NO_MASTER_KEY',
  SCHEDULE_NOT_FOUND: 'SCHEDULE_NOT_FOUND',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
