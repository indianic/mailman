import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatFromAddress,
  appendSignature,
  escapeHtml,
  buildMessageId,
  mailmanHeaders,
  looksLikeHtmlSignature,
} from '../src/mail/compose.js';

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

/**
 * The signature is a plain-text field — `--signature "Regards,\nKalpesh"` stores
 * a real newline (docs/CLI.md). Pasted into HTML verbatim it broke two ways, and
 * the case above never caught either: "-- Kalpesh" has no newline and no markup
 * character in it.
 */
test('appendSignature: a multi-line signature keeps its line breaks in HTML', () => {
  // Whitespace collapses in HTML, so this used to render as one run-on line:
  // "Regards, Kalpesh Gamit IndiaNIC".
  const sig = 'Regards,\nKalpesh Gamit\nIndiaNIC';
  assert.equal(
    appendSignature('<p>hi</p>', sig, 'html'),
    '<p>hi</p><br><br>Regards,<br>Kalpesh Gamit<br>IndiaNIC',
  );
  // Text bodies keep real newlines — nothing to convert there.
  assert.equal(appendSignature('hi', sig, 'text'), `hi\n\n${sig}`);
});

test('appendSignature: CRLF and CR signatures break the same as LF', () => {
  const expected = '<p>hi</p><br><br>a<br>b';
  for (const sig of ['a\nb', 'a\r\nb', 'a\rb']) {
    assert.equal(appendSignature('<p>hi</p>', sig, 'html'), expected, JSON.stringify(sig));
  }
});

test('appendSignature: markup characters in a signature survive instead of vanishing', () => {
  // `<kalpesh@indianic.com>` used to disappear completely — the browser read it
  // as an unknown tag. Silent loss of content in every outgoing email.
  const out = appendSignature('<p>hi</p>', 'Kalpesh <kalpesh@indianic.com>', 'html');
  assert.match(out, /Kalpesh &lt;kalpesh@indianic\.com&gt;/);
  assert.doesNotMatch(out, /<kalpesh@/);

  // An ampersand was an invalid HTML entity, not an ampersand.
  assert.match(appendSignature('<p>hi</p>', 'Sales & Marketing', 'html'), /Sales &amp; Marketing/);

  // Escaping happens BEFORE newline conversion, or the <br> would be escaped too.
  assert.equal(appendSignature('x', 'a & b\nc', 'html'), 'x<br><br>a &amp; b<br>c');
});

test('appendSignature: a signature cannot inject markup into the email', () => {
  // The signature is config, not remote input, so this is mainly a correctness
  // guarantee — but a stored signature must not be able to close the surrounding
  // card or open a tag that swallows the footer.
  const out = appendSignature('<p>hi</p>', '</div><script>alert(1)</script>', 'html');
  assert.doesNotMatch(out, /<script>/);
  assert.doesNotMatch(out, /<\/div>/);
  assert.match(out, /&lt;script&gt;/);
});

/**
 * A signature written as HTML — which is what people paste, because it is what
 * their mail client hands them. Escaping it wholesale put a wall of `&lt;br&gt;`
 * in front of four colleagues on the first real campaign; these tests pin the
 * fix without giving up any guarantee above.
 */
test('appendSignature: an HTML signature renders instead of showing its tags', () => {
  const sig = '---<br><i>Thanks &amp; Regards<br>Kalpesh Gamit</i><br><b>IndiaNIC</b>';
  const out = appendSignature('<p>hi</p>', sig, 'html');
  assert.equal(out, `<p>hi</p><br><br>${sig}`);
  assert.doesNotMatch(out, /&lt;br&gt;|&lt;i&gt;/);
  // An existing entity stays one entity — never double-escaped to &amp;amp;.
  assert.doesNotMatch(out, /&amp;amp;/);
});

test('appendSignature: a plain-text signature is still escaped exactly as before', () => {
  // The regression that matters most: HTML detection must not change the
  // behaviour of the field's documented plain-text form.
  assert.equal(appendSignature('x', 'a & b\nc', 'html'), 'x<br><br>a &amp; b<br>c');
  assert.match(appendSignature('<p>hi</p>', 'Kalpesh <kalpesh@indianic.com>', 'html'), /&lt;kalpesh@indianic\.com&gt;/);
});

test('appendSignature: an address in angle brackets is not mistaken for a tag', () => {
  // `<sub@…>` and `<a@…>` name real allowlisted tags. A loose matcher would
  // read them as elements and delete the address — the exact silent loss the
  // escaping was introduced to fix.
  for (const sig of ['Kalpesh <sub@indianic.com>', 'Ann <a@indianic.com>', 'Bob <b@indianic.com>']) {
    const out = appendSignature('<p>hi</p>', sig, 'html');
    assert.match(out, /&lt;(sub|a|b)@indianic\.com&gt;/, sig);
  }
});

