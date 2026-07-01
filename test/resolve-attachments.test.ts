import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveAttachments, MAX_ATTACHMENT_SIZE_BYTES } from '../src/tools/resolve-attachments.js';

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mailman-attachments-test-'));
}

test('resolveAttachments with no input returns an empty result', async () => {
  const result = await resolveAttachments(undefined);
  assert.deepEqual(result, { files: [], totalSizeBytes: 0, exceedsLimit: false });
});

test('resolveAttachments resolves an explicit file path', async () => {
  const dir = await tempDir();
  const filePath = path.join(dir, 'report.pdf');
  await fs.writeFile(filePath, 'hello');

  const result = await resolveAttachments([filePath]);
  assert.ok('files' in result);
  if ('files' in result) {
    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].name, 'report.pdf');
    assert.equal(result.files[0].mimeType, 'application/pdf');
    assert.equal(result.totalSizeBytes, 5);
    assert.equal(result.exceedsLimit, false);
  }
});

test('resolveAttachments returns ATTACHMENT_NOT_FOUND for a missing explicit path', async () => {
  const dir = await tempDir();
  const result = await resolveAttachments([path.join(dir, 'does-not-exist.txt')]);
  assert.ok('code' in result);
  if ('code' in result) {
    assert.equal(result.code, 'ATTACHMENT_NOT_FOUND');
  }
});

test('resolveAttachments expands a glob pattern', async () => {
  const dir = await tempDir();
  await fs.writeFile(path.join(dir, 'a.txt'), 'a');
  await fs.writeFile(path.join(dir, 'b.txt'), 'bb');
  await fs.writeFile(path.join(dir, 'c.md'), 'c');

  const result = await resolveAttachments([path.join(dir, '*.txt')]);
  assert.ok('files' in result);
  if ('files' in result) {
    const names = result.files.map((f) => f.name).sort();
    assert.deepEqual(names, ['a.txt', 'b.txt']);
  }
});

test('resolveAttachments returns ATTACHMENT_NOT_FOUND for a glob with zero matches', async () => {
  const dir = await tempDir();
  const result = await resolveAttachments([path.join(dir, '*.nonexistent')]);
  assert.ok('code' in result);
  if ('code' in result) {
    assert.equal(result.code, 'ATTACHMENT_NOT_FOUND');
  }
});

test('resolveAttachments expands a directory non-recursively by default', async () => {
  const dir = await tempDir();
  await fs.writeFile(path.join(dir, 'top.txt'), 'top');
  const nested = path.join(dir, 'nested');
  await fs.mkdir(nested);
  await fs.writeFile(path.join(nested, 'inner.txt'), 'inner');

  const result = await resolveAttachments([dir]);
  assert.ok('files' in result);
  if ('files' in result) {
    assert.deepEqual(result.files.map((f) => f.name), ['top.txt']);
  }
});

test('resolveAttachments expands a directory recursively when opted in', async () => {
  const dir = await tempDir();
  await fs.writeFile(path.join(dir, 'top.txt'), 'top');
  const nested = path.join(dir, 'nested');
  await fs.mkdir(nested);
  await fs.writeFile(path.join(nested, 'inner.txt'), 'inner');

  const result = await resolveAttachments([dir], { recursive: true });
  assert.ok('files' in result);
  if ('files' in result) {
    const names = result.files.map((f) => f.name).sort();
    assert.deepEqual(names, ['inner.txt', 'top.txt']);
  }
});

test('resolveAttachments flags a single file over the size cap', async () => {
  const dir = await tempDir();
  const filePath = path.join(dir, 'big.bin');
  await fs.writeFile(filePath, Buffer.alloc(MAX_ATTACHMENT_SIZE_BYTES + 1));

  const result = await resolveAttachments([filePath]);
  assert.ok('files' in result);
  if ('files' in result) {
    assert.equal(result.exceedsLimit, true);
  }
});

test('resolveAttachments flags a combined total over the size cap', async () => {
  const dir = await tempDir();
  const half = Math.ceil(MAX_ATTACHMENT_SIZE_BYTES / 2) + 1024;
  await fs.writeFile(path.join(dir, 'part1.bin'), Buffer.alloc(half));
  await fs.writeFile(path.join(dir, 'part2.bin'), Buffer.alloc(half));

  const result = await resolveAttachments([path.join(dir, 'part1.bin'), path.join(dir, 'part2.bin')]);
  assert.ok('files' in result);
  if ('files' in result) {
    assert.equal(result.files.length, 2);
    assert.equal(result.exceedsLimit, true);
  }
});
