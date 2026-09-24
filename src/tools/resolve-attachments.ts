import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { glob, hasMagic } from 'glob';
import { guessMimeType } from '../mail/mime.js';
import { getConfigDir } from '../config/paths.js';
import { defaultKeyFilePath } from '../config/keystore/file.js';
import { readKeystoreRecord } from '../config/keystore/pointer.js';

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

export interface ResolveAttachmentsDenied {
  code: 'ATTACHMENT_DENIED';
  message: string;
}

export type ResolveAttachmentsResult = ResolveAttachmentsSuccess | ResolveAttachmentsNotFound | ResolveAttachmentsDenied;

/**
 * `~` and `~/…` only (no `~user`). A shell would have expanded it; an MCP
 * caller passes the string through as-is.
 */
function expandHome(input: string): string {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/') || (process.platform === 'win32' && input.startsWith('~\\'))) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

async function realpathOrResolved(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * Places no attachment may come from, however it was named: the paths text an
 * LLM reads could steer it towards (T-008 #1). Compared as real paths, so `..`,
 * a glob, a directory or a symlink called report.pdf all land on the same check.
 * The key file's whole directory is denied, which also covers a rotation's
 * temporary file next to it.
 */
async function deniedRoots(): Promise<string[]> {
  const home = os.homedir();
  const roots = [
    path.join(home, '.ssh'),
    path.join(home, '.aws'),
    path.join(home, '.gnupg'),
    getConfigDir(),
    path.dirname(defaultKeyFilePath()),
  ];
  try {
    const record = await readKeystoreRecord();
    if (record?.backend === 'file' && record.keyFile) roots.push(path.dirname(record.keyFile));
  } catch {
    // An unreadable keystore.json still leaves the default key location denied.
  }
  return Promise.all(roots.map(realpathOrResolved));
}

function isInside(filePath: string, root: string): boolean {
  return filePath === root || filePath.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

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

  for (const rawInput of inputs) {
    const input = expandHome(rawInput);
    if (hasMagic(input)) {
      const matches = await glob(input, { nodir: true });
      if (matches.length === 0) {
        return { notFoundPath: rawInput };
      }
      filePaths.push(...matches);
      continue;
    }

    let stat;
    try {
      stat = await fs.stat(input);
    } catch {
      return { notFoundPath: rawInput };
    }

    if (stat.isDirectory()) {
      filePaths.push(...(await listFilesInDirectory(input, recursive)));
      continue;
    }
    if (stat.isFile()) {
      filePaths.push(input);
      continue;
    }
    return { notFoundPath: rawInput };
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

  // Every file is reported by its real path — what the preview shows is what
  // will be read, never a link's or a traversal's spelling of it.
  const denied = await deniedRoots();
  const files: ResolvedAttachment[] = [];
  let totalSizeBytes = 0;
  for (const filePath of expanded) {
    let realPath;
    try {
      realPath = await fs.realpath(filePath);
    } catch {
      return { code: 'ATTACHMENT_NOT_FOUND', message: `Attachment not found or unreadable: ${filePath}` };
    }
    if (denied.some((root) => isInside(realPath, root))) {
      return {
        code: 'ATTACHMENT_DENIED',
        message:
          `Attachment refused: ${filePath} resolves to ${realPath}. mailman never attaches files from ~/.ssh, ` +
          '~/.aws, ~/.gnupg, its own config directory or its key file.',
      };
    }
    const stat = await fs.stat(realPath);
    files.push({
      path: realPath,
      name: path.basename(realPath),
      sizeBytes: stat.size,
      mimeType: guessMimeType(realPath),
    });
    totalSizeBytes += stat.size;
  }

  const exceedsLimit =
    totalSizeBytes > MAX_ATTACHMENT_SIZE_BYTES || files.some((f) => f.sizeBytes > MAX_ATTACHMENT_SIZE_BYTES);

  return { files, totalSizeBytes, exceedsLimit };
}
