import { test } from 'node:test';
import assert from 'node:assert/strict';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { buildMailOptions } from '../src/auth/app-password.js';
import { buildRawMessage } from '../src/mail/gmail-api-client.js';

/**
 * Bcc has exactly one job: the address receives the mail and no other recipient
 * learns it exists. Nothing else in the suite would notice that breaking, and
 * the failure is invisible from the sending side — you find out when a
 * recipient tells you they can see who you copied privately, by which point
 * every campaign and every draft_email send has already leaked.
 *
 * The two transports legitimately differ, which is what makes this worth
 * pinning rather than assuming:
 *
 *  - **SMTP (app-password).** nodemailer leaves `keepBcc` false, so `Bcc:` is
 *    stripped from DATA and the address rides only in the envelope (RCPT TO).
 *  - **Gmail API (oauth2).** `buildRawMessage` composes through
 *    `streamTransport`, which sets `keepBcc = true` deliberately — the API has
 *    no envelope, so the header IS how Gmail is told to deliver the Bcc. Gmail
 *    then removes it from the copies it delivers.
 *
 * Reading a Bcc header in the built Gmail-API message therefore proves nothing
 * is broken. Reading one in the SMTP message would.
 */

function smtpHeaders(options: Record<string, unknown>): Promise<string> {
  // Compiled the same way the SMTP transport compiles it: keepBcc untouched.
  const node = new MailComposer(options).compile();
  return new Promise((resolve, reject) => {
    node.build((err: Error | null, buf: Buffer) =>
      err ? reject(err) : resolve(buf.toString('utf8').split(/\r?\n\r?\n/)[0]),
    );
  });
}

const message = {
  to: ['recipient@example.com'],
  cc: ['visible@example.com'],
  bcc: ['secret@example.com'],
  subject: 's',
  body: 'b',
  bodyType: 'text' as const,
};

test('buildMailOptions hands the bcc to the transport at all', () => {
  // The regression before this one: a bcc that never reaches nodemailer is a
  // bcc that silently goes nowhere.
  const options = buildMailOptions({ user: 'me@example.com', pass: 'x' }, message);
  assert.equal(options.bcc, 'secret@example.com');
});

test('SMTP: the Bcc address is in the envelope but NOT in the delivered headers', async () => {
  const options = buildMailOptions({ user: 'me@example.com', pass: 'x' }, message);
  const headers = await smtpHeaders(options as unknown as Record<string, unknown>);

  assert.doesNotMatch(headers, /^Bcc:/im, 'a Bcc header in DATA is visible to every recipient');
  assert.doesNotMatch(headers, /secret@example\.com/, 'the bcc address must not appear anywhere in the headers');
  // Still addressed correctly to the people who are meant to be visible.
  assert.match(headers, /^To: recipient@example\.com/im);
  assert.match(headers, /^Cc: visible@example\.com/im);
});

test('SMTP: the bcc still actually receives it — envelope carries all three', async () => {
  const options = buildMailOptions({ user: 'me@example.com', pass: 'x' }, message);
  const envelope = new MailComposer(options as unknown as Record<string, unknown>).compile().getEnvelope();
  assert.deepEqual(envelope.to.sort(), ['recipient@example.com', 'secret@example.com', 'visible@example.com']);
});

test('Gmail API: the Bcc header IS present, because the API has no envelope to carry it', async () => {
  const { raw } = await buildRawMessage('me@example.com', message);
  const headers = Buffer.from(raw, 'base64url').toString('utf8').split(/\r?\n\r?\n/)[0];
  // Gmail strips this before delivering; without it the bcc recipient gets nothing.
  assert.match(headers, /^Bcc: secret@example\.com/im);
});

test('neither transport invents a Bcc when none was asked for', async () => {
  const options = buildMailOptions({ user: 'me@example.com', pass: 'x' }, { ...message, bcc: undefined });
  assert.doesNotMatch(await smtpHeaders(options as unknown as Record<string, unknown>), /^Bcc:/im);

  const { raw } = await buildRawMessage('me@example.com', { ...message, bcc: undefined });
  assert.doesNotMatch(Buffer.from(raw, 'base64url').toString('utf8'), /^Bcc:/im);
});
