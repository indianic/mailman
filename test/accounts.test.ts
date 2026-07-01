import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  configureAccount,
  resolveAccount,
  removeAccount,
  AccountResolutionError,
  AccountRemovalConfirmationError,
} from '../src/accounts.js';
import { getSettings, updateSettings } from '../src/settings.js';
import { getServiceName } from '../src/config/keychain.js';

// Isolated per test: a fresh MCP_MAILMAN_CONFIG_DIR namespaces both the
// config files and the keytar service name (see config/keychain.ts), so
// these never touch real config or the real machine-wide keychain entry.
async function withIsolatedEnv(fn: () => Promise<void>): Promise<void> {
  const dir = path.join(os.tmpdir(), `mailman-accounts-test-${crypto.randomBytes(6).toString('hex')}`);
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

function appPasswordInput(alias: string, setDefault?: boolean) {
  return {
    alias,
    email: `${alias}@example.com`,
    method: 'app-password' as const,
    credentials: { user: `${alias}@example.com`, pass: 'sixteencharpass1' },
    setDefault,
  };
}

test('resolveAccount: explicit alias resolves to that account', async () => {
  await withIsolatedEnv(async () => {
    await configureAccount(appPasswordInput('a'));
    const account = await resolveAccount('a');
    assert.equal(account.alias, 'a');
  });
});

test('resolveAccount: explicit alias that does not exist throws ACCOUNT_NOT_FOUND', async () => {
  await withIsolatedEnv(async () => {
    await configureAccount(appPasswordInput('a'));
    await assert.rejects(() => resolveAccount('nope'), (err: unknown) => {
      assert.ok(err instanceof AccountResolutionError);
      assert.equal(err.code, 'ACCOUNT_NOT_FOUND');
      return true;
    });
  });
});

test('resolveAccount: no accounts configured throws ACCOUNT_NOT_FOUND', async () => {
  await withIsolatedEnv(async () => {
    await assert.rejects(() => resolveAccount(), (err: unknown) => {
      assert.ok(err instanceof AccountResolutionError);
      assert.equal(err.code, 'ACCOUNT_NOT_FOUND');
      return true;
    });
  });
});

test('resolveAccount: single account with no alias resolves automatically', async () => {
  await withIsolatedEnv(async () => {
    await configureAccount(appPasswordInput('only'));
    const account = await resolveAccount();
    assert.equal(account.alias, 'only');
  });
});

test('resolveAccount: multiple accounts, no default set, no alias -> AMBIGUOUS_ACCOUNT', async () => {
  await withIsolatedEnv(async () => {
    await configureAccount(appPasswordInput('a'));
    await configureAccount(appPasswordInput('b'));
    // configureAccount auto-defaults the first account ever added — clear
    // it explicitly to reach the genuinely-no-default state.
    await updateSettings((current) => ({ ...current, defaultAccount: null }));
    await assert.rejects(() => resolveAccount(), (err: unknown) => {
      assert.ok(err instanceof AccountResolutionError);
      assert.equal(err.code, 'AMBIGUOUS_ACCOUNT');
      return true;
    });
  });
});

test('resolveAccount: multiple accounts, settings-driven default, no alias -> resolves to the default', async () => {
  await withIsolatedEnv(async () => {
    await configureAccount(appPasswordInput('a')); // becomes default (first account)
    await configureAccount(appPasswordInput('b'));
    const account = await resolveAccount();
    assert.equal(account.alias, 'a');
  });
});

test('configureAccount: first account auto-defaults; second does not displace it without setDefault', async () => {
  await withIsolatedEnv(async () => {
    const first = await configureAccount(appPasswordInput('a'));
    assert.equal(first.isDefault, true);

    const second = await configureAccount(appPasswordInput('b'));
    assert.equal(second.isDefault, false);

    const settings = await getSettings();
    assert.equal(settings.defaultAccount, 'a');
  });
});

test('configureAccount: setDefault: true moves the default to the new account', async () => {
  await withIsolatedEnv(async () => {
    await configureAccount(appPasswordInput('a'));
    const second = await configureAccount(appPasswordInput('b', true));
    assert.equal(second.isDefault, true);

    const settings = await getSettings();
    assert.equal(settings.defaultAccount, 'b');
  });
});

test('removeAccount: the last remaining account requires confirmRemoval', async () => {
  await withIsolatedEnv(async () => {
    await configureAccount(appPasswordInput('a'));
    await assert.rejects(() => removeAccount('a'), AccountRemovalConfirmationError);
    await removeAccount('a', true);
    const settings = await getSettings();
    assert.equal(settings.defaultAccount, null);
  });
});

test('removeAccount: the current default (not last) requires confirmRemoval and clears the default', async () => {
  await withIsolatedEnv(async () => {
    await configureAccount(appPasswordInput('a')); // default
    await configureAccount(appPasswordInput('b'));
    await assert.rejects(() => removeAccount('a'), AccountRemovalConfirmationError);
    await removeAccount('a', true);

    const settings = await getSettings();
    assert.equal(settings.defaultAccount, null);
    const remaining = await resolveAccount('b');
    assert.equal(remaining.alias, 'b');
  });
});

test('removeAccount: a non-default, non-last account does not require confirmRemoval', async () => {
  await withIsolatedEnv(async () => {
    await configureAccount(appPasswordInput('a')); // default
    await configureAccount(appPasswordInput('b'));
    await removeAccount('b'); // no confirmRemoval needed
    const settings = await getSettings();
    assert.equal(settings.defaultAccount, 'a');
  });
});

test('removeAccount: unknown alias throws ACCOUNT_NOT_FOUND', async () => {
  await withIsolatedEnv(async () => {
    await configureAccount(appPasswordInput('a'));
    await assert.rejects(() => removeAccount('nope', true), (err: unknown) => {
      assert.ok(err instanceof AccountResolutionError);
      assert.equal(err.code, 'ACCOUNT_NOT_FOUND');
      return true;
    });
  });
});
