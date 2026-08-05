import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import nodemailer from 'nodemailer';
import { signatureInlineImages, SIGNATURE_IMAGE_CID } from '../src/mail/compose.js';
import { buildMailOptions } from '../src/auth/app-password.js';
import { configureAccount, resolveAccount, setSignatureImage, MAX_SIGNATURE_IMAGE_BYTES } from '../src/accounts.js';
import { withIsolatedConfig } from './support/isolate.js';

/**
 * A signature photo referenced by URL is blocked by default in Gmail and
 * Outlook, so the first email anyone gets from you shows a gap where your face
 * should be. Attached inline by Content-ID it always renders — that is the
 * whole reason this exists, and the tests below pin the parts that would fail
 * silently: attaching when it is not needed, or not attaching when it is.
 */

const BODY_WITH_PHOTO = `<p>hi</p><img src="cid:${SIGNATURE_IMAGE_CID}">`;

test('signatureInlineImages: attaches when the body references the cid', () => {
  const out = signatureInlineImages({ signatureImage: '/tmp/me.png' }, BODY_WITH_PHOTO, 'html');
  assert.deepEqual(out, [{ cid: SIGNATURE_IMAGE_CID, path: '/tmp/me.png' }]);
});

test('signatureInlineImages: no photo configured means nothing to attach', () => {
  assert.equal(signatureInlineImages({}, BODY_WITH_PHOTO, 'html'), undefined);
});

test('signatureInlineImages: a body that does not reference it gets no mystery attachment', () => {
  // A signature edited to drop the <img>, or a send that skips the signature,
  // must not still carry 40KB and a paperclip on every message.
  assert.equal(signatureInlineImages({ signatureImage: '/tmp/me.png' }, '<p>no photo here</p>', 'html'), undefined);
});

test('signatureInlineImages: never attached to a plain-text send', () => {
  assert.equal(signatureInlineImages({ signatureImage: '/tmp/me.png' }, BODY_WITH_PHOTO, 'text'), undefined);
});

test('buildMailOptions: an inline image becomes a cid attachment, alongside real ones', async () => {
  const options = buildMailOptions(
    { user: 'me@example.com', pass: 'x' },
    {
      to: ['a@example.com'],
      subject: 's',
      body: BODY_WITH_PHOTO,
      bodyType: 'html',
      attachments: [{ path: '/tmp/report.pdf', name: 'report.pdf', mimeType: 'application/pdf' }],
      inlineImages: [{ cid: SIGNATURE_IMAGE_CID, path: '/tmp/me.png' }],
    },
  );

  assert.equal(options.attachments?.length, 2);
  const inline = options.attachments?.find((a) => 'cid' in a && a.cid === SIGNATURE_IMAGE_CID);
  assert.ok(inline, 'the signature photo must carry a cid, or it renders as a download instead of inline');
  assert.equal((inline as { path: string }).path, '/tmp/me.png');

  // Gmail lists inline images in its attachment strip whatever the sender
  // does — dropping the filename was tried and only relabelled the chip
  // "noname". So the part keeps a real filename and an explicit type, and the
  // chip is accepted as client behaviour rather than chased.
  assert.equal((inline as { filename?: string }).filename, 'me.png');
  assert.equal((inline as { contentType?: string }).contentType, 'image/png');
  assert.equal((inline as { contentDisposition?: string }).contentDisposition, 'inline');
  // The real attachment is untouched and carries no cid.
  const doc = options.attachments?.find((a) => (a as { filename?: string }).filename === 'report.pdf');
  assert.ok(doc && !('cid' in doc));
});

test('buildMailOptions: no inline images means the attachment list is just the real ones', async () => {
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const options = buildMailOptions(
    { user: 'me@example.com', pass: 'x' },
    { to: ['a@example.com'], subject: 's', body: '<p>hi</p>', bodyType: 'html' },
  );
  const info = await transport.sendMail(options);
  const sent = JSON.parse((info as unknown as { message: string }).message);
  assert.deepEqual(sent.attachments ?? [], []);
});

test('setSignatureImage: copies the file into the config dir rather than referencing it in place', async () => {
  await withIsolatedConfig(async (dir) => {
    await configureAccount({
      alias: 'x',
      email: 'x@example.com',
      method: 'app-password',
      credentials: { user: 'x@example.com', pass: 'fakepass1234567' },
    });

    // Somewhere the user happened to have it — a path that could move or vanish.
    const source = path.join(dir, 'elsewhere', 'me.png');
    await fs.mkdir(path.dirname(source), { recursive: true });
    await fs.writeFile(source, Buffer.from('89504e470d0a1a0a', 'hex'));

    const result = await setSignatureImage('x', source);
    assert.equal(path.dirname(result.path), dir, 'the copy must live in the config dir');
    assert.match(path.basename(result.path), /^signature-x\.png$/);

    const account = await resolveAccount('x');
    assert.equal(account.signatureImage, result.path);

    // Deleting the original must not break the signature.
    await fs.rm(source);
    assert.ok((await fs.stat(result.path)).isFile());
  });
});

test('setSignatureImage: rejects a non-image, a missing file, and an oversized one', async () => {
  await withIsolatedConfig(async (dir) => {
    await configureAccount({
      alias: 'x',
      email: 'x@example.com',
      method: 'app-password',
      credentials: { user: 'x@example.com', pass: 'fakepass1234567' },
    });

    const notImage = path.join(dir, 'notes.txt');
    await fs.writeFile(notImage, 'hello');
    await assert.rejects(() => setSignatureImage('x', notImage), /Unsupported signature image type/);

    await assert.rejects(() => setSignatureImage('x', path.join(dir, 'ghost.png')), /No such file/);

    const huge = path.join(dir, 'huge.png');
    await fs.writeFile(huge, Buffer.alloc(MAX_SIGNATURE_IMAGE_BYTES + 1));
    // It rides on EVERY message — the limit protects the recipient, not the disk.
    await assert.rejects(() => setSignatureImage('x', huge), /limit is 200 KB/);
  });
});
