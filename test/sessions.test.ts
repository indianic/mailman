import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildIndex,
  filterSessions,
  listProjects,
  parseSince,
  resolveSessionIds,
  getSessionsRoot,
} from '../src/sessions/index.js';
import { extractSkeleton, redact, commitSubject, renderDigest } from '../src/sessions/skeleton.js';

/**
 * A throwaway sessions root + config dir per run, so nothing here reads the
 * developer's real transcripts or writes their real cache.
 */
function makeFixture(): { root: string; cleanup: () => void } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mailman-sessions-'));
  const root = path.join(base, 'projects');
  const config = path.join(base, 'config');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(config, { recursive: true });
  process.env.MAILMAN_SESSIONS_DIR = root;
  process.env.MCP_MAILMAN_CONFIG_DIR = config;
  return { root, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

function writeSession(root: string, dirName: string, id: string, records: unknown[]): void {
  const dir = path.join(root, dirName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), records.map((r) => JSON.stringify(r)).join('\n'), 'utf8');
}

const SESSION_A = [
  { type: 'queue-operation', operation: 'enqueue', timestamp: '2026-07-20T10:00:00.000Z' },
  {
    type: 'user',
    isSidechain: false,
    cwd: '/Users/dev/Sites/Products/alpha',
    gitBranch: 'main',
    timestamp: '2026-07-20T10:00:01.000Z',
    message: { role: 'user', content: 'Fix the release script token handling' },
  },
  {
    type: 'assistant',
    isSidechain: false,
    timestamp: '2026-07-20T10:00:05.000Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Looking at the release script now.' },
        { type: 'tool_use', name: 'Read', input: { file_path: '/Users/dev/Sites/Products/alpha/scripts/release' } },
        { type: 'tool_use', name: 'Edit', input: { file_path: '/Users/dev/Sites/Products/alpha/scripts/release' } },
        { type: 'tool_use', name: 'Bash', input: { command: 'git commit -m "fix(release): read the token from gh auth"' } },
      ],
    },
  },
  // A tool_result envelope — the bulk of a real transcript, and what the
  // skeleton pass must drop. Carries a secret to prove it never leaks.
  {
    type: 'user',
    isSidechain: false,
    timestamp: '2026-07-20T10:00:06.000Z',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'NPM_TOKEN=npm_abcdefghijklmnopqrstuvwxyz0123456789' }] },
  },
  // Sub-agent chatter — also dropped.
  {
    type: 'assistant',
    isSidechain: true,
    timestamp: '2026-07-20T10:00:07.000Z',
    message: { role: 'assistant', content: [{ type: 'text', text: 'subagent internal reasoning' }] },
  },
  { type: 'ai-title', aiTitle: 'Release script token handling', sessionId: 'aaaa1111' },
];

const SESSION_B = [
  {
    type: 'user',
    isSidechain: false,
    cwd: '/Users/dev/Sites/Products/beta',
    gitBranch: 'feature/x',
    timestamp: '2026-07-25T09:00:00.000Z',
    message: { role: 'user', content: 'Add pagination to the list endpoint' },
  },
  {
    type: 'assistant',
    isSidechain: false,
    timestamp: '2026-07-25T09:00:03.000Z',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Adding a cursor param.' }] },
  },
];

// A transcript with no user/assistant records at all — an aborted session.
const SESSION_EMPTY = [{ type: 'queue-operation', operation: 'enqueue', timestamp: '2026-07-26T09:00:00.000Z' }];

