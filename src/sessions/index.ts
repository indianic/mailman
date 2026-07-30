import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { getConfigDir } from '../config/paths.js';

/**
 * Reads the AI host's own session transcripts (`~/.claude/projects/**\/*.jsonl`)
 * so a session — or a week of them — can be turned into an email.
 *
 * Consistent with the project's "mailman stays dumb, Claude composes"
 * philosophy: NOTHING here summarizes. This module only indexes (what
 * sessions exist) and extracts (a compact skeleton of one). The prose
 * summary is written by the calling Claude session from that skeleton; the
 * CLI, which has no model, prints a mechanical digest instead and says so.
 *
 * Scale this is built for, measured on a real machine (2026-07-30): 75
 * project directories, 2,258 sessions, 946 MB, largest single session
 * 50.9 MB. Two consequences drive the design:
 *   - a full re-scan is too slow to do per invocation → mtime/size-keyed
 *     cache in the config dir, so only changed files are re-read;
 *   - a session is far too large to load → the skeleton pass drops every
 *     tool RESULT (which is both the bulk of the bytes and where pasted
 *     secrets live), keeping only prompts, truncated replies, and tool
 *     call targets.
 */

/** One indexed session — metadata only, never transcript content. */
export interface SessionMeta {
  id: string;
  file: string;
  /** Display label, e.g. "Products/mailman" — last two segments of the cwd. */
  project: string;
  /** Absolute working directory the session ran in. */
  projectPath: string;
  /** The host's own generated title, when it wrote one. */
  title: string;
  gitBranch: string;
  startedAt: string;
  endedAt: string;
  /** User + assistant records. A rough size signal, not a prompt count. */
  messages: number;
  sizeBytes: number;
}

export interface ProjectMeta {
  project: string;
  projectPath: string;
  sessions: number;
  lastActivity: string;
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  meta: SessionMeta;
}

interface IndexCache {
  version: number;
  entries: Record<string, CacheEntry>;
}

const CACHE_VERSION = 1;

/**
 * Where the host keeps transcripts. Overridable so tests (and anyone whose
 * host writes elsewhere) don't depend on a real home directory.
 */
export function getSessionsRoot(): string {
  return process.env.MAILMAN_SESSIONS_DIR ?? path.join(os.homedir(), '.claude', 'projects');
}

function getCachePath(): string {
  return path.join(getConfigDir(), 'session-index.json');
}

/** "Products/mailman" from "/Users/x/Sites/IndiaNIC/Products/mailman". */
function toLabel(cwd: string): string {
  const parts = cwd.split(/[/\\]/).filter(Boolean);
  return parts.slice(-2).join('/') || cwd;
}

/**
 * Fallback when no record in the file carried a `cwd`: the host encodes the
 * path into the directory name by replacing separators with `-`. That's
 * lossy (a real hyphen in a folder name is indistinguishable), so it is only
 * ever used for display, never to resolve a path back.
 */
function labelFromDirName(dirName: string): string {
  const parts = dirName.replace(/^-/, '').split('-').filter(Boolean);
  return parts.slice(-2).join('/') || dirName;
}

const TIMESTAMP_RE = /"timestamp":"([^"]+)"/;
const CWD_RE = /"cwd":"((?:[^"\\]|\\.)*)"/;
const BRANCH_RE = /"gitBranch":"((?:[^"\\]|\\.)*)"/;

/**
 * One streaming pass over a transcript, collecting only metadata.
 *
 * Every field is pulled with a cheap `includes()` pre-filter before any
 * regex or JSON.parse — at ~946 MB across the store, parsing each line as
 * JSON to read one field is the difference between a few seconds and a few
 * minutes on the first (uncached) build.
 */
