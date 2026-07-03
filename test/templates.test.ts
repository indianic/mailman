import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMPLATES,
  CORE_KEYS,
  getTemplate,
  listTemplates,
  listCategories,
  applySubjectPrefix,
  buildForwardedBody,
} from '../src/mail/templates.js';
import { wrapPolished } from '../src/mail/compose.js';

test('catalog has 177+ templates with unique keys', () => {
  assert.ok(TEMPLATES.length >= 177, `expected 177+, got ${TEMPLATES.length}`);
  const keys = new Set(TEMPLATES.map((t) => t.key));
  assert.equal(keys.size, TEMPLATES.length, 'template keys must be unique');
});

test('every template has the required shape', () => {
  for (const t of TEMPLATES) {
    assert.ok(t.key && t.category && typeof t.subjectPrefix === 'string' && t.hint, `bad template: ${t.key}`);
    assert.ok(t.kind === 'hint' || t.kind === 'mechanical', `bad kind: ${t.key}`);
  }
});

test('all core keys exist in the catalog', () => {
  for (const key of CORE_KEYS) assert.ok(getTemplate(key), `core key missing: ${key}`);
});

test('getTemplate is case-insensitive and trims', () => {
  assert.equal(getTemplate('  FYI ')?.key, 'fyi');
  assert.equal(getTemplate('nope'), undefined);
});

test('listTemplates filters by category and search', () => {
  const meetings = listTemplates({ category: 'meetings' });
  assert.ok(meetings.length > 0 && meetings.every((t) => t.category === 'meetings'));
  const found = listTemplates({ search: 'forward' });
  assert.ok(found.some((t) => t.key === 'fwd'));
});

test('listCategories returns distinct categories', () => {
  const cats = listCategories();
  assert.equal(cats.length, new Set(cats).size);
  assert.ok(cats.includes('mechanical'));
});

test('applySubjectPrefix de-duplicates and handles empty prefix', () => {
  assert.equal(applySubjectPrefix('FYI:', 'Q3 numbers'), 'FYI: Q3 numbers');
  assert.equal(applySubjectPrefix('FYI:', 'FYI: Q3 numbers'), 'FYI: Q3 numbers'); // no double
  assert.equal(applySubjectPrefix('Re:', 're: hello'), 're: hello'); // case-insensitive
  assert.equal(applySubjectPrefix('', 'thanks'), 'thanks'); // empty prefix passthrough
  assert.equal(applySubjectPrefix('FYI:', ''), 'FYI:'); // empty subject
});

test('buildForwardedBody produces a Gmail-style block (text)', () => {
  const out = buildForwardedBody('See below.', {
    forwardedFrom: 'a@x.com',
    forwardedDate: 'Mon',
    forwardedSubject: 'Hi',
    forwardedTo: 'b@x.com',
    forwardedBody: 'original',
  }, 'text');
  assert.ok(out.startsWith('See below.'));
  assert.ok(out.includes('---------- Forwarded message ---------'));
  assert.ok(out.includes('From: a@x.com') && out.includes('Subject: Hi') && out.includes('original'));
});

test('buildForwardedBody escapes html in the header', () => {
  const out = buildForwardedBody('note', { forwardedFrom: '<b@x.com>' }, 'html');
  assert.ok(out.includes('&lt;b@x.com&gt;'));
  assert.ok(!out.includes('<b@x.com>'));
});

test('wrapPolished wraps html in a bounded shell', () => {
  const out = wrapPolished('<p>hi</p>');
  assert.ok(out.includes('<p>hi</p>'));
  assert.ok(out.includes('max-width:600px'));
});
