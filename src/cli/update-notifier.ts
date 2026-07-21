import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import { getConfigDir } from '../config/paths.js';
import { getPackageName, getPackageVersion } from '../version.js';

/**
 * Passive "update available" notifier — the npm/MCPHub pattern: every
 * interactive command prints a short notice BEFORE its own output when a
 * newer version is known, without ever blocking on the network.
 *
 * How it stays instant: the notice is rendered from a cached latest-version
 * (`update-check.json` in the config dir). When that cache is missing or
 * older than TTL_MS, we fire a *detached, unref'd* background process
 * (`mailman __refresh-update-cache`) that hits the registry and rewrites the
 * cache, then exits — the current command never waits for it. So the very
 * first run shows nothing but seeds the cache; subsequent runs show the
 * notice. This mirrors `mailman update` (src/cli/update.ts), which does the
 * active upgrade; here we only *tell*, we never install.
 *
 * The notifier must never break a command: every path is wrapped so a
 * corrupt cache, offline registry, or missing binary is silently ignored.
 */

const execFileAsync = promisify(execFile);
const PKG = getPackageName();
const TTL_MS = 24 * 60 * 60 * 1000; // check the registry at most once a day
// Hidden subcommand the detached refresh re-enters through — not in the
// COMMANDS table, so it never shows in `help` or typo suggestions.
export const REFRESH_COMMAND = '__refresh-update-cache';

interface UpdateCache {
  latest: string;
  checkedAt: number;
}

function cachePath(): string {
  return path.join(getConfigDir(), 'update-check.json');
}

function readCache(): UpdateCache | null {
  try {
    const parsed = JSON.parse(readFileSync(cachePath(), 'utf8')) as Partial<UpdateCache>;
    if (typeof parsed.latest === 'string' && typeof parsed.checkedAt === 'number') {
      return { latest: parsed.latest, checkedAt: parsed.checkedAt };
    }
  } catch {
    // Missing or corrupt cache — treated as "no data", triggers a refresh.
  }
  return null;
}

/**
 * True when `latest` is strictly newer than `current`. Numeric per-part
 * compare of plain x.y.z versions (mailman ships no prereleases); a trailing
 * `-tag` is dropped defensively so a stray `1.2.3-beta` never reads as newer
 * than `1.2.3`. Exported for unit tests.
 */
export function isNewerVersion(latest: string, current: string): boolean {
  const parts = (v: string): number[] =>
    v.replace(/^v/, '').split('-')[0].split('.').map((n) => Number.parseInt(n, 10) || 0);
  const a = parts(latest);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/**
 * Whether to suppress the notice entirely: non-interactive stdout (scripts,
 * MCP stdio, pipes), CI, or an explicit opt-out. Follows the de-facto
 * `NO_UPDATE_NOTIFIER` convention plus a mailman-scoped variant.
 */
function suppressed(): boolean {
  return (
    !process.stdout.isTTY ||
    process.env.CI != null ||
    process.env.NO_UPDATE_NOTIFIER != null ||
    process.env.MAILMAN_NO_UPDATE_NOTIFIER != null
  );
}

function renderNotice(current: string, latest: string): void {
  const bar = pc.gray('│');
  // A short pre-amble in the shared diamond-trail palette (yellow ▲ = the
  // codebase's "attention" glyph, gray rail), sitting above the command's
  // own `┌ title` intro. Trailing blank rail separates it from that box.
  process.stdout.write(`${pc.yellow('▲')}  Update available: ${pc.dim(current)} → ${pc.green(latest)}\n`);
  process.stdout.write(`${bar}  Run ${pc.cyan('mailman update')} to upgrade, then restart your AI tool.\n`);
  process.stdout.write(`${bar}\n`);
}

/** Spawn the detached background refresh; failures to spawn are ignored. */
function spawnRefresh(): void {
  try {
    const bin = process.argv[1];
    if (!bin) return;
    const child = spawn(process.execPath, [bin, REFRESH_COMMAND], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {
    // Can't spawn (sandboxed / odd PATH) — just skip; next run tries again.
  }
}

/**
 * Called once per command, before dispatch. Prints the notice from cache when
 * an update is known, and seeds/refreshes the cache in the background when
 * stale. `command` is the resolved subcommand so self-referential or
 * machine-facing commands can opt out.
 */
export function maybeNotifyUpdate(command: string): void {
  try {
    // `update`/`upgrade` report versions themselves; `send-scheduled` is the
    // launchd ticker (never interactive). Skip the notice for these.
    if (command === 'update' || command === 'upgrade' || command === 'send-scheduled') return;
    if (suppressed()) return;

    const current = getPackageVersion();
    const cache = readCache();
    if (cache && isNewerVersion(cache.latest, current)) {
      renderNotice(current, cache.latest);
    }
    if (!cache || Date.now() - cache.checkedAt > TTL_MS) {
      spawnRefresh();
    }
  } catch {
    // A notifier must never break the command it precedes.
  }
}

/**
 * Body of the hidden `__refresh-update-cache` subcommand: fetch the latest
 * published version and rewrite the cache. Runs in the detached child, so its
 * output is discarded and errors (offline, registry down) are swallowed —
 * the stale cache simply persists until the next successful refresh.
 */
export async function refreshUpdateCache(): Promise<void> {
  try {
    const { stdout } = await execFileAsync('npm', ['view', PKG, 'version'], { timeout: 15_000 });
    const latest = stdout.trim().split('\n').pop()?.trim();
    if (!latest) return;
    mkdirSync(getConfigDir(), { recursive: true });
    const cache: UpdateCache = { latest, checkedAt: Date.now() };
    writeFileSync(cachePath(), JSON.stringify(cache));
  } catch {
    // Offline / registry unreachable — leave the old cache in place.
  }
}
