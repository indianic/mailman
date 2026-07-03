import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmationRequired } from '../src/tools/confirm-send.js';

test('confirmationRequired blocks send when alwaysConfirm on and no confirm', () => {
  assert.equal(confirmationRequired(true, undefined), true);
  assert.equal(confirmationRequired(true, false), true);
});

test('confirmationRequired allows send when explicitly confirmed', () => {
  assert.equal(confirmationRequired(true, true), false);
});

test('confirmationRequired never blocks when alwaysConfirm off', () => {
  assert.equal(confirmationRequired(false, undefined), false);
  assert.equal(confirmationRequired(false, false), false);
  assert.equal(confirmationRequired(false, true), false);
});