test('buildIndex indexes sessions with title, project, branch and dates', async () => {
  const { root, cleanup } = makeFixture();
  try {
    writeSession(root, '-Users-dev-Sites-Products-alpha', 'aaaa1111-0000-0000-0000-000000000001', SESSION_A);
    writeSession(root, '-Users-dev-Sites-Products-beta', 'bbbb2222-0000-0000-0000-000000000002', SESSION_B);

    const index = await buildIndex({ refresh: true });
    assert.equal(index.sessions.length, 2);

    const alpha = index.sessions.find((s) => s.project === 'Products/alpha');
    assert.ok(alpha, 'alpha session indexed');
    assert.equal(alpha.title, 'Release script token handling', 'ai-title wins over the first prompt');
    assert.equal(alpha.gitBranch, 'main');
    assert.equal(alpha.projectPath, '/Users/dev/Sites/Products/alpha');
    assert.equal(alpha.startedAt, '2026-07-20T10:00:00.000Z');
    assert.equal(alpha.messages, 4, 'user + assistant records, including sidechain and tool_result envelopes');

    // Newest first.
    assert.equal(index.sessions[0].project, 'Products/beta');
  } finally {
    cleanup();
  }
});

test('sessions with no user/assistant records are dropped', async () => {
  const { root, cleanup } = makeFixture();
  try {
    writeSession(root, '-Users-dev-Sites-Products-alpha', 'aaaa1111-0000-0000-0000-000000000001', SESSION_A);
    writeSession(root, '-Users-dev-Sites-Products-alpha', 'cccc3333-0000-0000-0000-000000000003', SESSION_EMPTY);
    const index = await buildIndex({ refresh: true });
    assert.equal(index.sessions.length, 1);
  } finally {
    cleanup();
  }
});

test('falls back to the first user prompt when no ai-title record exists', async () => {
  const { root, cleanup } = makeFixture();
  try {
    writeSession(root, '-Users-dev-Sites-Products-beta', 'bbbb2222-0000-0000-0000-000000000002', SESSION_B);
    const index = await buildIndex({ refresh: true });
    assert.equal(index.sessions[0].title, 'Add pagination to the list endpoint');
  } finally {
    cleanup();
  }
});

test('the index cache is reused until a transcript changes', async () => {
  const { root, cleanup } = makeFixture();
  try {
    const file = 'aaaa1111-0000-0000-0000-000000000001';
    writeSession(root, '-Users-dev-Sites-Products-alpha', file, SESSION_A);

    const first = await buildIndex({ refresh: true });
    assert.equal(first.scanned, 1);

    const second = await buildIndex();
    assert.equal(second.scanned, 0, 'unchanged file served from cache');
    assert.equal(second.sessions.length, 1);

    // Appending changes both size and mtime → re-scanned.
    fs.appendFileSync(
      path.join(root, '-Users-dev-Sites-Products-alpha', `${file}.jsonl`),
      `\n${JSON.stringify({ type: 'user', isSidechain: false, timestamp: '2026-07-20T11:00:00.000Z', message: { role: 'user', content: 'one more thing' } })}`,
      'utf8',
    );
    const third = await buildIndex();
    assert.equal(third.scanned, 1, 'changed file re-scanned');
    assert.equal(third.sessions[0].messages, 5);
  } finally {
    cleanup();
  }
});

test('filterSessions narrows by project, search, branch and recency', async () => {
  const { root, cleanup } = makeFixture();
  try {
    writeSession(root, '-Users-dev-Sites-Products-alpha', 'aaaa1111-0000-0000-0000-000000000001', SESSION_A);
    writeSession(root, '-Users-dev-Sites-Products-beta', 'bbbb2222-0000-0000-0000-000000000002', SESSION_B);
    const { sessions } = await buildIndex({ refresh: true });

    assert.equal(filterSessions(sessions, { project: 'alpha' }).length, 1);
    assert.equal(filterSessions(sessions, { search: 'pagination' }).length, 1);
    assert.equal(filterSessions(sessions, { branch: 'feature/x' }).length, 1);
    assert.equal(filterSessions(sessions, { since: new Date('2026-07-24T00:00:00Z') }).length, 1);
    assert.equal(filterSessions(sessions, { limit: 1 }).length, 1);
    assert.equal(filterSessions(sessions, { project: 'nope' }).length, 0);
  } finally {
    cleanup();
  }
});

