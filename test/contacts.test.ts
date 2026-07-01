import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  listContacts,
  addContact,
  removeContact,
  upsertRecipient,
  rankContactsByQuery,
  mergeWithGoogleContacts,
  type SuggestionEntry,
} from '../src/contacts.js';
import type { Contact } from '../src/config/schema.js';

async function withIsolatedConfigDir(fn: () => Promise<void>): Promise<void> {
  const dir = path.join(os.tmpdir(), `mailman-contacts-test-${crypto.randomBytes(6).toString('hex')}`);
  const prior = process.env.MCP_MAILMAN_CONFIG_DIR;
  process.env.MCP_MAILMAN_CONFIG_DIR = dir;
  try {
    await fn();
  } finally {
    if (prior === undefined) {
      delete process.env.MCP_MAILMAN_CONFIG_DIR;
    } else {
      process.env.MCP_MAILMAN_CONFIG_DIR = prior;
    }
  }
}

function contact(overrides: Partial<Contact>): Contact {
  return {
    email: 'someone@example.com',
    source: 'manual',
    useCount: 0,
    lastUsedAt: null,
    ...overrides,
  };
}

test('addContact creates a manual contact with zero usage', async () => {
  await withIsolatedConfigDir(async () => {
    await addContact('a@example.com', 'Alice');
    const contacts = await listContacts();
    assert.deepEqual(contacts, [{ email: 'a@example.com', name: 'Alice', source: 'manual', useCount: 0, lastUsedAt: null }]);
  });
});

test('addContact on an existing contact updates the name without touching usage stats', async () => {
  await withIsolatedConfigDir(async () => {
    await addContact('a@example.com');
    await upsertRecipient('a@example.com'); // useCount -> 1
    await addContact('a@example.com', 'Alice');
    const [found] = await listContacts();
    assert.equal(found.name, 'Alice');
    assert.equal(found.useCount, 1);
    assert.equal(found.source, 'manual');
  });
});

test('upsertRecipient creates a new "recents" contact on first use', async () => {
  await withIsolatedConfigDir(async () => {
    await upsertRecipient('a@example.com');
    const [found] = await listContacts();
    assert.equal(found.source, 'recents');
    assert.equal(found.useCount, 1);
    assert.ok(found.lastUsedAt);
  });
});

test('upsertRecipient on an existing contact increments useCount and keeps its original source', async () => {
  await withIsolatedConfigDir(async () => {
    await addContact('a@example.com'); // source: manual
    await upsertRecipient('a@example.com');
    await upsertRecipient('a@example.com');
    const [found] = await listContacts();
    assert.equal(found.source, 'manual');
    assert.equal(found.useCount, 2);
  });
});

test('removeContact removes a contact; removing an unknown email is a no-op', async () => {
  await withIsolatedConfigDir(async () => {
    await addContact('a@example.com');
    await removeContact('a@example.com');
    assert.deepEqual(await listContacts(), []);
    await removeContact('never-existed@example.com'); // should not throw
  });
});

test('rankContactsByQuery: prefix match ranks above substring-only match', async () => {
  const contacts = [contact({ email: 'zzz-alice@example.com' }), contact({ email: 'alice@example.com' })];
  const ranked = rankContactsByQuery(contacts, 'alice');
  assert.equal(ranked[0].email, 'alice@example.com');
});

test('rankContactsByQuery: ties broken by useCount desc, then lastUsedAt desc', async () => {
  const contacts = [
    contact({ email: 'a@example.com', useCount: 1, lastUsedAt: '2026-01-01T00:00:00.000Z' }),
    contact({ email: 'b@example.com', useCount: 5, lastUsedAt: '2026-01-01T00:00:00.000Z' }),
    contact({ email: 'c@example.com', useCount: 5, lastUsedAt: '2026-06-01T00:00:00.000Z' }),
  ];
  const ranked = rankContactsByQuery(contacts, 'example.com');
  assert.deepEqual(ranked.map((c) => c.email), ['c@example.com', 'b@example.com', 'a@example.com']);
});

test('rankContactsByQuery: empty query returns everything sorted by usage/recency, no filtering', async () => {
  const contacts = [contact({ email: 'low@example.com', useCount: 1 }), contact({ email: 'high@example.com', useCount: 9 })];
  const ranked = rankContactsByQuery(contacts, '');
  assert.deepEqual(ranked.map((c) => c.email), ['high@example.com', 'low@example.com']);
});

test('mergeWithGoogleContacts: Google results are appended, deduped against local by email', async () => {
  const local = [contact({ email: 'shared@example.com', source: 'recents', useCount: 3 })];
  const google = [
    { email: 'shared@example.com', name: 'Should not override local' },
    { email: 'only-on-google@example.com', name: 'Google Person' },
  ];
  const merged = mergeWithGoogleContacts(local, google);
  assert.deepEqual(merged, [
    { email: 'shared@example.com', name: undefined, source: 'recents', useCount: 3, lastUsedAt: undefined },
    { email: 'only-on-google@example.com', name: 'Google Person', source: 'google-contacts' },
  ]);
});

test('mergeWithGoogleContacts: local entries keep their useCount/lastUsedAt even when also on Google', async () => {
  const local = [contact({ email: 'a@example.com', useCount: 7, lastUsedAt: '2026-01-01T00:00:00.000Z' })];
  const google = [{ email: 'a@example.com', name: 'A' }];
  const merged: SuggestionEntry[] = mergeWithGoogleContacts(local, google);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].useCount, 7);
  assert.equal(merged[0].source, 'manual');
});

test('mergeWithGoogleContacts: with a query, both sides are ranked and non-matches are dropped', async () => {
  const local = [contact({ email: 'alice@example.com', useCount: 1 }), contact({ email: 'bob@example.com', useCount: 9 })];
  const google = [{ email: 'alicia@example.com' }, { email: 'nomatch@example.com' }];
  const merged = mergeWithGoogleContacts(local, google, 'ali');
  const emails = merged.map((m) => m.email);
  assert.deepEqual(emails, ['alice@example.com', 'alicia@example.com']);
  assert.equal(merged[1].source, 'google-contacts');
});
