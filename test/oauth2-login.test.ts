import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLocalBrowserAvailable } from '../src/auth/oauth2-login.js';

function withEnv(overrides: Record<string, string | undefined>, fn: () => void) {
  const prior: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    prior[key] = process.env[key];
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(prior)) {
      if (prior[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prior[key];
      }
    }
  }
}

test('isLocalBrowserAvailable is always false when --no-browser is passed', () => {
  assert.equal(isLocalBrowserAvailable(true), false);
});

test('isLocalBrowserAvailable respects platform on non-Linux (macOS/Windows assumed to have a browser)', () => {
  if (process.platform === 'darwin' || process.platform === 'win32') {
    assert.equal(isLocalBrowserAvailable(false), true);
  }
});

test('on Linux, isLocalBrowserAvailable requires DISPLAY or WAYLAND_DISPLAY', { skip: process.platform !== 'linux' }, () => {
  withEnv({ DISPLAY: undefined, WAYLAND_DISPLAY: undefined }, () => {
    assert.equal(isLocalBrowserAvailable(false), false);
  });
  withEnv({ DISPLAY: ':0', WAYLAND_DISPLAY: undefined }, () => {
    assert.equal(isLocalBrowserAvailable(false), true);
  });
});
