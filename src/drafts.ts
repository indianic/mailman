import crypto from 'node:crypto';

export type DraftState = 'pending' | 'sent' | 'expired' | 'cancelled' | 'scheduled';

export interface DraftAttachment {
  path: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
}

export interface Draft {
  draftId: string;
  account: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  bodyType: 'text' | 'html';
  attachments: DraftAttachment[];
  // The original, un-resolved attachment input (paths/globs/dirs) —
  // kept alongside the already-resolved `attachments` above so
  // schedule_send can re-resolve fresh at fire time rather than reusing
  // a stale snapshot (see docs/PLAN.md's "Scheduled sends" section).
  rawAttachments: string[];
  recursive?: boolean;
  state: DraftState;
  createdAt: string;
  expiresAt: string;
  result?: { messageId: string; sentAt: string };
}

export interface CreateDraftInput {
  account: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  bodyType?: 'text' | 'html';
  attachments?: DraftAttachment[];
  rawAttachments?: string[];
  recursive?: boolean;
  ttlMinutes: number;
}

/**
 * In-memory only, keyed by crypto.randomUUID() — never written to disk
 * (see docs/PLAN.md's "Global config" section on why drafts stay
 * ephemeral). Node's event loop serializes each call's synchronous parts,
 * so concurrent draft_email calls never collide on an id.
 */
const drafts = new Map<string, Draft>();

export function createDraft(input: CreateDraftInput): Draft {
  const now = Date.now();
  const draft: Draft = {
    draftId: crypto.randomUUID(),
    account: input.account,
    to: input.to,
    cc: input.cc ?? [],
    bcc: input.bcc ?? [],
    subject: input.subject,
    body: input.body,
    bodyType: input.bodyType ?? 'text',
    attachments: input.attachments ?? [],
    rawAttachments: input.rawAttachments ?? [],
    recursive: input.recursive,
    state: 'pending',
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + input.ttlMinutes * 60_000).toISOString(),
  };
  drafts.set(draft.draftId, draft);
  return draft;
}

function reapIfExpired(draft: Draft): Draft {
  if (draft.state === 'pending' && Date.now() > Date.parse(draft.expiresAt)) {
    draft.state = 'expired';
  }
  return draft;
}

export function getDraft(draftId: string): Draft | undefined {
  const draft = drafts.get(draftId);
  return draft ? reapIfExpired(draft) : undefined;
}

/** pending -> cancelled. No-op (returns the draft as-is) from any other state. */
export function cancelDraft(draftId: string): Draft | undefined {
  const draft = getDraft(draftId);
  if (draft && draft.state === 'pending') {
    draft.state = 'cancelled';
  }
  return draft;
}

/**
 * pending -> sent. The only transition that should follow an actual
 * dispatch — callers must already have sent the mail before calling this.
 * No-op if the draft isn't pending (e.g. a second call after it's already
 * sent), since confirm_send's idempotent-replay handles that case itself.
 */
export function markSent(draftId: string, result: { messageId: string; sentAt: string }): Draft | undefined {
  const draft = getDraft(draftId);
  if (draft && draft.state === 'pending') {
    draft.state = 'sent';
    draft.result = result;
  }
  return draft;
}

/** pending -> scheduled. The draft's job is done once schedule_send has persisted its own record in scheduled.json. */
export function markScheduled(draftId: string): Draft | undefined {
  const draft = getDraft(draftId);
  if (draft && draft.state === 'pending') {
    draft.state = 'scheduled';
  }
  return draft;
}
