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

/**
 * The installed package *name*, read the same way — mailman ships under two
 * scoped names from one codebase (`@integratex/mailman` on the public npm
 * registry, `@indianic/mailman` on the internal one), so anything that
 * npx-resolves or registry-queries the package (editor MCP configs, the
 * scheduled-send ticker, `mailman update`) must use whichever name this
 * install was actually published as, never a hardcoded literal.
 */
export function getPackageName(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { name: string };
  return pkg.name;
}
