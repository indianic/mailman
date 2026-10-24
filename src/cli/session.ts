import fsp from 'node:fs/promises';
import path from 'node:path';
import { intro, outro, select, multiselect, isCancel, cancel, spinner } from '@clack/prompts';
import { section, detail, check, fail, info, attention } from './tree.js';
import { isInteractiveTerminal, requireTty } from './interactive.js';
import {
  buildIndex,
  filterSessions,
  listProjects,
  parseSince,
  resolveSessionIds,
  type SessionMeta,
} from '../sessions/index.js';
import { extractSkeleton, renderDigest, type SessionSkeleton } from '../sessions/skeleton.js';

/**
 * `mailman session list` / `mailman session report` — find past AI sessions
 * (project-wise or across everything), pick one or many, and turn them into a
 * digest worth emailing.
 *
 * The pickers deliberately reuse the two patterns already in this CLI rather
 * than inventing a third: account.ts's `pickAccount` (clack `select`, one
 * choice) and register-editors.ts's `promptAndWriteEditorConfigs` (clack
 * `multiselect`, many). Rendering goes through tree.ts like every other
 * command.
 *
 * Scope note, stated in the output too: this command has no model, so what it
 * produces is a MECHANICAL digest — titles, files touched, commits, counts.
 * The prose summary is the job of the `list_sessions` + `read_session_digest`
 * MCP tools, where a Claude session is in the loop to write it.
 */

interface Flags {
  project?: string;
  search?: string;
  since?: string;
  branch?: string;
  limit?: number;
  ids: string[];
  all: boolean;
  refresh: boolean;
  json: boolean;
  out?: string;
}

function parseFlags(args: string[]): Flags | { error: string } {
  const flags: Flags = { ids: [], all: false, refresh: false, json: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const takesValue = ['--project', '--search', '--since', '--branch', '--limit', '--out', '--session'];
    if (takesValue.includes(arg)) {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) return { error: `${arg} needs a value` };
      i++;
      if (arg === '--project') flags.project = value;
      else if (arg === '--search') flags.search = value;
      else if (arg === '--since') flags.since = value;
      else if (arg === '--branch') flags.branch = value;
      else if (arg === '--out') flags.out = value;
      else if (arg === '--session') flags.ids.push(...value.split(',').map((v) => v.trim()).filter(Boolean));
      else if (arg === '--limit') {
        const n = Number(value);
        if (!Number.isInteger(n) || n <= 0) return { error: '--limit needs a positive whole number' };
        flags.limit = n;
      }
      continue;
    }
    if (arg === '--all') flags.all = true;
    else if (arg === '--refresh') flags.refresh = true;
    else if (arg === '--json') flags.json = true;
    else if (arg.startsWith('--')) return { error: `Unknown flag: ${arg}` };
    else flags.ids.push(arg);
  }
  return flags;
}

function pad(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width);
}

function shortDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 10);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * One picker row: date, title, size — padded so the columns line up inside
 * clack. The date shown is `endedAt`, the same field the list is sorted by:
 * showing `startedAt` next to an endedAt sort made the list look unsorted for
 * long-running sessions (a real one here started Jul 6 and ended Jul 17, so
 * it landed between two Jul 24 rows while displaying "2026-07-06").
 */
function sessionLabel(s: SessionMeta, withProject: boolean): string {
  const left = withProject ? `${pad(s.project, 24)}  ` : '';
  return `${shortDate(s.endedAt)}  ${left}${pad(s.title, 46)}  ${String(s.messages).padStart(4)} msgs`;
}

/**
 * Build (or refresh) the index behind a spinner. The first ever run reads
 * every transcript once; after that only changed files are re-read, so this
 * is normally instant.
 */
