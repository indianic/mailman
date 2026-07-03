import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { intro, outro } from '@clack/prompts';
import { section, detail, fail } from './tree.js';
import { getPackageVersion } from '../version.js';
import { detectPackageManager, installGlobalCommand } from './pkg-manager.js';

const execFileAsync = promisify(execFile);
const PKG = '@indianic/mailman';

/**
 * `mailman update` (alias: `upgrade`) — check npm.indianic.in for a newer
 * version and update the global install in place, using whichever package
 * manager installed it (npm or pnpm; yarn too). Relies on ~/.npmrc's
 * @indianic scope routing, which npm/pnpm/yarn all read — no --registry flag,
 * so mailman's public deps keep resolving from the public registry.
 */
export async function runUpdate(_args: string[]): Promise<void> {
  intro('mailman — update');
  const current = getPackageVersion();

  let latest: string;
  try {
    const { stdout } = await execFileAsync('npm', ['view', PKG, 'version']);
    latest = stdout.trim().split('\n').pop()!.trim();
  } catch (err) {
    fail(`Couldn't reach the registry to check for updates: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  section('versions');
  detail(`installed   ${current}`);
  detail(`latest      ${latest}`);

  if (latest === current) {
    outro(`Already up to date (${current}).`);
    return;
  }

  const pm = detectPackageManager();
  const { cmd, args } = installGlobalCommand(pm, `${PKG}@${latest}`);
  detail(`via         ${cmd}`);
  try {
    await execFileAsync(cmd, args);
  } catch (err) {
    fail(`${cmd} ${args.join(' ')} failed: ${err instanceof Error ? err.message : String(err)}`);
    outro(`Update failed — try manually: ${cmd} ${args.join(' ')}`);
    process.exitCode = 1;
    return;
  }

  outro(`Updated ${current} → ${latest}. Restart any running AI tools so their MCP server picks it up.`);
}
