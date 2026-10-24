import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import type { SessionMeta } from './index.js';

/**
 * Turns one transcript into a compact, scrubbed skeleton a model can read.
 *
 * The reduction that makes this viable: every tool RESULT is dropped. Results
 * are both the overwhelming majority of a transcript's bytes (file reads,
 * command output, search hits) and the place pasted secrets and `.env`
 * contents actually land. What survives is intent — the user's prompts, a
 * truncated line of each reply, and the NAME + TARGET of each tool call —
 * which is what a summary is written from anyway.
 *
 * In practice this takes a 38 MB session to a few KB.
 */

export interface SkeletonTurn {
  role: 'user' | 'assistant';
  text: string;
  /** Tool calls made in this assistant turn, as "Edit src/foo.ts". */
  tools?: string[];
}

export interface SessionSkeleton {
  meta: SessionMeta;
  turns: SkeletonTurn[];
  /** Distinct paths passed to Edit/Write/NotebookEdit. */
  filesTouched: string[];
  /** Commit subjects taken from `git commit -m` calls. */
  commits: string[];
  /** Tool name → call count, for a cheap "what kind of session was this". */
  toolCounts: Record<string, number>;
  userPrompts: number;
  /** True when the caps below dropped content. */
  truncated: boolean;
}

export interface SkeletonOptions {
  /** Max user prompt characters kept per turn. */
  maxPromptChars?: number;
  /** Max assistant reply characters kept per turn. */
  maxReplyChars?: number;
  /** Max turns kept; the middle is dropped, keeping the start and the end. */
  maxTurns?: number;
  /** Skip redaction. Off by default and never exposed over MCP. */
  raw?: boolean;
}

const DEFAULTS = {
  maxPromptChars: 600,
  maxReplyChars: 300,
  maxTurns: 80,
};

/**
 * Shapes that are secrets regardless of surrounding context. Ordered
 * longest/most-specific first so a private key block isn't first mangled by
 * a narrower rule.
 *
 * This is a safety net, not a guarantee — the real protection is that tool
 * results never reach here, plus draft_email's mandatory preview before
 * anything is sent.
 */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted:private-key]'],
  [/\bey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted:jwt]'],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, '[redacted:api-key]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[redacted:github-token]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[redacted:github-token]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, '[redacted:slack-token]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[redacted:aws-key]'],
  [/\bAIza[0-9A-Za-z_-]{30,}\b/g, '[redacted:google-key]'],
  [/\bnpm_[A-Za-z0-9]{30,}\b/g, '[redacted:npm-token]'],
  // `Bearer xyz` — must run before the assignment rule below, which would
  // otherwise consume the word "Bearer" as the value and leave the real
  // token sitting in the clear right after it.
  [/\bBearer\s+([A-Za-z0-9._~+/=-]{12,})/gi, 'Bearer [redacted]'],
  // Assignment form: `PASSWORD=hunter2`, `"api_key": "abc…"`.
  //
  // An explicit `=` or `:` is required. An earlier version accepted bare
  // whitespace, which redacted ordinary English the moment a prompt used one
  // of these words as a noun — "fix the release script token handling"
  // became "…token [redacted]". Session prompts talk about tokens and
  // passwords constantly, so the looser rule destroyed real content.
  // The lookaheads stop it re-redacting a placeholder a rule above produced.
  [
    /\b(password|passwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|authorization)(["']?\s*[:=]\s*["']?)(?!\[redacted)(?!Bearer\b)([^\s"',;}]{6,})/gi,
    '$1$2[redacted]',
  ],
];

/** Scrub known secret shapes and shorten the home directory to `~`. */
export function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  const home = os.homedir();
  if (home && home.length > 1) {
    out = out.split(home).join('~');
  }
  return out;
}