/**
 * Layout tags used to be banned outright, so an unbalanced `</div>` could not
 * close the polished card and swallow the footer. A photo beside text needs a
 * table, so they are allowed now — and the guarantee is enforced properly
 * instead of avoided: the output is always balanced.
 */
test('appendSignature: a table signature survives, because email layout needs one', () => {
  const sig = '<table><tr><td><img src="cid:mailman-signature" alt="me"></td><td><b>Name</b></td></tr></table>';
  const out = appendSignature('<p>hi</p>', sig, 'html');
  assert.match(out, /<table><tr><td><img src="cid:mailman-signature" alt="me"><\/td>/);
  assert.match(out, /<b>Name<\/b>/);
});

test('appendSignature: a stray close tag is dropped, never emitted', () => {
  // The original fear, made impossible: this `</div>` has no matching open, so
  // it cannot reach the card wrapping the email.
  const out = appendSignature('<p>hi</p>', '<i>ok</i></div>', 'html');
  assert.match(out, /<i>ok<\/i>/);
  assert.doesNotMatch(out, /<\/div>/, 'a close with no open must not escape into the email');
});

test('appendSignature: unclosed tags are closed for you', () => {
  const out = appendSignature('<p>hi</p>', '<div><b>dangling', 'html');
  assert.match(out, /<div><b>dangling<\/b><\/div>$/, 'everything left open is closed at the end');
});

test('appendSignature: crossed tags are untangled rather than passed through', () => {
  // `<b><i></b>` would leave <i> open and italicise the rest of the message.
  const out = appendSignature('x', '<b><i>both</b>after', 'html');
  assert.doesNotMatch(out.split('<br><br>')[1], /<i>[^<]*$/, 'no tag may still be open at the end');
  assert.ok(
    (out.match(/<i>/g) ?? []).length === (out.match(/<\/i>/g) ?? []).length,
    `unbalanced <i> in: ${out}`,
  );
});

test('appendSignature: script and event handlers never survive an HTML signature', () => {
  const out = appendSignature('<p>hi</p>', '<b>hi</b><script>alert(1)</script>', 'html');
  assert.doesNotMatch(out, /<script>/);
  assert.match(out, /&lt;script&gt;/);

  const handler = appendSignature('<p>hi</p>', '<img src="x" onerror="alert(1)">', 'html');
  assert.doesNotMatch(handler, /onerror/, 'unlisted attributes are dropped, not carried');
  assert.match(handler, /<img src="x">/);
});

test('appendSignature: a javascript: link in a signature is stripped, a real one kept', () => {
  const bad = appendSignature('x', '<a href="javascript:alert(1)">click</a>', 'html');
  assert.doesNotMatch(bad, /javascript:/);
  assert.match(bad, /<a>click<\/a>/);

  const good = appendSignature('x', '<a href="https://indianic.com">IndiaNIC</a>', 'html');
  assert.match(good, /<a href="https:\/\/indianic\.com">IndiaNIC<\/a>/);

  // Inline logos arrive as data:image and are legitimate.
  const logo = appendSignature('x', '<img src="data:image/png;base64,AAA">', 'html');
  assert.match(logo, /data:image\/png/);
});

test('looksLikeHtmlSignature: distinguishes markup from prose that merely has angle brackets', () => {
  assert.equal(looksLikeHtmlSignature('Regards,<br>Kalpesh'), true);
  assert.equal(looksLikeHtmlSignature('<i>Kalpesh</i>'), true);
  assert.equal(looksLikeHtmlSignature('Regards,\nKalpesh'), false);
  assert.equal(looksLikeHtmlSignature('Kalpesh <kalpesh@indianic.com>'), false);
  assert.equal(looksLikeHtmlSignature('Sales & Marketing'), false);
  // Layout tags count as markup now that a table signature is supported.
  assert.equal(looksLikeHtmlSignature('<div>x</div>'), true);
  assert.equal(looksLikeHtmlSignature('<table><tr><td>x</td></tr></table>'), true);
  // Still not a tag, so an address in angle brackets stays plain text.
  assert.equal(looksLikeHtmlSignature('Kalpesh <td@indianic.com>'), false);
});

test('escapeHtml: covers the five characters that change meaning in markup', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  // Ampersand first, or the other escapes get double-escaped.
  assert.equal(escapeHtml('<a & b>'), '&lt;a &amp; b&gt;');
  assert.equal(escapeHtml('nothing to do'), 'nothing to do');
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
