import { readFileSync } from 'node:fs';

/**
 * The installed package version, read from package.json at runtime — the one
 * true source, so it can never drift from what npm published (a hardcoded
 * literal here once shipped '0.1.0' through five releases). Resolved relative
 * to this module: dist/version.js → ../package.json. Used by the MCP
 * initialize handshake (src/index.ts), `--version`, and `mailman update`.
 */
export function getPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}
