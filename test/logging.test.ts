import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../src/logging.js';

test('redact replaces credential and body fields, recursively', () => {
  const input = {
    tool: 'draft_email',
    body: 'sensitive body text',
    credentials: { user: 'a@example.com', pass: 'secret' },
    nested: { refreshToken: 'rt-value', ok: true },
  };
  assert.deepEqual(redact(input), {
    tool: 'draft_email',
    body: '[redacted]',
    credentials: '[redacted]',
    nested: { refreshToken: '[redacted]', ok: true },
  });
});

test('redact walks arrays and leaves non-sensitive primitives untouched', () => {
  assert.deepEqual(redact([1, 'a', { pass: 'x', count: 3 }]), [1, 'a', { pass: '[redacted]', count: 3 }]);
});

test('redact passes through primitives and null unchanged', () => {
  assert.equal(redact('plain string'), 'plain string');
  assert.equal(redact(42), 42);
  assert.equal(redact(null), null);
});