function squash(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** The one argument that says what a tool call was aimed at. */
function toolTarget(name: string, input: Record<string, unknown>): string {
  const first = (...keys: string[]): string => {
    for (const k of keys) {
      const v = input[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  };
  const target = first('file_path', 'path', 'notebook_path', 'command', 'pattern', 'query', 'url', 'prompt');
  return target ? squash(target, 120) : '';
}

const COMMIT_SUBJECT_RE = /git\s+commit\b[\s\S]*?-m\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/;

/** Extract the subject line of a `git commit -m "…"` invocation, if present. */
export function commitSubject(command: string): string | null {
  const m = COMMIT_SUBJECT_RE.exec(command);
  if (!m) return null;
  const raw = (m[1] ?? m[2] ?? '').replace(/\\"/g, '"');
  const subject = raw.split('\n')[0].trim();
  return subject || null;
}

interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export async function extractSkeleton(meta: SessionMeta, options: SkeletonOptions = {}): Promise<SessionSkeleton> {
  const maxPromptChars = options.maxPromptChars ?? DEFAULTS.maxPromptChars;
  const maxReplyChars = options.maxReplyChars ?? DEFAULTS.maxReplyChars;
  const maxTurns = options.maxTurns ?? DEFAULTS.maxTurns;

  const turns: SkeletonTurn[] = [];
  const filesTouched = new Set<string>();
  const commits: string[] = [];
  const toolCounts: Record<string, number> = {};
  let userPrompts = 0;
  let truncated = false;

  const stream = fs.createReadStream(meta.file, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      if (line.length < 8) continue;
      const isUser = line.includes('"type":"user"');
      const isAssistant = line.includes('"type":"assistant"');
      if (!isUser && !isAssistant) continue;

      let rec: Record<string, unknown>;
      try {
        rec = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      // Sub-agent transcripts are interleaved into the same file; their
      // internal chatter isn't what the user did.
      if (rec.isSidechain === true) continue;

      const message = rec.message as { role?: string; content?: unknown } | undefined;
      const content = message?.content;

      if (rec.type === 'user') {
        // A string content is a real prompt; an array is a tool_result
        // envelope, which is exactly what this pass exists to drop.
        if (typeof content !== 'string') continue;
        const text = squash(content, maxPromptChars);
        if (!text) continue;
        userPrompts++;
        turns.push({ role: 'user', text });
        continue;
      }

      if (rec.type !== 'assistant' || !Array.isArray(content)) continue;
      const blocks = content as ContentBlock[];
      const texts: string[] = [];
      const tools: string[] = [];
      for (const block of blocks) {
        if (block.type === 'text' && typeof block.text === 'string') {
          texts.push(block.text);
        } else if (block.type === 'tool_use' && typeof block.name === 'string') {
          const name = block.name;
          const input = (block.input ?? {}) as Record<string, unknown>;
          toolCounts[name] = (toolCounts[name] ?? 0) + 1;

          const filePath = input.file_path ?? input.notebook_path;
          if ((name === 'Edit' || name === 'Write' || name === 'NotebookEdit') && typeof filePath === 'string') {
            filesTouched.add(filePath);
          }
          if (name === 'Bash' && typeof input.command === 'string') {
            const subject = commitSubject(input.command);
            if (subject) commits.push(subject);
          }
          const target = toolTarget(name, input);
          tools.push(target ? `${name} ${target}` : name);
        }
      }
      const text = squash(texts.join(' '), maxReplyChars);
      if (!text && tools.length === 0) continue;
      turns.push({ role: 'assistant', text, ...(tools.length ? { tools } : {}) });
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  // Keep the opening (what was asked) and the close (what was concluded);
  // the middle of a long session is where the repetition lives.
  let kept = turns;
  if (turns.length > maxTurns) {
    truncated = true;
    const head = Math.ceil(maxTurns * 0.6);
    kept = [...turns.slice(0, head), ...turns.slice(turns.length - (maxTurns - head))];
  }

  const scrub = (t: string): string => (options.raw ? t : redact(t));

  return {
    meta,
    turns: kept.map((t) => ({
      ...t,
      text: scrub(t.text),
      ...(t.tools ? { tools: t.tools.map(scrub) } : {}),
    })),
    filesTouched: [...filesTouched].map((f) => scrub(shortenPath(f, meta.projectPath))).sort(),
    commits: commits.map(scrub),
    toolCounts,
    userPrompts,
    truncated,
  };
}

/** Repo-relative when the file is inside the session's project, else `~`-shortened. */
function shortenPath(file: string, projectPath: string): string {
  if (projectPath && file.startsWith(projectPath)) {
    const rel = path.relative(projectPath, file);
    if (rel && !rel.startsWith('..')) return rel;
  }
  return file;
}

/**
 * Mechanical digest — the CLI's output, and the header the MCP path hands to
 * Claude. Deliberately a list of facts, never prose: no model runs here.
 */
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function renderDigest(skeletons: SessionSkeleton[]): string {
  const lines: string[] = [];
  for (const s of skeletons) {
    const date = s.meta.startedAt ? s.meta.startedAt.slice(0, 10) : 'unknown date';
    lines.push(`## ${s.meta.title}`);
    lines.push(`${s.meta.project} · ${date} · ${plural(s.meta.messages, 'record')} · ${plural(s.userPrompts, 'prompt')}`);
    if (s.meta.gitBranch) lines.push(`branch: ${s.meta.gitBranch}`);
    lines.push('');

    if (s.filesTouched.length) {
      lines.push(`files touched (${s.filesTouched.length}):`);
      for (const f of s.filesTouched) lines.push(`  - ${f}`);
      lines.push('');
    }
    if (s.commits.length) {
      lines.push(`commits (${s.commits.length}):`);
      for (const c of s.commits) lines.push(`  - ${c}`);
      lines.push('');
    }
    const tools = Object.entries(s.toolCounts).sort((a, b) => b[1] - a[1]);
    if (tools.length) {
      lines.push(`tools: ${tools.map(([n, c]) => `${n}×${c}`).join(', ')}`);
      lines.push('');
    }
    if (s.truncated) {
      lines.push('(long session — middle turns omitted)');
      lines.push('');
    }
  }
  return lines.join('\n').trimEnd();
}
