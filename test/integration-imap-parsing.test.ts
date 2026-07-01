import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeId,
  decodeId,
  formatAddress,
  parseSimpleQuery,
  structureHasAttachments,
  findFirstPartByType,
  collectAttachments,
  extractSnippetFromTextSection,
} from '../src/mail/imap-client.js';

// Integration test against realistic imapflow-shaped fixtures — no
// network, no real IMAP server (see docs/PLAN.md's "Testing & CI
// strategy" section). Exercises the exact mapping logic ImapSmtpProvider
// runs on a real FETCH response.

test('encodeId/decodeId round-trip a mailbox path + UID, surviving special characters', () => {
  const id = encodeId('[Gmail]/Sent Mail', 42);
  assert.deepEqual(decodeId(id), { mailboxPath: '[Gmail]/Sent Mail', uid: 42 });
});

test('decodeId rejects a non-IMAP id (e.g. a Gmail API message id)', () => {
  assert.throws(() => decodeId('18c9f2a1b2c3d4e5'));
});

test('formatAddress prefers "Name <email>" when a display name is present', () => {
  assert.equal(formatAddress({ name: 'Alice Jones', address: 'alice@example.com' }), 'Alice Jones <alice@example.com>');
  assert.equal(formatAddress({ address: 'alice@example.com' }), 'alice@example.com');
  assert.equal(formatAddress({}), '');
});

test('parseSimpleQuery maps recognized tokens and folds the rest into a text search', () => {
  const search = parseSimpleQuery('from:boss@example.com subject:quarterly report after:2026-01-01');
  assert.equal(search.from, 'boss@example.com');
  assert.equal(search.subject, 'quarterly');
  assert.equal(search.since, '2026-01-01');
  assert.equal(search.text, 'report');
});

// A realistic multipart/mixed structure: multipart/alternative (text+html)
// plus one PDF attachment — the shape Gmail actually returns via IMAP.
const REALISTIC_STRUCTURE = {
  type: 'multipart/mixed',
  childNodes: [
    {
      type: 'multipart/alternative',
      childNodes: [
        { type: 'text/plain', part: '1.1', size: 42 },
        { type: 'text/html', part: '1.2', size: 88 },
      ],
    },
    {
      type: 'application/pdf',
      part: '2',
      size: 51200,
      disposition: 'attachment',
      dispositionParameters: { filename: 'invoice.pdf' },
    },
  ],
};

test('structureHasAttachments detects a nested attachment part', () => {
  assert.equal(structureHasAttachments(REALISTIC_STRUCTURE), true);
  assert.equal(structureHasAttachments({ type: 'text/plain', size: 10 }), false);
});

test('findFirstPartByType locates the right sub-part id for text/plain and text/html', () => {
  assert.equal(findFirstPartByType(REALISTIC_STRUCTURE, 'text/plain'), '1.1');
  assert.equal(findFirstPartByType(REALISTIC_STRUCTURE, 'text/html'), '1.2');
  assert.equal(findFirstPartByType(REALISTIC_STRUCTURE, 'image/png'), undefined);
});

test('collectAttachments pulls name/size/mimeType from the attachment part only', () => {
  const attachments = collectAttachments(REALISTIC_STRUCTURE);
  assert.deepEqual(attachments, [{ name: 'invoice.pdf', sizeBytes: 51200, mimeType: 'application/pdf' }]);
});

test('extractSnippetFromTextSection strips MIME boundary/header noise from the raw TEXT section', () => {
  const raw = Buffer.from(
    [
      '--boundary123',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 7bit',
      '',
      'Hello, this is the actual message body.',
      '--boundary123--',
    ].join('\n'),
  );
  const snippet = extractSnippetFromTextSection(raw);
  assert.equal(snippet, 'Hello, this is the actual message body.');
});

test('extractSnippetFromTextSection returns an empty string when no TEXT section was fetched', () => {
  assert.equal(extractSnippetFromTextSection(undefined), '');
});
