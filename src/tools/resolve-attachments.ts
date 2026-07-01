import { promises as fs } from 'node:fs';
import path from 'node:path';
import { glob, hasMagic } from 'glob';
import { guessMimeType } from '../mail/mime.js';

export const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024; // Gmail's ~25 MB SMTP limit

export interface ResolvedAttachment {
  path: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
}

export interface ResolveAttachmentsSuccess {
  files: ResolvedAttachment[];
  totalSizeBytes: number;
  exceedsLimit: boolean;
}

export interface ResolveAttachmentsNotFound {
  code: 'ATTACHMENT_NOT_FOUND';
  message: string;
}

export type ResolveAttachmentsResult = ResolveAttachmentsSuccess | ResolveAttachmentsNotFound;

async function listFilesInDirectory(dir: string, recursive: boolean): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) {
        files.push(...(await listFilesInDirectory(fullPath, recursive)));
      }
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Expands each input into a flat list of real file paths — explicit path,
 * glob pattern, or directory (non-recursive unless `recursive` is set).
 * Missing/unreadable paths and zero-match globs are reported back rather
 * than silently dropped. See docs/PLAN.md's "Attachment resolution"
 * section.
 */
async function expandToFilePaths(inputs: string[], recursive: boolean): Promise<string[] | { notFoundPath: string }> {
  const filePaths: string[] = [];

  for (const input of inputs) {
    if (hasMagic(input)) {
      const matches = await glob(input, { nodir: true });
      if (matches.length === 0) {
        return { notFoundPath: input };
      }
      filePaths.push(...matches);
      continue;
    }

    let stat;
    try {
      stat = await fs.stat(input);
    } catch {
      return { notFoundPath: input };
    }

    if (stat.isDirectory()) {
      filePaths.push(...(await listFilesInDirectory(input, recursive)));
      continue;
    }
    if (stat.isFile()) {
      filePaths.push(input);
      continue;
    }
    return { notFoundPath: input };
  }

  return filePaths;
}

export async function resolveAttachments(
  inputs: string[] | undefined,
  opts: { recursive?: boolean } = {},
): Promise<ResolveAttachmentsResult> {
  if (!inputs || inputs.length === 0) {
    return { files: [], totalSizeBytes: 0, exceedsLimit: false };
  }

  const expanded = await expandToFilePaths(inputs, opts.recursive ?? false);
  if (!Array.isArray(expanded)) {
    return {
      code: 'ATTACHMENT_NOT_FOUND',
      message: `Attachment not found or unreadable: ${expanded.notFoundPath}`,
    };
  }

  const files: ResolvedAttachment[] = [];
  let totalSizeBytes = 0;
  for (const filePath of expanded) {
    const stat = await fs.stat(filePath);
    files.push({
      path: filePath,
      name: path.basename(filePath),
      sizeBytes: stat.size,
      mimeType: guessMimeType(filePath),
    });
    totalSizeBytes += stat.size;
  }

  const exceedsLimit =
    totalSizeBytes > MAX_ATTACHMENT_SIZE_BYTES || files.some((f) => f.sizeBytes > MAX_ATTACHMENT_SIZE_BYTES);

  return { files, totalSizeBytes, exceedsLimit };
}
