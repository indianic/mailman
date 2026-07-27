import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRecipientList, normalizeRecipientFields } from '../src/mail/recipients.js';

test('parseRecipientList: an array of addresses is kept as-is', () => {
  assert.deepEqual(parseRecipientList(['alice@example.com', 'bob@example.com']), {
    addresses: ['alice@example.com', 'bob@example.com'],
    invalid: [],
  });
});

test('parseRecipientList: a single bare address is a one-element list', () => {
  assert.deepEqual(parseRecipientList('alice@example.com'), {
    addresses: ['alice@example.com'],
    invalid: [],
  });
});

test('parseRecipientList: a comma-separated string becomes multiple recipients', () => {
  assert.deepEqual(parseRecipientList('alice@example.com, bob@example.com'), {
    addresses: ['alice@example.com', 'bob@example.com'],
    invalid: [],
  });
});

test('parseRecipientList: semicolon is accepted as a separator too', () => {
  assert.deepEqual(parseRecipientList('alice@example.com; bob@example.com'), {
    addresses: ['alice@example.com', 'bob@example.com'],
    invalid: [],
  });
});

test('parseRecipientList: "Name <addr>" is reduced to the bare address', () => {
  assert.deepEqual(parseRecipientList('Alice Example <alice@example.com>'), {
    addresses: ['alice@example.com'],
    invalid: [],
  });
});

test('parseRecipientList: a comma inside a quoted display name is not a separator', () => {
  assert.deepEqual(parseRecipientList('"Example, Alice" <alice@example.com>, bob@example.com'), {
    addresses: ['alice@example.com', 'bob@example.com'],
    invalid: [],
  });
});

test('parseRecipientList: array elements are themselves split and trimmed', () => {
  assert.deepEqual(parseRecipientList([' alice@example.com , bob@example.com ', 'carol@example.com']), {
    addresses: ['alice@example.com', 'bob@example.com', 'carol@example.com'],
    invalid: [],
  });
});

test('parseRecipientList: duplicates collapse case-insensitively, first spelling wins', () => {
  assert.deepEqual(parseRecipientList('Alice@example.com, alice@EXAMPLE.com'), {
    addresses: ['Alice@example.com'],
    invalid: [],
  });
});

test('parseRecipientList: empty and whitespace-only entries are dropped, not reported invalid', () => {
  assert.deepEqual(parseRecipientList('alice@example.com, ,  '), {
    addresses: ['alice@example.com'],
    invalid: [],
  });
  assert.deepEqual(parseRecipientList(''), { addresses: [], invalid: [] });
});

test('parseRecipientList: unparseable entries are reported separately from the good ones', () => {
  assert.deepEqual(parseRecipientList('alice@example.com, not-an-email, @nope.com'), {
    addresses: ['alice@example.com'],
    invalid: ['not-an-email', '@nope.com'],
  });
});

test('normalizeRecipientFields: the reported bug — two addresses in one To string both land in To', () => {
  const result = normalizeRecipientFields({ to: 'alice@example.com, bob@example.com' });
  assert.deepEqual(result, {
    ok: true,
    to: ['alice@example.com', 'bob@example.com'],
    cc: [],
    bcc: [],
  });
});

test('normalizeRecipientFields: cc/bcc accept a bare string, not just an array', () => {
  const result = normalizeRecipientFields({
    to: ['alice@example.com'],
    cc: 'bob@example.com',
    bcc: 'carol@example.com, dave@example.com',
  });
  assert.deepEqual(result, {
    ok: true,
    to: ['alice@example.com'],
    cc: ['bob@example.com'],
    bcc: ['carol@example.com', 'dave@example.com'],
  });
});

test('normalizeRecipientFields: an unusable entry names the field and the entry', () => {
  const result = normalizeRecipientFields({ to: 'alice@example.com', cc: 'bob at example.com' });
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.message : '', /cc/);
  assert.match(result.ok === false ? result.message : '', /bob at example\.com/);
});

test('normalizeRecipientFields: a To that yields no address is refused', () => {
  const result = normalizeRecipientFields({ to: '  ,  ' });
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.message : '', /at least one/i);
});
