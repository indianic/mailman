import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { intro, outro } from '@clack/prompts';
import { section, detail, fail } from './tree.js';

const execFileAsync = promisify(execFile);
const PKG = '@indianic/mailman';

function installedVersion(): string {
  const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url));
  return (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version;
}

/**
 * `mailman update` (alias: `upgrade`) — check npm.indianic.in for a newer
 * version and update the global install in place. Relies on ~/.npmrc's
 * @indianic scope routing, same as every other install path — no --registry
 * flag, so mailman's public deps keep resolving from the public registry.
 */
export async function runUpdate(_args: string[]): Promise<void> {
  intro('mailman — update');
  const current = installedVersion();

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

  try {
    await execFileAsync('npm', ['install', '-g', `${PKG}@${latest}`]);
  } catch (err) {
    fail(`npm install -g failed: ${err instanceof Error ? err.message : String(err)}`);
    outro(`Update failed — try manually: npm install -g ${PKG}@latest`);
    process.exitCode = 1;
    return;
  }

  outro(`Updated ${current} → ${latest}. Restart any running AI tools so their MCP server picks it up.`);
}
