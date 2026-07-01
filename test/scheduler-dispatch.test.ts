import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import { isDue, nextStatusAfterFailure, dispatchOne, dispatchDueEntries, MAX_ATTEMPTS } from '../src/scheduler/dispatch.js';
import { createScheduledEntry, listScheduled } from '../src/scheduler/store.js';
import { configureAccount } from '../src/accounts.js';
import type { ScheduledEntry } from '../src/config/schema.js';

async function withIsolatedEnv(fn: () => Promise<void>): Promise<void> {
  const dir = path.join(os.tmpdir(), `mailman-scheduler-test-${crypto.randomBytes(6).toString('hex')}`);
  const prior = process.env.MCP_MAILMAN_CONFIG_DIR;
  process.env.MCP_MAILMAN_CONFIG_DIR = dir;
  try {
    await fn();
  } finally {
    try {
      const keytar = (await import('keytar')).default;
      const { getServiceName } = await import('../src/config/keychain.js');
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

function fakeEntry(overrides: Partial<ScheduledEntry>): ScheduledEntry {
  return {
    scheduledId: 'sched-1',
    account: 'x',
    sendAt: new Date().toISOString(),
    status: 'pending',
    attempts: 0,
    content: { ciphertext: '', iv: '', authTag: '' },
    ...overrides,
  };
}

test('isDue: pending entry with a past sendAt is due', () => {
  const entry = fakeEntry({ sendAt: new Date(Date.now() - 60_000).toISOString() });
  assert.equal(isDue(entry, new Date()), true);
});

test('isDue: pending entry with a future sendAt is not due', () => {
  const entry = fakeEntry({ sendAt: new Date(Date.now() + 60_000).toISOString() });
  assert.equal(isDue(entry, new Date()), false);
});

test('isDue: a non-pending entry is never due, regardless of sendAt', () => {
  const pastSent = fakeEntry({ sendAt: new Date(Date.now() - 60_000).toISOString(), status: 'sent' });
  const pastFailed = fakeEntry({ sendAt: new Date(Date.now() - 60_000).toISOString(), status: 'failed' });
  assert.equal(isDue(pastSent, new Date()), false);
  assert.equal(isDue(pastFailed, new Date()), false);
});

test('nextStatusAfterFailure: stays pending below the attempt cap, flips to failed at the cap', () => {
  assert.equal(nextStatusAfterFailure(1, 5), 'pending');
  assert.equal(nextStatusAfterFailure(4, 5), 'pending');
  assert.equal(nextStatusAfterFailure(5, 5), 'failed');
  assert.equal(nextStatusAfterFailure(6, 5), 'failed');
});

test('dispatchOne: attachments are re-resolved fresh at fire time, not snapshotted', async () => {
  await withIsolatedEnv(async () => {
    await configureAccount({
      alias: 'x',
      email: 'x@example.com',
      method: 'app-password',
      credentials: { user: 'x@example.com', pass: 'fakepass1234567' },
    });

    const missingPath = path.join(os.tmpdir(), `mailman-missing-${crypto.randomBytes(4).toString('hex')}.txt`);
    const entry = await createScheduledEntry({
      account: 'x',
      sendAt: new Date(Date.now() - 1000).toISOString(),
      content: {
        to: ['b@example.com'],
        cc: [],
        bcc: [],
        subject: 's',
        body: 'b',
        bodyType: 'text',
        attachments: [missingPath],
      },
    });

    // Fails fast at attachment resolution — never reaches the network.
    const outcome = await dispatchOne(entry);
    assert.equal(outcome, 'retry-pending');

    const [reloaded] = await listScheduled();
    assert.equal(reloaded.attempts, 1);
    assert.equal(reloaded.status, 'pending');
    assert.match(reloaded.lastError ?? '', /not found|unreadable/);

    // Now write a file that exists but is oversized — still fails locally
    // (no network reached), but with a *different* error, proving the
    // resolver looked at the filesystem fresh rather than reusing the
    // stale "not found" result from the first attempt.
    await fs.writeFile(missingPath, Buffer.alloc(26 * 1024 * 1024));
    const secondOutcome = await dispatchOne(reloaded);
    assert.equal(secondOutcome, 'retry-pending');
    const [reloadedAgain] = await listScheduled();
    assert.equal(reloadedAgain.attempts, 2);
    assert.match(reloadedAgain.lastError ?? '', /25 MB limit/);
    assert.doesNotMatch(reloadedAgain.lastError ?? '', /not found|unreadable/);

    await fs.unlink(missingPath).catch(() => undefined);
  });
});

test('dispatchOne: retries up to the attempt cap, then marks the entry failed for good', async () => {
  await withIsolatedEnv(async () => {
    await configureAccount({
      alias: 'x',
      email: 'x@example.com',
      method: 'app-password',
      credentials: { user: 'x@example.com', pass: 'fakepass1234567' },
    });

    const missingPath = path.join(os.tmpdir(), `mailman-missing-${crypto.randomBytes(4).toString('hex')}.txt`);
    let entry = await createScheduledEntry({
      account: 'x',
      sendAt: new Date(Date.now() - 1000).toISOString(),
      content: {
        to: ['b@example.com'],
        cc: [],
        bcc: [],
        subject: 's',
        body: 'b',
        bodyType: 'text',
        attachments: [missingPath], // always missing — deterministic, fast failure every attempt
      },
    });

    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      const outcome = await dispatchOne(entry);
      const [reloaded] = await listScheduled();
      entry = reloaded;
      assert.equal(entry.attempts, i);
      if (i < MAX_ATTEMPTS) {
        assert.equal(outcome, 'retry-pending');
        assert.equal(entry.status, 'pending');
      } else {
        assert.equal(outcome, 'failed');
        assert.equal(entry.status, 'failed');
      }
    }
  });
});

test('dispatchDueEntries: only dispatches entries that are actually due', async () => {
  await withIsolatedEnv(async () => {
    await configureAccount({
      alias: 'x',
      email: 'x@example.com',
      method: 'app-password',
      credentials: { user: 'x@example.com', pass: 'fakepass1234567' },
    });

    const missingPath = path.join(os.tmpdir(), `mailman-missing-${crypto.randomBytes(4).toString('hex')}.txt`);
    const dueContent = {
      to: ['b@example.com'],
      cc: [],
      bcc: [],
      subject: 's',
      body: 'b',
      bodyType: 'text' as const,
      attachments: [missingPath],
    };

    await createScheduledEntry({ account: 'x', sendAt: new Date(Date.now() - 1000).toISOString(), content: dueContent });
    await createScheduledEntry({ account: 'x', sendAt: new Date(Date.now() + 60_000).toISOString(), content: dueContent });

    const summary = await dispatchDueEntries(new Date());
    assert.equal(summary.retryPending + summary.sent + summary.failed, 1); // only the due one ran

    const entries = await listScheduled();
    const untouched = entries.find((e) => new Date(e.sendAt).getTime() > Date.now());
    assert.equal(untouched?.attempts, 0);
  });
});
