import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getActivityLogPath } from './config/paths.js';
import { enqueue } from './config/store.js';

const MAX_LINES = 5000;
const MAX_BYTES = 5 * 1024 * 1024;
const PRIVATE_FILE_MODE = 0o600;

export interface ActivityEntry {
  timestamp: string;
  tool: string;
  account?: string;
  ok: boolean;
  metadata?: Record<string, unknown>;
}

async function rotateIfNeeded(logPath: string): Promise<void> {
  let stat;
  try {
    stat = await fs.stat(logPath);
  } catch {
    return; // doesn't exist yet — nothing to rotate
  }

  let shouldRotate = stat.size >= MAX_BYTES;
  if (!shouldRotate) {
    const content = await fs.readFile(logPath, 'utf8');
    const lineCount = content.split('\n').filter(Boolean).length;
    shouldRotate = lineCount >= MAX_LINES;
  }
  if (!shouldRotate) {
    return;
  }

  // Single rotation, not a logrotate-style chain — see docs/PLAN.md's
  // "Data integrity & storage" section.
  await fs.rename(logPath, `${logPath}.1`);
}

/**
 * Append-only JSONL audit trail — one line per tool call, non-sensitive
 * metadata only (counts, not content). Forensic, not preventive: "what
 * did this thing actually do, and when." Serialized through the same
 * per-file queue config/store.ts uses, so concurrent tool calls never
 * interleave a partial line.
 */
export function appendActivity(entry: ActivityEntry): Promise<void> {
  const logPath = getActivityLogPath();
  return enqueue(logPath, async () => {
    await fs.mkdir(path.dirname(logPath), { recursive: true, mode: 0o700 });
    await rotateIfNeeded(logPath);
    await fs.appendFile(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
    await fs.chmod(logPath, PRIVATE_FILE_MODE);
  });
}

/**
 * Counts, not content — recipient/attachment *count*, never the actual
 * addresses or filenames. Applied uniformly in src/index.ts's tool
 * dispatch so individual tool files don't need audit-logging awareness.
 */
export function extractAuditMetadata(args: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  if ('to' in args) {
    metadata.recipientCount = Array.isArray(args.to) ? args.to.length : args.to ? 1 : 0;
  }
  if (Array.isArray(args.cc)) {
    metadata.ccCount = args.cc.length;
  }
  if (Array.isArray(args.bcc)) {
    metadata.bccCount = args.bcc.length;
  }
  if (Array.isArray(args.attachments)) {
    metadata.attachmentCount = args.attachments.length;
  }
  return metadata;
}
