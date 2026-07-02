import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestCommand } from '../src/cli/main.js';

test('suggestCommand: real-user typo `upgarde` → upgrade', () => {
  assert.equal(suggestCommand('upgarde'), 'upgrade');
});

test('suggestCommand: `stauts` → status, `udpate` → update', () => {
  assert.equal(suggestCommand('stauts'), 'status');
  assert.equal(suggestCommand('udpate'), 'update');
});

test('suggestCommand: nothing plausibly close → null', () => {
  assert.equal(suggestCommand('sendmailnow'), null);
  assert.equal(suggestCommand('xyz'), null);
});

test('suggestCommand: case-insensitive input', () => {
  assert.equal(suggestCommand('STATUS'), 'status');
});
