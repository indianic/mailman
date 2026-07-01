import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { appendActivity, extractAuditMetadata } from '../src/audit.js';

async function withIsolatedConfigDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = path.join(os.tmpdir(), `mailman-audit-test-${crypto.randomBytes(6).toString('hex')}`);
  const prior = process.env.MCP_MAILMAN_CONFIG_DIR;
  process.env.MCP_MAILMAN_CONFIG_DIR = dir;
  try {
    await fn(dir);
  } finally {
    if (prior === undefined) {
      delete process.env.MCP_MAILMAN_CONFIG_DIR;
    } else {
      process.env.MCP_MAILMAN_CONFIG_DIR = prior;
    }
  }
}

test('appendActivity writes one JSON line per call', async () => {
  await withIsolatedConfigDir(async (dir) => {
    await appendActivity({ timestamp: new Date().toISOString(), tool: 'draft_email', ok: true });
    await appendActivity({ timestamp: new Date().toISOString(), tool: 'confirm_send', ok: true });

    const content = await fs.readFile(path.join(dir, 'activity.log'), 'utf8');
    const lines = content.trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).tool, 'draft_email');
    assert.equal(JSON.parse(lines[1]).tool, 'confirm_send');
  });
});

test('appendActivity writes the log with owner-only permissions', async () => {
  await withIsolatedConfigDir(async (dir) => {
    await appendActivity({ timestamp: new Date().toISOString(), tool: 'draft_email', ok: true });
    const stat = await fs.stat(path.join(dir, 'activity.log'));
    assert.equal(stat.mode & 0o777, 0o600);
  });
});

test('activity.log rotates to .1 once the line cap is exceeded', async () => {
  await withIsolatedConfigDir(async (dir) => {
    const logPath = path.join(dir, 'activity.log');
    await fs.mkdir(dir, { recursive: true });
    const seeded = `${Array.from({ length: 5000 }, (_, i) => JSON.stringify({ tool: 'seed', i })).join('\n')}\n`;
    await fs.writeFile(logPath, seeded, 'utf8');

    await appendActivity({ timestamp: new Date().toISOString(), tool: 'new-entry', ok: true });

    const rotated = await fs.readFile(`${logPath}.1`, 'utf8');
    assert.equal(rotated.trim().split('\n').length, 5000);

    const current = await fs.readFile(logPath, 'utf8');
    const currentLines = current.trim().split('\n');
    assert.equal(currentLines.length, 1);
    assert.equal(JSON.parse(currentLines[0]).tool, 'new-entry');
  });
});

test('extractAuditMetadata records counts only, never the underlying content', () => {
  const metadata = extractAuditMetadata({
    to: ['a@example.com', 'b@example.com'],
    cc: ['c@example.com'],
    attachments: ['/tmp/a.pdf', '/tmp/b.pdf', '/tmp/c.pdf'],
  });
  assert.deepEqual(metadata, { recipientCount: 2, ccCount: 1, attachmentCount: 3 });
  assert.ok(!JSON.stringify(metadata).includes('example.com'));
  assert.ok(!JSON.stringify(metadata).includes('.pdf'));
});

test('extractAuditMetadata handles a single string `to` as one recipient', () => {
  assert.deepEqual(extractAuditMetadata({ to: 'a@example.com' }), { recipientCount: 1 });
});
