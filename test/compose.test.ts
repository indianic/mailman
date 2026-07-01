import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatFromAddress, appendSignature } from '../src/mail/compose.js';

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
