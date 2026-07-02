import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatFromAddress, appendSignature, buildMessageId, mailmanHeaders } from '../src/mail/compose.js';

test('formatFromAddress: bare email when no display name is set', () => {
  assert.equal(formatFromAddress('you@gmail.com'), 'you@gmail.com');
  assert.equal(formatFromAddress('you@gmail.com', undefined), 'you@gmail.com');
});

test('formatFromAddress: "Name <email>" when a display name is set', () => {
  assert.equal(formatFromAddress('you@gmail.com', 'Kalpesh Gamit'), 'Kalpesh Gamit <you@gmail.com>');
});

test('appendSignature: returns body unchanged when there is no signature', () => {
  assert.equal(appendSignature('hello', undefined, 'text'), 'hello');
});

test('appendSignature: text body joins with a blank line', () => {
  assert.equal(appendSignature('hello', '-- Kalpesh', 'text'), 'hello\n\n-- Kalpesh');
});

test('appendSignature: html body joins with <br><br>', () => {
  assert.equal(appendSignature('<p>hello</p>', '-- Kalpesh', 'html'), '<p>hello</p><br><br>-- Kalpesh');
});

test('buildMessageId: local part is mcp-mailman-branded, domain from sender, RFC-shaped', () => {
  const id = buildMessageId('kalpesh@indianic.com');
  assert.match(id, /^<mcp-mailman\.[0-9a-f-]{36}@indianic\.com>$/);
});

test('buildMessageId: falls back to a literal domain when the address is malformed', () => {
  const id = buildMessageId('not-an-email');
  assert.match(id, /^<mcp-mailman\.[0-9a-f-]{36}@mcp-mailman\.local>$/);
});

test('buildMessageId: unique per call', () => {
  assert.notEqual(buildMessageId('a@b.com'), buildMessageId('a@b.com'));
});

test('mailmanHeaders: brands X-Mailer', () => {
  assert.deepEqual(mailmanHeaders(), { 'X-Mailer': 'mcp-mailman' });
});