async function scanSession(file: string, sizeBytes: number): Promise<SessionMeta | null> {
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let messages = 0;
  let title = '';
  let firstPrompt = '';
  let cwd = '';
  let gitBranch = '';
  let startedAt = '';
  let endedAt = '';

  try {
    for await (const line of rl) {
      if (line.length < 8) continue;

      const isUser = line.includes('"type":"user"');
      if (isUser || line.includes('"type":"assistant"')) messages++;

      const ts = TIMESTAMP_RE.exec(line);
      if (ts) {
        if (!startedAt) startedAt = ts[1];
        endedAt = ts[1];
      }

      if (!cwd && line.includes('"cwd":"')) {
        const m = CWD_RE.exec(line);
        if (m) cwd = m[1].replace(/\\\\/g, '\\').replace(/\\"/g, '"');
      }
      if (!gitBranch && line.includes('"gitBranch":"')) {
        const m = BRANCH_RE.exec(line);
        if (m) gitBranch = m[1];
      }

      // The host appends/overwrites its own title as the session goes, so
      // the LAST one wins — it reflects the finished session, not the
      // opening prompt.
      if (line.includes('"ai-title"')) {
        const rec = safeParse(line);
        if (rec && typeof rec.aiTitle === 'string' && rec.aiTitle.trim()) title = rec.aiTitle.trim();
      }

      // Fallback title: the first real user prompt (a string content, not a
      // tool_result array). Only parsed until one is found.
      if (!firstPrompt && isUser && line.includes('"content":"')) {
        const rec = safeParse(line);
        const content = (rec?.message as { content?: unknown } | undefined)?.content;
        if (typeof content === 'string' && content.trim()) {
          firstPrompt = content.trim().replace(/\s+/g, ' ').slice(0, 120);
        }
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  // Aborted/empty transcripts (queue-operation records only) are noise in a
  // picker — drop them rather than showing untitled zero-message rows.
  if (messages === 0) return null;

  const projectPath = cwd || '';
  return {
    id: path.basename(file, '.jsonl'),
    file,
    project: projectPath ? toLabel(projectPath) : labelFromDirName(path.basename(path.dirname(file))),
    projectPath,
    title: title || firstPrompt || '(untitled session)',
    gitBranch,
    startedAt,
    endedAt: endedAt || startedAt,
    messages,
    sizeBytes,
  };
}

function safeParse(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readCache(): Promise<IndexCache> {
  try {
    const raw = await fsp.readFile(getCachePath(), 'utf8');
    const parsed = JSON.parse(raw) as IndexCache;
    if (parsed.version === CACHE_VERSION && parsed.entries) return parsed;
  } catch {
    // Missing or corrupt cache is not an error — it just means a full build.
  }
  return { version: CACHE_VERSION, entries: {} };
}

async function writeCache(cache: IndexCache): Promise<void> {
  try {
    await fsp.mkdir(getConfigDir(), { recursive: true });
    await fsp.writeFile(getCachePath(), JSON.stringify(cache), 'utf8');
  } catch {
    // A cache that can't be written costs speed, never correctness.
  }
}

export interface BuildIndexOptions {
  /** Ignore the cache and re-scan every transcript. */
  refresh?: boolean;
  /** Called after each newly scanned file, for a progress spinner. */
  onProgress?: (done: number, total: number) => void;
}

export interface SessionIndex {
  sessions: SessionMeta[];
  /** Files read fresh this run — 0 means the cache covered everything. */
  scanned: number;
  root: string;
}

/**
 * Index every transcript under the sessions root, reusing cached metadata
 * for files whose mtime and size are both unchanged.
 */
export async function buildIndex(options: BuildIndexOptions = {}): Promise<SessionIndex> {
  const root = getSessionsRoot();
  let projectDirs: string[];
  try {
    const entries = await fsp.readdir(root, { withFileTypes: true });
    projectDirs = entries.filter((e) => e.isDirectory()).map((e) => path.join(root, e.name));
  } catch {
    return { sessions: [], scanned: 0, root };
  }

  const files: Array<{ file: string; mtimeMs: number; size: number }> = [];
  for (const dir of projectDirs) {
    let names: string[];
    try {
      names = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const file = path.join(dir, name);
      try {
        const stat = await fsp.stat(file);
        files.push({ file, mtimeMs: stat.mtimeMs, size: stat.size });
      } catch {
        continue;
      }
    }
  }

  const cache = options.refresh ? { version: CACHE_VERSION, entries: {} } : await readCache();
  const next: IndexCache = { version: CACHE_VERSION, entries: {} };
  const sessions: SessionMeta[] = [];
  let scanned = 0;

  for (const { file, mtimeMs, size } of files) {
    const hit = cache.entries[file];
    if (hit && hit.mtimeMs === mtimeMs && hit.size === size) {
      next.entries[file] = hit;
      sessions.push(hit.meta);
      continue;
    }
    let meta: SessionMeta | null = null;
    try {
      meta = await scanSession(file, size);
    } catch {
      meta = null;
    }
    scanned++;
    options.onProgress?.(scanned, files.length);
    if (!meta) continue;
    next.entries[file] = { mtimeMs, size, meta };
    sessions.push(meta);
  }

  await writeCache(next);
  sessions.sort((a, b) => (a.endedAt < b.endedAt ? 1 : a.endedAt > b.endedAt ? -1 : 0));
  return { sessions, scanned, root };
}

/**
 * `7d` / `24h` / `2w` / `3mo`, or anything Date can parse. Returns null for
 * an unrecognized value so callers can reject it instead of silently
 * treating a typo as "no filter".
 */
export function parseSince(value: string): Date | null {
  const trimmed = value.trim().toLowerCase();
  const rel = /^(\d+)\s*(h|d|w|mo|m)$/.exec(trimmed);
  if (rel) {
    const n = Number(rel[1]);
    const hours = rel[2] === 'h' ? n : rel[2] === 'd' ? n * 24 : rel[2] === 'w' ? n * 24 * 7 : n * 24 * 30;
    return new Date(Date.now() - hours * 3600_000);
  }
  const abs = new Date(trimmed);
  return Number.isNaN(abs.getTime()) ? null : abs;
}

export interface SessionFilter {
  /** Substring match on the project label or its absolute path. */
  project?: string;
  /** Free-text match on title, project, and branch. */
  search?: string;
  since?: Date;
  branch?: string;
  limit?: number;
}

export function filterSessions(sessions: SessionMeta[], filter: SessionFilter): SessionMeta[] {
  const project = filter.project?.toLowerCase();
  const search = filter.search?.toLowerCase();
  const branch = filter.branch?.toLowerCase();
  const sinceIso = filter.since?.toISOString();

  const out = sessions.filter((s) => {
    if (project && !s.project.toLowerCase().includes(project) && !s.projectPath.toLowerCase().includes(project)) {
      return false;
    }
    if (branch && s.gitBranch.toLowerCase() !== branch) return false;
    if (sinceIso && s.endedAt < sinceIso) return false;
    if (search) {
      const hay = `${s.title} ${s.project} ${s.gitBranch}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
  return filter.limit && filter.limit > 0 ? out.slice(0, filter.limit) : out;
}

/** Group an already-filtered session list into projects, most recent first. */
export function listProjects(sessions: SessionMeta[]): ProjectMeta[] {
  const byProject = new Map<string, ProjectMeta>();
  for (const s of sessions) {
    const key = s.projectPath || s.project;
    const existing = byProject.get(key);
    if (existing) {
      existing.sessions++;
      if (s.endedAt > existing.lastActivity) existing.lastActivity = s.endedAt;
    } else {
      byProject.set(key, {
        project: s.project,
        projectPath: s.projectPath,
        sessions: 1,
        lastActivity: s.endedAt,
      });
    }
  }
  return [...byProject.values()].sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : -1));
}

/** Find sessions by full id or unambiguous id prefix. */
export function resolveSessionIds(sessions: SessionMeta[], ids: string[]): { found: SessionMeta[]; missing: string[] } {
  const found: SessionMeta[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const needle = id.trim().toLowerCase();
    const matches = sessions.filter((s) => s.id.toLowerCase() === needle || s.id.toLowerCase().startsWith(needle));
    if (matches.length === 0) missing.push(id);
    else found.push(matches[0]);
  }
  return { found, missing };
}
