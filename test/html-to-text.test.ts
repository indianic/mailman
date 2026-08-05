import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToPlainText, appendSignature, wrapPolished } from '../src/mail/compose.js';
import { buildMailOptions } from '../src/auth/app-password.js';

/**
 * mailman sent HTML with no text/plain alternative. It surfaced when a
 * colleague replied and his quoted copy read "Thanks & RegardsKalpesh Gamit" —
 * the receiving client had to invent a conversion and dropped the `<br>`s
 * inside the signature's `<i>` tags.
 */

test('htmlToPlainText: br and block ends become line breaks', () => {
  // A block boundary is a blank line; <br> is a single break. That is how the
  // two differ in HTML, and how a reader expects them to differ in text.
  assert.equal(htmlToPlainText('<p>one</p><p>two</p>'), 'one\n\ntwo');
  assert.equal(htmlToPlainText('a<br>b'), 'a\nb');
  assert.equal(htmlToPlainText('a<br />b'), 'a\nb');
});

test('htmlToPlainText: the exact signature case that started this', () => {
  const sig = '---------------<br><i>Thanks &amp; Regards<br>Kalpesh Gamit</i>';
  const out = htmlToPlainText(sig);
  assert.match(out, /Thanks & Regards\nKalpesh Gamit/);
  assert.doesNotMatch(out, /RegardsKalpesh/, 'the break between them must survive');
  assert.doesNotMatch(out, /&amp;/, 'entities must be decoded, not carried through');
});

test('htmlToPlainText: entities decode, and &amp; decodes last', () => {
  assert.equal(htmlToPlainText('Sales &amp; Marketing'), 'Sales & Marketing');
  assert.equal(htmlToPlainText('&lt;tag&gt;'), '<tag>');
  assert.equal(htmlToPlainText('&#39;quoted&#39;'), "'quoted'");
  assert.equal(htmlToPlainText('caf&#xe9;'), 'café');
  // Double-encoded: the author wrote a literal "&lt;", which must stay literal.
  assert.equal(htmlToPlainText('&amp;lt;'), '&lt;');
  // An unknown entity is left alone rather than silently deleted.
  assert.equal(htmlToPlainText('&notreal;'), '&notreal;');
});

test('htmlToPlainText: links keep their URL, because text cannot be clicked', () => {
  assert.equal(htmlToPlainText('<a href="https://x.com">Site</a>'), 'Site (https://x.com)');
  // No duplication when the label already is the URL.
  assert.equal(htmlToPlainText('<a href="https://x.com">https://x.com</a>'), 'https://x.com');
  assert.equal(htmlToPlainText('<a href="https://x.com"></a>'), 'https://x.com');
});

test('htmlToPlainText: style and script contents never leak into the text part', () => {
  const out = htmlToPlainText('<style>.a{color:red}</style><p>body</p><script>alert(1)</script>');
  assert.equal(out, 'body');
});

test('htmlToPlainText: list items become dashes', () => {
  assert.equal(htmlToPlainText('<ul><li>one</li><li>two</li></ul>'), '- one\n- two');
});

/**
 * Source formatting is not content. The unit tests above all used HTML written
 * on one line, so none of them saw this: a real body is indented across
 * several lines, and those newlines were surviving into the text part as blank
 * lines between every bullet. Caught by reading a delivered message, not by the
 * suite.
 */
test('htmlToPlainText: indented source does not put blank lines between bullets', () => {
  const html = `<ul>
  <li>one</li>
  <li>two</li>
  <li>three</li>
</ul>`;
  assert.equal(htmlToPlainText(html), '- one\n- two\n- three');
});

test('htmlToPlainText: indented paragraphs still get exactly one blank line', () => {
  assert.equal(htmlToPlainText('<p>a</p>\n<p>b</p>'), 'a\n\nb');
  assert.equal(htmlToPlainText('<div>\n  <p>a</p>\n  <p>b</p>\n</div>'), 'a\n\nb');
});

test('htmlToPlainText: a line break BETWEEN inline tags is still a word gap', () => {
  // The whitespace collapses to a space rather than vanishing — otherwise
  // "bold italic" would come out as "bolditalic".
  assert.equal(htmlToPlainText('<b>bold</b>\n<i>italic</i>'), 'bold italic');
  assert.equal(htmlToPlainText('<span>a</span> <span>b</span>'), 'a b');
});

test('htmlToPlainText: images reduce to their alt text', () => {
  assert.equal(htmlToPlainText('<img src="x.png" alt="Logo">'), 'Logo');
  assert.equal(htmlToPlainText('<img src="x.png">'), '');
});

test('htmlToPlainText: blank runs are capped, not multiplied by nesting', () => {
  const out = htmlToPlainText('<div><div><p>a</p></div></div><div><div><p>b</p></div></div>');
  assert.doesNotMatch(out, /\n{3,}/, 'nesting must not multiply blank lines');
  assert.equal(out, 'a\n\nb', 'two paragraphs, one blank line — regardless of how deeply wrapped');
});

test('htmlToPlainText: a real polished send reads sensibly', () => {
  const body = wrapPolished(appendSignature('<p>Hi Yash,</p><p>The demo is Thursday.</p>', 'Regards,\nKalpesh', 'html'));
  const out = htmlToPlainText(body);
  assert.match(out, /Hi Yash,/);
  assert.match(out, /The demo is Thursday\./);
  assert.match(out, /Regards,\nKalpesh/);
  // The footer's link survives as something a text reader can use.
  assert.match(out, /mailman\.indianic\.dev/);
  assert.doesNotMatch(out, /<[a-z]/i, 'no markup may survive into the text part');
  assert.doesNotMatch(out, /max-width|font-family/, 'no CSS may survive either');
});

test('buildMailOptions: an HTML send carries BOTH parts', () => {
  const options = buildMailOptions(
    { user: 'me@example.com', pass: 'x' },
    { to: ['a@example.com'], subject: 's', body: '<p>Hi <b>there</b></p>', bodyType: 'html' },
  );
  assert.equal(options.html, '<p>Hi <b>there</b></p>');
  assert.equal(options.text, 'Hi there', 'a missing text part is what caused the mangled reply quote');
});

test('buildMailOptions: a text send is unchanged and gains no html part', () => {
  const options = buildMailOptions(
    { user: 'me@example.com', pass: 'x' },
    { to: ['a@example.com'], subject: 's', body: 'plain body', bodyType: 'text' },
  );
  assert.equal(options.text, 'plain body');
  assert.equal(options.html, undefined);
});

test('buildMailOptions: an HTML body with no readable text sends no empty text part', () => {
  const options = buildMailOptions(
    { user: 'me@example.com', pass: 'x' },
    { to: ['a@example.com'], subject: 's', body: '<img src="x.png">', bodyType: 'html' },
  );
  assert.equal(options.text, undefined, 'an empty part is worse than no part');
});
