import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDraft, getDraft, cancelDraft, markSent } from '../src/drafts.js';

function baseInput(overrides: Partial<Parameters<typeof createDraft>[0]> = {}) {
  return {
    account: 'personal-gmail',
    to: ['someone@example.com'],
    subject: 'Test',
    body: 'Hello',
    ttlMinutes: 10,
    ...overrides,
  };
}

test('createDraft starts in the pending state with a unique id', () => {
  const a = createDraft(baseInput());
  const b = createDraft(baseInput());
  assert.equal(a.state, 'pending');
  assert.notEqual(a.draftId, b.draftId);
});

test('getDraft returns undefined for an unknown id', () => {
  assert.equal(getDraft('00000000-0000-0000-0000-000000000000'), undefined);
});

test('cancelDraft transitions pending -> cancelled', () => {
  const draft = createDraft(baseInput());
  const cancelled = cancelDraft(draft.draftId);
  assert.equal(cancelled?.state, 'cancelled');
  assert.equal(getDraft(draft.draftId)?.state, 'cancelled');
});

test('cancelDraft is a no-op once already sent', () => {
  const draft = createDraft(baseInput());
  markSent(draft.draftId, { messageId: 'abc', sentAt: new Date().toISOString() });
  const result = cancelDraft(draft.draftId);
  assert.equal(result?.state, 'sent');
});

test('markSent transitions pending -> sent and records the result', () => {
  const draft = createDraft(baseInput());
  const sentAt = new Date().toISOString();
  const updated = markSent(draft.draftId, { messageId: 'msg-1', sentAt });
  assert.equal(updated?.state, 'sent');
  assert.deepEqual(updated?.result, { messageId: 'msg-1', sentAt });
});

test('markSent is a no-op if called again (idempotent at the store layer)', () => {
  const draft = createDraft(baseInput());
  markSent(draft.draftId, { messageId: 'first', sentAt: new Date().toISOString() });
  markSent(draft.draftId, { messageId: 'second', sentAt: new Date().toISOString() });
  assert.equal(getDraft(draft.draftId)?.result?.messageId, 'first');
});

test('a draft expires once its TTL elapses', async () => {
  const draft = createDraft(baseInput({ ttlMinutes: 1 / 60_000 })); // ~1ms
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(getDraft(draft.draftId)?.state, 'expired');
});

test('cancelDraft cannot revive an expired draft', async () => {
  const draft = createDraft(baseInput({ ttlMinutes: 1 / 60_000 }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  const result = cancelDraft(draft.draftId);
  assert.equal(result?.state, 'expired');
});
