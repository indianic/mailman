import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRawMessage } from '../src/mail/gmail-api-client.js';

test('buildRawMessage produces a base64url RFC-822 message the Gmail API can accept', async () => {
  const { raw, messageId } = await buildRawMessage('erp@indianic.com', {
    to: ['kalpesh.gamit@indianic.com'],
    cc: ['ops@indianic.com'],
    subject: 'Hello from OAuth2',
    body: '<p>Hi there</p>',
    bodyType: 'html',
    fromDisplayName: 'ERP',
  });

  // base64url alphabet only (no +, /, =) — required by messages.send.
  assert.match(raw, /^[A-Za-z0-9_-]+$/);

  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  assert.match(decoded, /^To: kalpesh\.gamit@indianic\.com/m);
  assert.match(decoded, /^Cc: ops@indianic\.com/m);
  assert.match(decoded, /^From: ERP <erp@indianic\.com>/m);
  assert.match(decoded, /^Subject: Hello from OAuth2/m);
  assert.match(decoded, /Hi there/);
  // Branded Message-ID header is carried through and returned for reporting.
  assert.ok(messageId.includes('mcp-mailman.'));
  assert.ok(decoded.includes(messageId.replace(/^<|>$/g, '')));
});

test('buildRawMessage sends plain text when bodyType is text', async () => {
  const { raw } = await buildRawMessage('erp@indianic.com', {
    to: ['a@b.com'],
    subject: 'Plain',
    body: 'just text',
    bodyType: 'text',
  });
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  assert.match(decoded, /text\/plain/);
  assert.match(decoded, /just text/);
});
