import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configureAccountTool } from '../src/tools/configure-account.js';
import { listAccounts } from '../src/accounts.js';
import { withIsolatedConfig } from './support/isolate.js';

// Same isolation as accounts.test.ts — see test/support/isolate.ts.
const withIsolatedEnv = (fn: () => Promise<void>) => withIsolatedConfig(() => fn());

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

test('configure_account rejects a second alias reusing an existing email', async () => {
  await withIsolatedEnv(async () => {
    const base = {
      email: 'me@example.com',
      method: 'app-password' as const,
      credentials: { user: 'me@example.com', pass: 'irrelevant-16-chars' },
      skipVerify: true,
    };
    const first = await configureAccountTool.handler({ alias: 'work', ...base });
    assert.equal(first.isError, undefined);

    // Same email, DIFFERENT alias → rejected.
    const dup = await configureAccountTool.handler({ alias: 'work2', ...base });
    assert.equal(dup.isError, true);
    assert.equal(parse(dup).code, 'DUPLICATE_EMAIL');
    assert.equal((await listAccounts()).length, 1);

    // Same alias → allowed (this is the update path), no duplicate created.
    const update = await configureAccountTool.handler({ alias: 'work', ...base, displayName: 'Me' });
    assert.equal(update.isError, undefined);
    assert.equal((await listAccounts()).length, 1);
  });
});

test('configure_account email match is case-insensitive', async () => {
  await withIsolatedEnv(async () => {
    const base = {
      method: 'app-password' as const,
      credentials: { user: 'me@example.com', pass: 'irrelevant-16-chars' },
      skipVerify: true,
    };
    await configureAccountTool.handler({ alias: 'a', email: 'Me@Example.com', ...base });
    const dup = await configureAccountTool.handler({
      alias: 'b',
      email: 'me@example.com',
      method: 'app-password',
      credentials: { user: 'me@example.com', pass: 'irrelevant-16-chars' },
      skipVerify: true,
    });
    assert.equal(parse(dup).code, 'DUPLICATE_EMAIL');
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
