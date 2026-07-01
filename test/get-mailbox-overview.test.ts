import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMailboxStats, enrichWithAttachments } from '../src/tools/get-mailbox-overview.js';
import type { EmailSummary, EmailDetail } from '../src/mail/provider.js';

function summary(overrides: Partial<EmailSummary>): EmailSummary {
  return {
    id: 'id-1',
    from: 'a@example.com',
    to: ['b@example.com'],
    subject: 'subject',
    snippet: '',
    date: '2026-01-01T00:00:00.000Z',
    hasAttachments: false,
    isUnread: false,
    ...overrides,
  };
}

test('computeMailboxStats counts sent/inbox/unread/attachments across both lists', () => {
  const sent = [summary({ id: 's1', hasAttachments: true }), summary({ id: 's2' })];
  const inbox = [
    summary({ id: 'i1', isUnread: true }),
    summary({ id: 'i2', isUnread: true, hasAttachments: true }),
    summary({ id: 'i3' }),
  ];
  assert.deepEqual(computeMailboxStats(sent, inbox), {
    sentCount: 2,
    inboxCount: 3,
    unreadCount: 2,
    attachmentCount: 2,
  });
});

test('computeMailboxStats handles empty lists', () => {
  assert.deepEqual(computeMailboxStats([], []), { sentCount: 0, inboxCount: 0, unreadCount: 0, attachmentCount: 0 });
});

test('enrichWithAttachments leaves messages without attachments untouched (no read() call)', async () => {
  let readCalls = 0;
  const fakeProvider = {
    read: async (): Promise<EmailDetail> => {
      readCalls += 1;
      throw new Error('should not be called');
    },
  };
  const items = [summary({ id: 'no-attach', hasAttachments: false })];
  const result = await enrichWithAttachments(fakeProvider, items);
  assert.equal(readCalls, 0);
  assert.deepEqual(result, items);
});

test('enrichWithAttachments fetches attachment metadata for messages that have one', async () => {
  const fakeProvider = {
    read: async (id: string): Promise<EmailDetail> => ({
      id,
      from: 'a@example.com',
      to: ['b@example.com'],
      subject: 's',
      date: '2026-01-01T00:00:00.000Z',
      bodyText: 'body',
      truncated: false,
      attachments: [{ name: 'report.pdf', sizeBytes: 1234, mimeType: 'application/pdf' }],
    }),
  };
  const items = [summary({ id: 'has-attach', hasAttachments: true })];
  const [result] = await enrichWithAttachments(fakeProvider, items);
  assert.deepEqual(result.attachments, [{ name: 'report.pdf', sizeBytes: 1234, mimeType: 'application/pdf' }]);
});

test('enrichWithAttachments is best-effort: a read() failure falls back to the plain summary, not a thrown error', async () => {
  const fakeProvider = {
    read: async (): Promise<EmailDetail> => {
      throw new Error('IMAP connection dropped');
    },
  };
  const items = [summary({ id: 'flaky', hasAttachments: true })];
  const result = await enrichWithAttachments(fakeProvider, items);
  assert.deepEqual(result, items); // unchanged, no attachments field, no throw
});

test('enrichWithAttachments processes multiple messages independently (one failure does not affect others)', async () => {
  const fakeProvider = {
    read: async (id: string): Promise<EmailDetail> => {
      if (id === 'bad') throw new Error('boom');
      return {
        id,
        from: 'a@example.com',
        to: ['b@example.com'],
        subject: 's',
        date: '2026-01-01T00:00:00.000Z',
        bodyText: 'body',
        truncated: false,
        attachments: [{ name: 'ok.pdf', sizeBytes: 1, mimeType: 'application/pdf' }],
      };
    },
  };
  const items = [summary({ id: 'good', hasAttachments: true }), summary({ id: 'bad', hasAttachments: true })];
  const [good, bad] = await enrichWithAttachments(fakeProvider, items);
  assert.deepEqual(good.attachments, [{ name: 'ok.pdf', sizeBytes: 1, mimeType: 'application/pdf' }]);
  assert.equal(bad.attachments, undefined);
});
