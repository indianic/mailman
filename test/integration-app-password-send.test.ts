import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import nodemailer from 'nodemailer';
import { buildMailOptions } from '../src/auth/app-password.js';

// Integration test against nodemailer's built-in JSON transport — no
// network, no real Gmail account (see docs/PLAN.md's "Testing & CI
// strategy" section). Verifies the exact options mailman hands to
// nodemailer, round-tripped through a real (fake) transport.
test('buildMailOptions produces a message nodemailer\'s JSON transport accepts and echoes back correctly', async () => {
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const credentials = { user: 'me@example.com', pass: 'irrelevant' };

  const options = buildMailOptions(credentials, {
    to: ['a@example.com', 'b@example.com'],
    cc: ['c@example.com'],
    subject: 'Hello',
    body: 'Plain text body',
    bodyType: 'text',
  });

  const info = await transport.sendMail(options);
  const sent = JSON.parse((info as unknown as { message: string }).message);

  assert.equal(sent.from.address, 'me@example.com');
  assert.deepEqual(
    sent.to.map((a: { address: string }) => a.address),
    ['a@example.com', 'b@example.com'],
  );
  assert.equal(sent.cc[0].address, 'c@example.com');
  assert.equal(sent.subject, 'Hello');
  assert.equal(sent.text, 'Plain text body');
  assert.equal(sent.html, undefined);
  // mailman branding actually reaches the wire, not just the options object.
  assert.match(sent.messageId, /^<mcp-mailman\..*@example\.com>$/);
  assert.equal(sent.headers['x-mailer'] ?? sent.headers['X-Mailer'], 'mcp-mailman');
});

test('buildMailOptions sets a "Name <email>" From when fromDisplayName is set', async () => {
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const options = buildMailOptions(
    { user: 'me@example.com', pass: 'irrelevant' },
    { to: ['a@example.com'], subject: 'Hi', body: 'hello', fromDisplayName: 'Kalpesh Gamit' },
  );

  const info = await transport.sendMail(options);
  const sent = JSON.parse((info as unknown as { message: string }).message);
  assert.equal(sent.from.name, 'Kalpesh Gamit');
  assert.equal(sent.from.address, 'me@example.com');
});

test('buildMailOptions sends HTML body under `html`, not `text`', async () => {
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const options = buildMailOptions(
    { user: 'me@example.com', pass: 'irrelevant' },
    { to: ['a@example.com'], subject: 'Hi', body: '<b>bold</b>', bodyType: 'html' },
  );

  const info = await transport.sendMail(options);
  const sent = JSON.parse((info as unknown as { message: string }).message);
  assert.equal(sent.html, '<b>bold</b>');
  assert.equal(sent.text, undefined);
});

test('buildMailOptions maps attachments to nodemailer\'s filename/path/contentType shape', async () => {
  const filePath = path.join(os.tmpdir(), 'mailman-integration-report.pdf');
  await fs.writeFile(filePath, '%PDF-1.4 fake content');

  const transport = nodemailer.createTransport({ jsonTransport: true });
  const options = buildMailOptions(
    { user: 'me@example.com', pass: 'irrelevant' },
    {
      to: ['a@example.com'],
      subject: 'Files',
      body: 'see attached',
      attachments: [{ path: filePath, name: 'report.pdf', mimeType: 'application/pdf' }],
    },
  );

  assert.deepEqual(options.attachments, [{ filename: 'report.pdf', path: filePath, contentType: 'application/pdf' }]);

  // Confirm nodemailer itself accepts and processes this shape without complaint.
  const info = await transport.sendMail(options);
  const sent = JSON.parse((info as unknown as { message: string }).message);
  assert.equal(sent.attachments[0].filename, 'report.pdf');
  assert.equal(sent.attachments[0].contentType, 'application/pdf');

  await fs.unlink(filePath);
});

/**
 * The App Password / SMTP half of threading. Round-tripped through nodemailer's
 * JSON transport so this asserts what nodemailer actually emits, not just the
 * options object mailman built.
 */
test('buildMailOptions threads a reply via In-Reply-To and References', async () => {
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const parent = '<CAF=abc123@mail.gmail.com>';

  const info = await transport.sendMail(
    buildMailOptions(
      { user: 'me@example.com', pass: 'irrelevant' },
      {
        to: ['sandeep@indianic.com'],
        subject: 'Re: mailman on headless Linux',
        body: 'done',
        inReplyTo: parent,
        references: [parent],
      },
    ),
  );

  const sent = JSON.parse(info.message as unknown as string);
  assert.equal(sent.inReplyTo, parent);
  // nodemailer normalises `references` to a space-joined string per RFC 5322.
  assert.equal(typeof sent.references === 'string' ? sent.references : sent.references.join(' '), parent);
});

test('buildMailOptions leaves the threading headers unset on a fresh message', async () => {
  const options = buildMailOptions(
    { user: 'me@example.com', pass: 'irrelevant' },
    { to: ['a@example.com'], subject: 'fresh', body: 'hello' },
  );
  // undefined, not '' — an empty In-Reply-To is malformed and would thread the
  // message under nothing.
  assert.equal(options.inReplyTo, undefined);
  assert.equal(options.references, undefined);
});
