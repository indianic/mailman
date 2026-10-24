import { test } from 'node:test';
import assert from 'node:assert/strict';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { appendSignature, renderSignaturePreview } from '../src/mail/compose.js';
import { buildMailOptions } from '../src/auth/app-password.js';
import { draftEmailTool, composeWarnings } from '../src/tools/draft-email.js';
import { updateAccountProfileTool } from '../src/tools/update-account-profile.js';
import { getDraft } from '../src/drafts.js';
import { configureAccount, updateAccountProfile, listAccounts } from '../src/accounts.js';
import { updateSettings } from '../src/settings.js';
import { withIsolatedConfig } from './support/isolate.js';

/**
 * The full body-type × signature-type matrix, pinned end-to-end.
 *
 * Two of these cells put broken output in front of real recipients before any
 * test covered them: an HTML signature escaped into literal `<table
 * cellpadding="0">` text on an HTML send (fixed in 1.7.0, re-pinned here down
 * to the MIME bytes), and the same signature pasted raw into a text/plain body
 * (fixed now — it gets the same readable conversion the alternative part of an
 * HTML send gets). The failure mode is invisible from the sending side, which
 * is exactly why every cell asserts on what nodemailer will actually put on
 * the wire, not just on the composed string.
 */

// Trimmed from the real signature that triggered the incident: table layout,
// inline styles, an hr, a link and an image.
const HTML_SIG =
  '<hr style="border:none;border-top:1px solid #ddd">' +
  '<table cellpadding="0"><tr><td><b>Kalpesh Gamit</b><br>' +
  '<a href="https://www.indianic.com">IndiaNIC</a></td></tr></table>';

const TEXT_SIG = 'Thanks & Regards,\nKalpesh <kg@example.com>';

/** Compile exactly as the SMTP transport would, returning the raw MIME string. */
function compileMime(options: Record<string, unknown>): Promise<string> {
  const node = new MailComposer(options).compile();
  return new Promise((resolve, reject) => {
    node.build((err: Error | null, buf: Buffer) => (err ? reject(err) : resolve(buf.toString('utf8'))));
  });
}

async function mimeFor(body: string, bodyType: 'text' | 'html'): Promise<string> {
  const options = buildMailOptions(
    { user: 'me@example.com', pass: 'x' },
    { to: ['to@example.com'], subject: 's', body, bodyType },
  );
  return compileMime(options as unknown as Record<string, unknown>);
}

