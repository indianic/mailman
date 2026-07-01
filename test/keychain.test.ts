import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  getOrCreateMasterKey,
  getMasterKeyOrThrow,
  setMasterKey,
  generateMasterKey,
  getServiceName,
  NoMasterKeyError,
} from '../src/config/keychain.js';

// Every test runs with MCP_MAILMAN_CONFIG_DIR pointed at a fresh temp dir,
// which namespaces the keytar service name too (see getServiceName) — so
// these tests never touch the real machine-wide 'mcp-mailman' keychain
// entry, and each gets a guaranteed-unused key.
async function withIsolatedKeychain(fn: () => Promise<void>): Promise<void> {
  const dir = path.join(os.tmpdir(), `mailman-keychain-test-${crypto.randomBytes(6).toString('hex')}`);
  const prior = process.env.MCP_MAILMAN_CONFIG_DIR;
  process.env.MCP_MAILMAN_CONFIG_DIR = dir;
  try {
    await fn();
  } finally {
    try {
      const keytar = (await import('keytar')).default;
      await keytar.deletePassword(getServiceName(), 'master-key');
    } catch {
      // best-effort cleanup
    }
    if (prior === undefined) {
      delete process.env.MCP_MAILMAN_CONFIG_DIR;
    } else {
      process.env.MCP_MAILMAN_CONFIG_DIR = prior;
    }
  }
}

test('getMasterKeyOrThrow throws NoMasterKeyError when no key has ever been created', async () => {
  await withIsolatedKeychain(async () => {
    await assert.rejects(() => getMasterKeyOrThrow(), NoMasterKeyError);
  });
});

test('getOrCreateMasterKey generates a 256-bit key and reuses it on later calls', async () => {
  await withIsolatedKeychain(async () => {
    const first = await getOrCreateMasterKey();
    assert.equal(first.length, 32);
    const second = await getOrCreateMasterKey();
    assert.deepEqual(first, second);
  });
});

test('getMasterKeyOrThrow returns the key created by getOrCreateMasterKey', async () => {
  await withIsolatedKeychain(async () => {
    const created = await getOrCreateMasterKey();
    const read = await getMasterKeyOrThrow();
    assert.deepEqual(created, read);
  });
});

test('setMasterKey overwrites the stored key unconditionally', async () => {
  await withIsolatedKeychain(async () => {
    await getOrCreateMasterKey();
    const newKey = generateMasterKey();
    await setMasterKey(newKey);
    const read = await getMasterKeyOrThrow();
    assert.deepEqual(read, newKey);
  });
});

test('different MCP_MAILMAN_CONFIG_DIR overrides get isolated, non-colliding service names', () => {
  const priorEnv = process.env.MCP_MAILMAN_CONFIG_DIR;
  process.env.MCP_MAILMAN_CONFIG_DIR = '/tmp/profile-a';
  const serviceA = getServiceName();
  process.env.MCP_MAILMAN_CONFIG_DIR = '/tmp/profile-b';
  const serviceB = getServiceName();
  if (priorEnv === undefined) {
    delete process.env.MCP_MAILMAN_CONFIG_DIR;
  } else {
    process.env.MCP_MAILMAN_CONFIG_DIR = priorEnv;
  }
  assert.notEqual(serviceA, serviceB);
});
