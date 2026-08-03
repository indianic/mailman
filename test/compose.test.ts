import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatFromAddress, appendSignature, escapeHtml, buildMessageId, mailmanHeaders } from '../src/mail/compose.js';

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