async function loadIndex(refresh: boolean): Promise<SessionMeta[] | null> {
  const spin = isInteractiveTerminal() ? spinner() : null;
  spin?.start('Indexing sessions');
  const index = await buildIndex({
    refresh,
    onProgress: (done, total) => spin?.message(`Indexing sessions — ${done}/${total} new or changed`),
  });
  spin?.stop(index.scanned > 0 ? `Indexed ${index.sessions.length} sessions (${index.scanned} read fresh)` : `${index.sessions.length} sessions (cached)`);

  if (index.sessions.length === 0) {
    fail(`No session transcripts found under ${index.root}`);
    info('Set MAILMAN_SESSIONS_DIR if your AI tool stores them elsewhere.');
    return null;
  }
  return index.sessions;
}

/** Shared filter step — returns null after printing its own failure. */
function applyFilters(sessions: SessionMeta[], flags: Flags): SessionMeta[] | null {
  let since: Date | undefined;
  if (flags.since) {
    const parsed = parseSince(flags.since);
    if (!parsed) {
      fail(`Unrecognized --since value: "${flags.since}". Use 24h, 7d, 2w, 3mo, or a date like 2026-07-01.`);
      return null;
    }
    since = parsed;
  }
  return filterSessions(sessions, {
    project: flags.project,
    search: flags.search,
    branch: flags.branch,
    since,
    limit: flags.limit,
  });
}

