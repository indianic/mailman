import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { readJsonFile, writeJsonFile, updateJsonFile } from '../src/config/store.js';

const Schema = z.object({ schemaVersion: z.literal(1), value: z.string() });
const DEFAULT = { schemaVersion: 1 as const, value: 'default' };

async function tempFilePath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mailman-store-test-'));
  return path.join(dir, 'data.json');
}

test('readJsonFile returns the default when the file does not exist', async () => {
  const filePath = await tempFilePath();
  const result = await readJsonFile(filePath, Schema, DEFAULT);
  assert.deepEqual(result, DEFAULT);
});

test('writeJsonFile writes atomically and readJsonFile reads it back', async () => {
  const filePath = await tempFilePath();
  await writeJsonFile(filePath, Schema, { schemaVersion: 1, value: 'hello' });
  const result = await readJsonFile(filePath, Schema, DEFAULT);
  assert.deepEqual(result, { schemaVersion: 1, value: 'hello' });
  // No leftover temp files in the directory.
  const entries = await fs.readdir(path.dirname(filePath));
  assert.ok(entries.every((e) => !e.endsWith('.tmp')));
});

test('writeJsonFile creates a .bak of the prior contents before overwriting', async () => {
  const filePath = await tempFilePath();
  await writeJsonFile(filePath, Schema, { schemaVersion: 1, value: 'first' });
  await writeJsonFile(filePath, Schema, { schemaVersion: 1, value: 'second' });

  const bak = JSON.parse(await fs.readFile(`${filePath}.bak`, 'utf8'));
  assert.deepEqual(bak, { schemaVersion: 1, value: 'first' });

  const current = await readJsonFile(filePath, Schema, DEFAULT);
  assert.deepEqual(current, { schemaVersion: 1, value: 'second' });
});

test('readJsonFile recovers from .bak when the primary file is corrupt', async () => {
  const filePath = await tempFilePath();
  await writeJsonFile(filePath, Schema, { schemaVersion: 1, value: 'good' });
  await writeJsonFile(filePath, Schema, { schemaVersion: 1, value: 'good-2' });

  // Corrupt the primary file directly, leaving the .bak (== 'good') intact.
  await fs.writeFile(filePath, '{ not valid json', 'utf8');

  const recovered = await readJsonFile(filePath, Schema, DEFAULT);
  assert.deepEqual(recovered, { schemaVersion: 1, value: 'good' });
});

test('readJsonFile throws when both the primary file and .bak are corrupt/missing', async () => {
  const filePath = await tempFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, '{ not valid json', 'utf8');

  await assert.rejects(() => readJsonFile(filePath, Schema, DEFAULT));
});

test('updateJsonFile performs an atomic read-modify-write', async () => {
  const filePath = await tempFilePath();
  await updateJsonFile(filePath, Schema, DEFAULT, (current) => ({ ...current, value: 'from-default' }));
  const afterFirst = await readJsonFile(filePath, Schema, DEFAULT);
  assert.deepEqual(afterFirst, { schemaVersion: 1, value: 'from-default' });

  await updateJsonFile(filePath, Schema, DEFAULT, (current) => ({ ...current, value: `${current.value}-2` }));
  const afterSecond = await readJsonFile(filePath, Schema, DEFAULT);
  assert.deepEqual(afterSecond, { schemaVersion: 1, value: 'from-default-2' });
});

test('concurrent writes to the same file are serialized, not interleaved', async () => {
  const filePath = await tempFilePath();
  await writeJsonFile(filePath, Schema, { schemaVersion: 1, value: '' });

  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      updateJsonFile(filePath, Schema, DEFAULT, (current) => ({ ...current, value: `${current.value}${i},` })),
    ),
  );

  const final = await readJsonFile(filePath, Schema, DEFAULT);
  const numbers = final.value.split(',').filter(Boolean).map(Number).sort((a, b) => a - b);
  assert.deepEqual(numbers, Array.from({ length: 20 }, (_, i) => i));
});
