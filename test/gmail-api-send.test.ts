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

/**
 * Threading. Without In-Reply-To/References a reply arrives as a new message:
 * Gmail's web UI often regroups it by subject, but Outlook, Apple Mail and
 * Thunderbird thread strictly on these headers and show it detached. Asserted on
 * the compiled bytes rather than the options object, because that is what the
 * Gmail API actually receives.
 */
test('buildRawMessage emits In-Reply-To and References for a reply', async () => {
  const parent = '<CAF=abc123@mail.gmail.com>';
  const { raw } = await buildRawMessage('erp@indianic.com', {
    to: ['sandeep@indianic.com'],
    subject: 'Re: mailman on headless Linux',
    body: 'done',
    inReplyTo: parent,
    references: [parent],
  });
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  assert.match(decoded, /^In-Reply-To: <CAF=abc123@mail\.gmail\.com>$/m);
  assert.match(decoded, /^References: <CAF=abc123@mail\.gmail\.com>$/m);
});

test('buildRawMessage joins a multi-message References chain', async () => {
  const chain = ['<root@x.com>', '<second@x.com>', '<third@x.com>'];
  const { raw } = await buildRawMessage('erp@indianic.com', {
    to: ['a@b.com'],
    subject: 'Re: deep thread',
    body: 'reply',
    inReplyTo: chain[chain.length - 1],
    references: chain,
  });
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  // RFC 5322 separates them with whitespace; nodemailer may fold the header, so
  // assert each id is present rather than pinning the exact line breaks.
  for (const id of chain) assert.ok(decoded.includes(id), `missing ${id}`);
  assert.match(decoded, /^In-Reply-To: <third@x\.com>$/m);
});

test('buildRawMessage omits the threading headers entirely for a fresh message', async () => {
  // A new message must not carry an empty In-Reply-To — some servers treat that
  // as malformed, and it would thread the message under nothing.
  const { raw } = await buildRawMessage('erp@indianic.com', {
    to: ['a@b.com'],
    subject: 'fresh',
    body: 'hello',
  });
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  assert.doesNotMatch(decoded, /^In-Reply-To:/m);
  assert.doesNotMatch(decoded, /^References:/m);
});