/** `mailman session list [--project X] [--since 7d] [--search q] [--all]` */
export async function runSessionList(args: string[]): Promise<void> {
  const parsed = parseFlags(args);
  intro('mailman — sessions');
  if ('error' in parsed) {
    fail(`${parsed.error}\nUsage: mailman session list [--project X] [--since 7d] [--search q] [--branch b] [--limit N] [--all] [--refresh] [--json]`);
    process.exit(1);
  }
  const flags = parsed;

  const all = await loadIndex(flags.refresh);
  if (!all) process.exit(1);

  const matched = applyFilters(all, flags);
  if (!matched) process.exit(1);

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(matched, null, 2)}\n`);
    return;
  }

  if (matched.length === 0) {
    outro('No sessions matched those filters.');
    return;
  }

  // No project filter → lead with the project roll-up, which is the level
  // most people actually pick at first ("project wise, then session wise").
  if (!flags.project) {
    const projects = listProjects(matched);
    section(`projects (${projects.length})`);
    for (const p of projects.slice(0, flags.all ? projects.length : 12)) {
      detail(`${pad(p.project, 30)}  ${plural(p.sessions, 'session').padStart(13)}   last: ${shortDate(p.lastActivity)}`);
    }
    if (!flags.all && projects.length > 12) {
      detail(`… ${projects.length - 12} more — pass --all to see every project`);
    }
  }

  const cap = flags.all ? matched.length : 20;
  section(`sessions${flags.project ? ` — ${flags.project}` : ''} (${matched.length})`);
  for (const s of matched.slice(0, cap)) {
    detail(`${s.id.slice(0, 8)}  ${sessionLabel(s, !flags.project)}`);
  }
  if (matched.length > cap) {
    detail(`… ${matched.length - cap} more — pass --all, or narrow with --project / --since / --search`);
  }

  outro('`mailman session report` — pick some and build a digest');
}

/** Interactive two-step: project, then sessions within it. */
async function pickSessions(sessions: SessionMeta[], projectFiltered: boolean): Promise<SessionMeta[]> {
  let pool = sessions;

  if (!projectFiltered) {
    const projects = listProjects(sessions);
    if (projects.length > 1) {
      const chosen = await select({
        message: 'Which project?',
        options: [
          { value: '*', label: `All projects  (${plural(sessions.length, 'session')})` },
          ...projects.map((p) => ({
            value: p.projectPath || p.project,
            label: `${pad(p.project, 30)}  ${plural(p.sessions, 'session').padStart(13)}   last: ${shortDate(p.lastActivity)}`,
          })),
        ],
      });
      if (isCancel(chosen)) {
        cancel('Cancelled.');
        process.exit(1);
      }
      if (chosen !== '*') {
        pool = sessions.filter((s) => (s.projectPath || s.project) === chosen);
      }
    }
  }

  // clack renders every option into the terminal; a few thousand rows is
  // unusable, so cap and say so rather than silently truncating.
  const CAP = 40;
  const shown = pool.slice(0, CAP);
  if (pool.length > CAP) {
    attention(`Showing the ${CAP} most recent of ${pool.length} — narrow with --since / --search for the rest.`);
  }

  const picked = await multiselect({
    message: 'Which sessions? (space to select, enter to confirm)',
    options: shown.map((s) => ({ value: s.id, label: sessionLabel(s, true) })),
    required: false,
  });
  if (isCancel(picked)) {
    cancel('Cancelled.');
    process.exit(1);
  }
  const ids = picked as string[];
  return shown.filter((s) => ids.includes(s.id));
}

/**
 * `mailman session report [ids…] [filters] [--out file] [--json]`
 *
 * Prints the mechanical digest. Does NOT send — sending is draft/confirm, and
 * the composition worth sending needs a model. See the closing note it prints.
 */
export async function runSessionReport(args: string[]): Promise<void> {
  const parsed = parseFlags(args);
  intro('mailman — session report');
  if ('error' in parsed) {
    fail(`${parsed.error}\nUsage: mailman session report [<session-id>…] [--project X] [--since 7d] [--search q] [--out file] [--json]`);
    process.exit(1);
  }
  const flags = parsed;

  const all = await loadIndex(flags.refresh);
  if (!all) process.exit(1);

  const matched = applyFilters(all, flags);
  if (!matched) process.exit(1);

  let chosen: SessionMeta[];
  if (flags.ids.length > 0) {
    const { found, missing } = resolveSessionIds(all, flags.ids);
    if (missing.length > 0) {
      fail(`No session matched: ${missing.join(', ')}\nRun \`mailman session list\` to see ids.`);
      process.exit(1);
    }
    chosen = found;
  } else {
    if (matched.length === 0) {
      outro('No sessions matched those filters.');
      return;
    }
    // Non-interactive with filters but no ids: take the filtered set as-is,
    // so this composes in scripts instead of dying on a missing TTY.
    if (!isInteractiveTerminal()) {
      if (!flags.project && !flags.search && !flags.since && !flags.branch) {
        requireTty(
          'Picking sessions',
          'Or pass ids directly: `mailman session report <id> <id>`, or filter with --project / --since.',
        );
      }
      chosen = matched.slice(0, flags.limit ?? 10);
    } else {
      chosen = await pickSessions(matched, Boolean(flags.project));
      if (chosen.length === 0) {
        outro('Nothing selected.');
        return;
      }
    }
  }

  const spin = isInteractiveTerminal() ? spinner() : null;
  spin?.start(`Reading ${chosen.length} session(s)`);
  const skeletons: SessionSkeleton[] = [];
  for (const meta of chosen) {
    spin?.message(`Reading ${meta.title}`);
    try {
      skeletons.push(await extractSkeleton(meta));
    } catch (err) {
      spin?.stop('Read failed');
      fail(`Could not read ${meta.id}: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }
  spin?.stop(`Read ${skeletons.length} session(s)`);

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(skeletons, null, 2)}\n`);
    return;
  }

  const digest = renderDigest(skeletons);

  if (flags.out) {
    const target = path.resolve(flags.out);
    await fsp.writeFile(target, `${digest}\n`, 'utf8');
    section('written');
    detail(target);
  } else {
    section(`digest — ${skeletons.length} session(s)`);
    for (const line of digest.split('\n')) detail(line);
  }

  const files = new Set(skeletons.flatMap((s) => s.filesTouched));
  const commits = skeletons.reduce((n, s) => n + s.commits.length, 0);
  section('totals');
  detail(`${plural(skeletons.length, 'session')}   ${plural(files.size, 'file')} touched   ${plural(commits, 'commit')}`);
  check(true, 'secrets scrubbed (tool output dropped, known token shapes redacted)');

  section('to email this');
  info('This CLI has no model, so the above is mechanical — facts, not prose.');
  detail('For a written summary, ask your AI tool:');
  detail('  "mailman, summarize my last 3 mailman sessions and email them to kalpesh@example.com"');
  detail('It calls list_sessions + read_session_digest, writes the summary, then draft_email → confirm_send.');

  outro(`${skeletons.length} session(s) digested`);
}