test('listProjects rolls sessions up per project, most recent first', async () => {
  const { root, cleanup } = makeFixture();
  try {
    writeSession(root, '-Users-dev-Sites-Products-alpha', 'aaaa1111-0000-0000-0000-000000000001', SESSION_A);
    writeSession(root, '-Users-dev-Sites-Products-beta', 'bbbb2222-0000-0000-0000-000000000002', SESSION_B);
    const { sessions } = await buildIndex({ refresh: true });
    const projects = listProjects(sessions);
    assert.equal(projects.length, 2);
    assert.equal(projects[0].project, 'Products/beta', 'most recent activity first');
    assert.equal(projects[0].sessions, 1);
  } finally {
    cleanup();
  }
});

test('resolveSessionIds accepts a unique prefix and reports misses', async () => {
  const { root, cleanup } = makeFixture();
  try {
    writeSession(root, '-Users-dev-Sites-Products-alpha', 'aaaa1111-0000-0000-0000-000000000001', SESSION_A);
    const { sessions } = await buildIndex({ refresh: true });

    const ok = resolveSessionIds(sessions, ['aaaa1111']);
    assert.equal(ok.found.length, 1);
    assert.deepEqual(ok.missing, []);

    const bad = resolveSessionIds(sessions, ['zzzz']);
    assert.equal(bad.found.length, 0);
    assert.deepEqual(bad.missing, ['zzzz']);
  } finally {
    cleanup();
  }
});

test('extractSkeleton keeps intent and drops every tool result', async () => {
  const { root, cleanup } = makeFixture();
  try {
    writeSession(root, '-Users-dev-Sites-Products-alpha', 'aaaa1111-0000-0000-0000-000000000001', SESSION_A);
    const { sessions } = await buildIndex({ refresh: true });
    const skeleton = await extractSkeleton(sessions[0]);

    assert.equal(skeleton.userPrompts, 1, 'tool_result envelopes are not prompts');
    assert.equal(skeleton.turns.length, 2, 'one prompt + one assistant turn; sidechain dropped');
    assert.equal(skeleton.turns[0].text, 'Fix the release script token handling');

    const serialized = JSON.stringify(skeleton);
    assert.ok(!serialized.includes('npm_abcdefghijklmnopqrstuvwxyz'), 'tool result content never reaches the skeleton');
    assert.ok(!serialized.includes('subagent internal reasoning'), 'sidechain turns are dropped');

    assert.deepEqual(skeleton.filesTouched, ['scripts/release'], 'Edit target, repo-relative; Read is not a touch');
    assert.deepEqual(skeleton.commits, ['fix(release): read the token from gh auth']);
    assert.equal(skeleton.toolCounts.Edit, 1);
    assert.equal(skeleton.toolCounts.Read, 1);
    assert.ok(skeleton.turns[1].tools?.some((t) => t.startsWith('Edit ')), 'tool calls keep their target');
  } finally {
    cleanup();
  }
});

test('extractSkeleton truncates long sessions from the middle', async () => {
  const { root, cleanup } = makeFixture();
  try {
    const records = [];
    for (let i = 0; i < 60; i++) {
      records.push({
        type: 'user',
        isSidechain: false,
        cwd: '/Users/dev/Sites/Products/alpha',
        timestamp: `2026-07-20T10:${String(i).padStart(2, '0')}:00.000Z`,
        message: { role: 'user', content: `prompt number ${i}` },
      });
    }
    writeSession(root, '-Users-dev-Sites-Products-alpha', 'dddd4444-0000-0000-0000-000000000004', records);
    const { sessions } = await buildIndex({ refresh: true });

    const skeleton = await extractSkeleton(sessions[0], { maxTurns: 10 });
    assert.equal(skeleton.truncated, true);
    assert.equal(skeleton.turns.length, 10);
    assert.equal(skeleton.turns[0].text, 'prompt number 0', 'keeps the opening');
    assert.equal(skeleton.turns[9].text, 'prompt number 59', 'keeps the close');
  } finally {
    cleanup();
  }
});

