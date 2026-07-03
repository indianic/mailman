import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { configureAccountTool } from '../src/tools/configure-account.js';
import { listAccounts } from '../src/accounts.js';
import { getServiceName } from '../src/config/keychain.js';

// Same isolation pattern as accounts.test.ts — a throwaway config dir +
// keychain namespace so nothing touches real config or the machine keychain.
async function withIsolatedEnv(fn: () => Promise<void>): Promise<void> {
  const dir = path.join(os.tmpdir(), `mailman-configacct-test-${crypto.randomBytes(6).toString('hex')}`);
  const prior = process.env.MCP_MAILMAN_CONFIG_DIR;
  process.env.MCP_MAILMAN_CONFIG_DIR = dir;
  try {
    await fn();
  } finally {
    try {
      const keytar = (await import('keytar')).default;
      await keytar.deletePassword(getServiceName(), 'master-key');
    } catch {
      // best-effort
    }
    if (prior === undefined) delete process.env.MCP_MAILMAN_CONFIG_DIR;
    else process.env.MCP_MAILMAN_CONFIG_DIR = prior;
  }
}

const parse = (res: { content: Array<{ text: string }> }) => JSON.parse(res.content[0].text);

test('configure_account with skipVerify stores without a network check', async () => {
  await withIsolatedEnv(async () => {
    const res = await configureAccountTool.handler({
      alias: 'offline',
      email: 'me@example.com',
      method: 'app-password',
      credentials: { user: 'me@example.com', pass: 'irrelevant-16-chars' },
      skipVerify: true,
    });
    assert.equal(res.isError, undefined);
    const body = parse(res);
    assert.equal(body.alias, 'offline');
    assert.equal(body.isDefault, true); // first account
    assert.equal(body.verified, false); // verification was skipped
    const accounts = await listAccounts();
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].alias, 'offline');
  });
});

test('configure_account rejects malformed input before any verify/store', async () => {
  await withIsolatedEnv(async () => {
    const res = await configureAccountTool.handler({
      alias: '',
      email: 'not-an-email',
      method: 'app-password',
      credentials: { user: 'x', pass: '' },
    });
    assert.equal(res.isError, true);
    assert.equal(parse(res).code, 'INVALID_INPUT');
    assert.equal((await listAccounts()).length, 0);
  });
});