test('matrix: html body + html signature — markup renders, never escaped', async () => {
  const body = appendSignature('<p>hello</p>', HTML_SIG, 'html');
  assert.match(body, /<table cellpadding="0">/);
  assert.match(body, /<hr style="/);
  assert.doesNotMatch(body, /&lt;table|&lt;hr/, 'the 1.7.0 regression: signature markup escaped into view');

  const mime = await mimeFor(body, 'html');
  assert.match(mime, /multipart\/alternative/);
  // QP encoding can split any literal across lines — strip soft breaks first.
  const decoded = mime.replace(/=\r?\n/g, '').replace(/=3D/g, '=');
  assert.match(decoded, /<table cellpadding="0">/);
  assert.doesNotMatch(decoded, /&lt;table/);
  // The text/plain alternative carries a readable signature, not markup.
  assert.match(decoded, /Kalpesh Gamit/);
  assert.match(mime, /text\/plain/);
});

test('matrix: text body + html signature — converted to a readable text fallback', async () => {
  const body = appendSignature('hello', HTML_SIG, 'text');
  assert.doesNotMatch(body, /<[a-z]/i, 'raw markup in a text/plain body is the bug this fixes');
  assert.match(body, /Kalpesh Gamit/);
  // Links survive as URLs.
  assert.match(body, /https:\/\/www\.indianic\.com/);

  const mime = await mimeFor(body, 'text');
  assert.match(mime, /Content-Type: text\/plain/);
  assert.doesNotMatch(mime, /text\/html/);
  assert.doesNotMatch(mime.replace(/=\r?\n/g, ''), /<table|&lt;table/);
});

test('matrix: text body + text signature — appended verbatim', async () => {
  const body = appendSignature('hello', TEXT_SIG, 'text');
  assert.equal(body, `hello\n\n${TEXT_SIG}`);
  const mime = await mimeFor(body, 'text');
  assert.match(mime, /Content-Type: text\/plain/);
});

test('matrix: html body + text signature — escaped, newlines become <br>', async () => {
  const body = appendSignature('<p>hello</p>', TEXT_SIG, 'html');
  assert.match(body, /Thanks &amp; Regards,<br>Kalpesh &lt;kg@example\.com&gt;/);

  const decoded = (await mimeFor(body, 'html')).replace(/=\r?\n/g, '');
  // The address must survive into the delivered HTML as visible text.
  assert.match(decoded, /&lt;kg@example\.com&gt;/);
});

test('matrix: signature cleared — body goes out untouched on both body types', async () => {
  assert.equal(appendSignature('<p>hello</p>', undefined, 'html'), '<p>hello</p>');
  assert.equal(appendSignature('hello', undefined, 'text'), 'hello');
  assert.equal(appendSignature('hello', '', 'text'), 'hello');
});

test('a declared signatureType wins over detection in both directions', () => {
  // Markup-looking prose declared text: shown literally, as declared.
  const literal = appendSignature('<p>hi</p>', 'I fix <table> layouts', 'html', 'text');
  assert.match(literal, /&lt;table&gt;/);
  // Declared html with no allowlisted tag: passed through, not escaped+<br>'d.
  const declaredHtml = appendSignature('<p>hi</p>', 'plain looking', 'html', 'html');
  assert.equal(declaredHtml, '<p>hi</p><br><br>plain looking');
});

test('renderSignaturePreview matches what appendSignature will actually emit', () => {
  const preview = renderSignaturePreview(HTML_SIG);
  assert.equal(preview.signatureType, 'html');
  assert.equal(`x<br><br>${preview.renderedHtml}`, appendSignature('x', HTML_SIG, 'html'));
  assert.equal(`x\n\n${preview.renderedText}`, appendSignature('x', HTML_SIG, 'text'));

  const textPreview = renderSignaturePreview(TEXT_SIG);
  assert.equal(textPreview.signatureType, 'text');
  assert.equal(textPreview.renderedText, TEXT_SIG);
});

// --- composition warnings -------------------------------------------------

test('warnings: HTML signature on a text send is flagged', () => {
  const warnings = composeWarnings('hello', 'text', HTML_SIG);
  assert.equal(warnings.length >= 1, true);
  assert.match(warnings.join(' '), /bodyType "html"/);
});

test('warnings: plain-text-looking body sent as html is flagged (the paragraph-blob send)', () => {
  const warnings = composeWarnings('Hi team,\n\n- point one\n- point two', 'html', undefined);
  assert.match(warnings.join(' '), /newlines collapse|run-on/);
});

test('warnings: markdown in an html body is flagged', () => {
  const warnings = composeWarnings('<p>Hi</p>\n**important** stuff', 'html', undefined);
  assert.match(warnings.join(' '), /Markdown/);
});

test('warnings: a well-formed html body with html signature is clean', () => {
  assert.deepEqual(composeWarnings('<p>Hi<br>there</p>', 'html', HTML_SIG, 'html'), []);
});

// --- through the tool surface ----------------------------------------------

const parse = (res: { content: Array<{ text: string }> }) => JSON.parse(res.content[0].text);

async function withAccount(fn: () => Promise<void>, signature?: string): Promise<void> {
  await withIsolatedConfig(async () => {
    await configureAccount({
      alias: 'w',
      email: 'me@example.com',
      method: 'app-password',
      credentials: { user: 'me@example.com', pass: 'aaaa bbbb cccc dddd' },
      signature,
    });
    await fn();
  });
}

test('draft_email preview shows the final composed body and warns on the broken combination', async () => {
  await withAccount(async () => {
    const res = parse(await draftEmailTool.handler({
      to: ['a@b.com'], subject: 's', body: 'hello', bodyType: 'text',
    }));
    // finalBody is the draft body — signature fallback included, unlike bodyPreview.
    assert.match(res.preview.finalBody, /Kalpesh Gamit/);
    assert.doesNotMatch(res.preview.finalBody, /<table/);
    assert.equal(getDraft(res.draftId)!.body, res.preview.finalBody);
    assert.match((res.preview.warnings ?? []).join(' '), /signature is HTML/);
  }, HTML_SIG);
});

test('draft_email preview finalBody is capped, and says so', async () => {
  await withAccount(async () => {
    const res = parse(await draftEmailTool.handler({
      to: ['a@b.com'], subject: 's', body: `<p>${'x'.repeat(9000)}</p>`, bodyType: 'html', theme: 'plain',
    }));
    assert.equal(res.preview.finalBodyTruncated, true);
    assert.equal(res.preview.finalBody.length <= 6001, true);
  });
});

test('configureAccount records the detected signatureType at save time', async () => {
  await withAccount(async () => {
    const [account] = await listAccounts();
    assert.equal(account.signatureType, 'html');
  }, HTML_SIG);
});

test('clearing the signature clears its type with it', async () => {
  await withAccount(async () => {
    const updated = await updateAccountProfile('w', { signature: null });
    assert.equal(updated.signature, undefined);
    assert.equal(updated.signatureType, undefined);
  }, HTML_SIG);
});

test('update_account_profile rejects the literal string "null" instead of storing it', async () => {
  await withAccount(async () => {
    const res = parse(await updateAccountProfileTool.handler({ alias: 'w', signature: 'null' }));
    assert.equal(res.code, 'INVALID_INPUT');
    assert.match(res.message, /JSON null/);
    // Nothing was written.
    const [account] = await listAccounts();
    assert.equal(account.signature, HTML_SIG);
  }, HTML_SIG);
});

test('update_account_profile returns a test-render of the stored signature', async () => {
  await withAccount(async () => {
    const res = parse(await updateAccountProfileTool.handler({ alias: 'w', signature: HTML_SIG }));
    assert.equal(res.signatureType, 'html');
    assert.match(res.signaturePreview.renderedHtml, /<table cellpadding="0">/);
    assert.match(res.signaturePreview.renderedText, /Kalpesh Gamit/);
    assert.doesNotMatch(res.signaturePreview.renderedText, /<[a-z]/i);
  });
});

test('update_account_profile warns when the declared type contradicts the content', async () => {
  await withAccount(async () => {
    const res = parse(await updateAccountProfileTool.handler({
      alias: 'w', signature: HTML_SIG, signatureType: 'text',
    }));
    assert.match((res.warnings ?? []).join(' '), /show literally/);
    // Stored as declared — the warning informs, the caller decides.
    const [account] = await listAccounts();
    assert.equal(account.signatureType, 'text');
  });
});

// --- autoBccSelf ------------------------------------------------------------

test('autoBccSelf: off by default — no invented Bcc', async () => {
  await withAccount(async () => {
    const res = parse(await draftEmailTool.handler({ to: ['a@b.com'], subject: 's', body: 'b' }));
    assert.deepEqual(getDraft(res.draftId)!.bcc, []);
  });
});

test('autoBccSelf: when enabled, the sending account rides in Bcc and the preview says so', async () => {
  await withAccount(async () => {
    await updateSettings((s) => ({ ...s, autoBccSelf: true }));
    const res = parse(await draftEmailTool.handler({ to: ['a@b.com'], subject: 's', body: 'b' }));
    assert.deepEqual(getDraft(res.draftId)!.bcc, ['me@example.com']);
    assert.equal(res.preview.autoBccSelf, true);
    assert.deepEqual(res.preview.bcc, ['me@example.com']);
  });
});

test('autoBccSelf: skipped when the sender is already a recipient — no duplicate copy', async () => {
  await withAccount(async () => {
    await updateSettings((s) => ({ ...s, autoBccSelf: true }));
    const res = parse(await draftEmailTool.handler({
      to: ['a@b.com'], cc: ['ME@example.com'], subject: 's', body: 'b',
    }));
    assert.deepEqual(getDraft(res.draftId)!.bcc, []);
    assert.equal(res.preview.autoBccSelf, undefined);
  });
});

test('autoBccSelf: an explicit bcc list is extended, not replaced', async () => {
  await withAccount(async () => {
    await updateSettings((s) => ({ ...s, autoBccSelf: true }));
    const res = parse(await draftEmailTool.handler({
      to: ['a@b.com'], bcc: ['archive@example.com'], subject: 's', body: 'b',
    }));
    assert.deepEqual(getDraft(res.draftId)!.bcc.sort(), ['archive@example.com', 'me@example.com']);
  });
});