test('redact scrubs known secret shapes', () => {
  assert.match(redact('key sk-abcdefghijklmnopqrstuvwxyz'), /\[redacted:api-key\]/);
  assert.match(redact('token ghp_abcdefghijklmnopqrstuvwxyz01'), /\[redacted:github-token\]/);
  assert.match(redact('aws AKIAIOSFODNN7EXAMPLE here'), /\[redacted:aws-key\]/);
  assert.match(redact('npm_abcdefghijklmnopqrstuvwxyz0123456789'), /\[redacted:npm-token\]/);
  assert.match(redact('PASSWORD=hunter2istoolong'), /\[redacted\]/);
  assert.match(redact('Authorization: Bearer abcdefghijklmnop'), /\[redacted\]/);
  assert.match(
    redact('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.dBjftJeZ4CVPmB92K27uhbUJU1p1r'),
    /\[redacted:jwt\]/,
  );
  assert.match(redact('-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----'), /\[redacted:private-key\]/);
  assert.equal(redact('nothing secret here'), 'nothing secret here');
});

test('redact shortens the home directory', () => {
  const home = os.homedir();
  assert.equal(redact(`${home}/Sites/x`), '~/Sites/x');
});

test('commitSubject pulls the subject out of a git commit call', () => {
  assert.equal(commitSubject('git commit -m "feat: add thing"'), 'feat: add thing');
  assert.equal(commitSubject("git add -A && git commit -m 'fix: other'"), 'fix: other');
  assert.equal(commitSubject('git commit -m "feat: first line\nbody line"'), 'feat: first line');
  assert.equal(commitSubject('git status'), null);
});

test('renderDigest lists facts, never prose', async () => {
  const { root, cleanup } = makeFixture();
  try {
    writeSession(root, '-Users-dev-Sites-Products-alpha', 'aaaa1111-0000-0000-0000-000000000001', SESSION_A);
    const { sessions } = await buildIndex({ refresh: true });
    const digest = renderDigest([await extractSkeleton(sessions[0])]);

    assert.match(digest, /## Release script token handling/);
    assert.match(digest, /Products\/alpha/);
    assert.match(digest, /files touched \(1\)/);
    assert.match(digest, /scripts\/release/);
    assert.match(digest, /commits \(1\)/);
    assert.match(digest, /branch: main/);
  } finally {
    cleanup();
  }
});

test('parseSince understands relative windows and absolute dates', () => {
  const before = Date.now();
  const sevenDays = parseSince('7d');
  assert.ok(sevenDays && before - sevenDays.getTime() >= 7 * 24 * 3600_000 - 1000);
  assert.ok(parseSince('24h'));
  assert.ok(parseSince('2w'));
  assert.ok(parseSince('3mo'));
  assert.equal(parseSince('2026-07-01')?.toISOString().slice(0, 10), '2026-07-01');
  assert.equal(parseSince('last tuesday'), null);
  assert.equal(parseSince(''), null);
});

test('getSessionsRoot honors the override and falls back to the host default', () => {
  const saved = process.env.MAILMAN_SESSIONS_DIR;
  process.env.MAILMAN_SESSIONS_DIR = '/tmp/elsewhere';
  assert.equal(getSessionsRoot(), '/tmp/elsewhere');
  delete process.env.MAILMAN_SESSIONS_DIR;
  assert.equal(getSessionsRoot(), path.join(os.homedir(), '.claude', 'projects'));
  if (saved) process.env.MAILMAN_SESSIONS_DIR = saved;
});

test('buildIndex returns empty rather than throwing when the root is missing', async () => {
  const saved = process.env.MAILMAN_SESSIONS_DIR;
  process.env.MAILMAN_SESSIONS_DIR = path.join(os.tmpdir(), 'mailman-no-such-root-xyz');
  const index = await buildIndex({ refresh: true });
  assert.deepEqual(index.sessions, []);
  if (saved) process.env.MAILMAN_SESSIONS_DIR = saved;
  else delete process.env.MAILMAN_SESSIONS_DIR;
});
