import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNewerVersion } from '../src/cli/update-notifier.js';

test('isNewerVersion: higher patch/minor/major is newer', () => {
  assert.equal(isNewerVersion('0.5.3', '0.5.2'), true);
  assert.equal(isNewerVersion('0.6.0', '0.5.2'), true);
  assert.equal(isNewerVersion('1.0.0', '0.5.2'), true);
});

test('isNewerVersion: numeric compare, not lexical (0.5.10 > 0.5.2)', () => {
  assert.equal(isNewerVersion('0.5.10', '0.5.2'), true);
});

test('isNewerVersion: equal or older is not newer', () => {
  assert.equal(isNewerVersion('0.5.2', '0.5.2'), false);
  assert.equal(isNewerVersion('0.5.1', '0.5.2'), false);
  assert.equal(isNewerVersion('0.4.9', '0.5.2'), false);
});

test('isNewerVersion: a trailing prerelease tag never reads as newer than the release', () => {
  assert.equal(isNewerVersion('0.5.2-beta', '0.5.2'), false);
});

test('isNewerVersion: leading v prefix is tolerated', () => {
  assert.equal(isNewerVersion('v0.6.0', '0.5.2'), true);
});
