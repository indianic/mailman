import { realpathSync } from 'node:fs';

export type PkgManager = 'npm' | 'pnpm' | 'yarn';

/**
 * Guess which package manager owns this global install, so `mailman update`
 * upgrades in place with the right tool. A pnpm global install lives outside
 * npm's prefix, so `npm install -g` would install a *second*, shadowed copy
 * and the update would appear to do nothing — we must match the installer.
 *
 * Detection is best-effort, in priority order:
 *  1. The running binary's real path — pnpm/yarn globals sit under their own
 *     dirs (`.../pnpm/...`, `.../.pnpm/...`, `.../Yarn/...`).
 *  2. `npm_config_user_agent` — set when launched via `pnpm dlx` / `yarn dlx`.
 *  3. Fall back to npm (bundled with Node, always present).
 */
export function detectPackageManager(): PkgManager {
  try {
    const bin = process.argv[1];
    if (bin) {
      const real = realpathSync(bin).replace(/\\/g, '/').toLowerCase();
      if (real.includes('/pnpm/') || real.includes('/.pnpm/') || real.includes('pnpm-global')) return 'pnpm';
      if (real.includes('/yarn/') || real.includes('/.yarn/') || real.includes('/.config/yarn/')) return 'yarn';
    }
  } catch {
    // realpath can fail on odd installs — fall through to the user-agent / npm.
  }

  const ua = process.env.npm_config_user_agent ?? '';
  if (ua.startsWith('pnpm')) return 'pnpm';
  if (ua.startsWith('yarn')) return 'yarn';
  return 'npm';
}

/** The global-install invocation for a package manager, e.g. `pnpm add -g <spec>`. */
export function installGlobalCommand(pm: PkgManager, spec: string): { cmd: string; args: string[] } {
  if (pm === 'pnpm') return { cmd: 'pnpm', args: ['add', '-g', spec] };
  if (pm === 'yarn') return { cmd: 'yarn', args: ['global', 'add', spec] };
  return { cmd: 'npm', args: ['install', '-g', spec] };
}
