import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GmailApiProvider } from '../src/mail/gmail-api-client.js';

// Integration test against a mocked `fetch` — no network, no real Gmail
// account (see docs/PLAN.md's "Testing & CI strategy" section). mailman
// talks to the Gmail API via raw fetch rather than the `googleapis`
// SDK, so this fakes the HTTP layer directly at the same boundary.

const CREDENTIALS = { clientId: 'client-id', clientSecret: 'client-secret', refreshToken: 'refresh-token' };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function withMockedFetch(handler: (url: string) => Response, fn: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => Promise.resolve(handler(String(input)))) as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

test('GmailApiProvider.list fetches message ids then metadata for each, normalized into EmailSummary', async () => {
  await withMockedFetch(
    (url) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return jsonResponse({ access_token: 'fake-access-token', expires_in: 3600 });
      }
      if (url.includes('/messages?')) {
        return jsonResponse({ messages: [{ id: 'msg-1' }], nextPageToken: 'next-page' });
      }
      if (url.includes('/messages/msg-1')) {
        return jsonResponse({
          id: 'msg-1',
          snippet: 'Hello there, this is a test',
          labelIds: ['INBOX', 'UNREAD'],
          payload: {
            headers: [
              { name: 'From', value: 'alice@example.com' },
              { name: 'To', value: 'bob@example.com, carol@example.com' },
              { name: 'Subject', value: 'Quarterly report' },
              { name: 'Date', value: 'Mon, 1 Jan 2026 00:00:00 +0000' },
            ],
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
    async () => {
      const provider = new GmailApiProvider(CREDENTIALS, 'me@example.com');
      const page = await provider.list({ folder: 'inbox', limit: 10 });

      assert.equal(page.nextPageToken, 'next-page');
      assert.equal(page.items.length, 1);
      assert.deepEqual(page.items[0], {
        id: 'msg-1',
        from: 'alice@example.com',
        to: ['bob@example.com', 'carol@example.com'],
        subject: 'Quarterly report',
        snippet: 'Hello there, this is a test',
        date: 'Mon, 1 Jan 2026 00:00:00 +0000',
        hasAttachments: false,
        isUnread: true,
      });
    },
  );
});

test('GmailApiProvider.read decodes base64url body parts and collects attachment metadata', async () => {
  const bodyText = Buffer.from('The full email body.').toString('base64url');

  await withMockedFetch(
    (url) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return jsonResponse({ access_token: 'fake-access-token', expires_in: 3600 });
      }
      if (url.includes('/messages/msg-2')) {
        return jsonResponse({
          id: 'msg-2',
          payload: {
            headers: [
              { name: 'From', value: 'alice@example.com' },
              { name: 'To', value: 'bob@example.com' },
              { name: 'Subject', value: 'With attachment' },
              { name: 'Date', value: 'Tue, 2 Jan 2026 00:00:00 +0000' },
            ],
            mimeType: 'multipart/mixed',
            parts: [
              { mimeType: 'text/plain', body: { data: bodyText, size: 21 } },
              {
                mimeType: 'application/pdf',
                filename: 'invoice.pdf',
                body: { attachmentId: 'att-1', size: 12345 },
              },
            ],
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
    async () => {
      const provider = new GmailApiProvider(CREDENTIALS, 'me@example.com');
      const detail = await provider.read('msg-2');

      assert.equal(detail.bodyText, 'The full email body.');
      assert.equal(detail.truncated, false);
      assert.deepEqual(detail.attachments, [{ name: 'invoice.pdf', sizeBytes: 12345, mimeType: 'application/pdf' }]);
      assert.equal(detail.from, 'alice@example.com');
    },
  );
});

test('GmailApiProvider surfaces a clean AUTH_EXPIRED-mappable error on a real 401 from the token endpoint', async () => {
  await withMockedFetch(
    (url) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return jsonResponse({ error: 'invalid_client' }, 401);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
    async () => {
      const provider = new GmailApiProvider(CREDENTIALS, 'me@example.com');
      await assert.rejects(() => provider.list({ folder: 'inbox', limit: 10 }), /Refresh token exchange failed \(401\)/);
    },
  );
});
