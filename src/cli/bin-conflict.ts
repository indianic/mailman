import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPackageName, getPackageVersion } from '../version.js';
import { detectPackageManager, installGlobalCommand, uninstallGlobalCommand, type PkgManager } from './pkg-manager.js';

/**
 * Every npm name mailman has shipped under. One codebase, three published
 * identities: `@integratex/mailman` (public registry), `@indianic/mailman`
 * (internal registry), and the unscoped `mcp-mailman` it started as. They all
 * declare the same `mailman` bin, so npm treats a second one as a foreign file
 * squatting the link and aborts:
 *
 *     npm error code EEXIST
 *     npm error File exists: /opt/homebrew/bin/mailman
 *
 * That failure happens inside npm's bin-linking step, which runs *before* any
 * of the incoming package's lifecycle scripts — verified on npm 11: a
 * `preinstall` script in the conflicting package never executes. So the
 * package cannot intercept the install to print something friendlier; the
 * earliest moment mailman's own code can explain it is the next time a
 * mailman command runs, which is what this check is for. `npx -y
 * @integratex/mailman doctor` works even while the global install is blocked.
 */
export const MAILMAN_PACKAGE_NAMES = ['@integratex/mailman', '@indianic/mailman', 'mcp-mailman'];

/** The package that owns whichever `mailman` executable PATH resolves first. */
export interface BinOwner {
  /** The entry found on PATH, before symlinks are followed. */
  binPath: string;
  /** `binPath` with symlinks resolved (equal to `binPath` when it isn't a link). */
  realPath: string;
  packageName: string | null;
  packageVersion: string | null;
  packageDir: string | null;
}

export interface BinCheckResult {
  ok: boolean;
  detail: string;
}

/**
 * First match for `name` across PATH, i.e. the one the shell would actually
 * run. Uses lstat, not stat: a *broken* symlink still occupies the path and
 * still triggers npm's EEXIST, so it must count as a hit.
 */
export function findOnPath(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const raw = env.PATH ?? env.Path ?? '';
  const extensions =
    platform === 'win32' ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];

  for (const dir of raw.split(path.delimiter).filter(Boolean)) {
    for (const ext of extensions) {
      const candidate = path.join(dir, `${name}${ext}`);
      try {
        lstatSync(candidate);
        return candidate;
      } catch {
        // Not here (or unreadable) — keep scanning the remaining PATH entries.
      }
    }
  }
  return null;
}

/**
 * Package name embedded in a Windows shim. npm on Windows writes `mailman.cmd`
 * / `mailman.ps1` wrapper *files* rather than symlinks, so walking the
 * filesystem upward from the shim lands in the bin directory and finds nothing
 * — the owner is only recoverable from the path baked into the shim's text.
 */
export function parseShimPackageName(contents: string): string | null {
  const match = contents.match(/[\\/]node_modules[\\/]((?:@[\w.-]+[\\/])?[\w.-]+)[\\/]/);
  return match ? match[1].replace(/\\/g, '/') : null;
}

/** Nearest enclosing package.json, walking up from a resolved binary path. */
function readOwnerPackage(startDir: string): { name: string; version: string; dir: string } | null {
  let dir = startDir;
  // Deep enough for `<prefix>/lib/node_modules/@scope/pkg/dist/cli/x.js`, bounded
  // so an unowned binary (say GNU Mailman's /usr/bin/mailman) can't walk to `/`.
  for (let depth = 0; depth < 8; depth++) {
    const manifest = path.join(dir, 'package.json');
    if (existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string; version?: string };
        if (parsed.name) return { name: parsed.name, version: parsed.version ?? 'unknown', dir };
      } catch {
        // Unparseable manifest — treat as unowned rather than crashing doctor.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Identify the package behind a `mailman` executable found on PATH. */
export function resolveBinOwner(binPath: string): BinOwner {
  let realPath = binPath;
  try {
    realPath = realpathSync(binPath);
  } catch {
    // Broken symlink — the path itself is still what npm collides with.
  }

  const owner = readOwnerPackage(path.dirname(realPath));
  if (owner) {
    return { binPath, realPath, packageName: owner.name, packageVersion: owner.version, packageDir: owner.dir };
  }

  // Windows shim fallback: recover the name from the wrapper's contents, then
  // read that package's manifest out of the sibling node_modules tree.
  try {
    const shimName = parseShimPackageName(readFileSync(realPath, 'utf8'));
    if (shimName) {
      const shimDir = path.join(path.dirname(binPath), 'node_modules', ...shimName.split('/'));
      const shimOwner = readOwnerPackage(shimDir);
      if (shimOwner) {
        return { binPath, realPath, packageName: shimOwner.name, packageVersion: shimOwner.version, packageDir: shimOwner.dir };
      }
      return { binPath, realPath, packageName: shimName, packageVersion: null, packageDir: null };
    }
  } catch {
    // Binary (not a text shim), or unreadable — falls through to "unowned".
  }

  return { binPath, realPath, packageName: null, packageVersion: null, packageDir: null };
}

function samePath(a: string, b: string): boolean {
  const normalize = (p: string) => {
    let resolved = p;
    try {
      resolved = realpathSync(p);
    } catch {
      // Path may not exist (uninstalled mid-check) — compare the literal form.
    }
    const trimmed = path.resolve(resolved);
    return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
  };
  return normalize(a) === normalize(b);
}

/**
 * Turn a resolved owner into a doctor line. Pure — the filesystem and
 * package-manager lookups happen in `inspectCliBinary`, so the interesting
 * branches (especially the rename collision) are unit-testable.
 */
export function classifyBinOwner(input: {
  ownName: string;
  ownVersion: string;
  ownDir: string;
  owner: BinOwner | null;
  pm: PkgManager;
}): BinCheckResult {
  const { ownName, ownVersion, ownDir, owner, pm } = input;
  const install = installGlobalCommand(pm, ownName);
  const installLine = `${install.cmd} ${install.args.join(' ')}`;

  if (!owner) {
    return {
      ok: true,
      detail: `no \`mailman\` on PATH — normal under npx; after a global install it means the package manager's bin directory isn't on your PATH`,
    };
  }

  if (owner.packageDir && samePath(owner.packageDir, ownDir)) {
    return { ok: true, detail: `\`mailman\` → this install, ${ownName} ${ownVersion} (${owner.binPath})` };
  }

  if (owner.packageName === ownName) {
    return {
      ok: true,
      detail:
        `\`mailman\` → ${ownName} ${owner.packageVersion ?? 'unknown'} at ${owner.binPath}, a different copy than the one running this check (${ownDir}).\n` +
        `Expected under npx; otherwise you have two installs, and \`mailman update\` only upgrades whichever one you run.`,
    };
  }

  if (owner.packageName && MAILMAN_PACKAGE_NAMES.includes(owner.packageName)) {
    const uninstall = uninstallGlobalCommand(pm, owner.packageName);
    return {
      ok: false,
      detail:
        `\`mailman\` → ${owner.packageName} ${owner.packageVersion ?? 'unknown'} (${owner.binPath}), not ${ownName} ${ownVersion}.\n` +
        `Same tool, published under two names — they both claim the \`mailman\` command, so npm refuses to relink it (\`EEXIST: file already exists\`).\n` +
        `Fix, in this order:\n` +
        `  ${uninstall.cmd} ${uninstall.args.join(' ')}\n` +
        `  ${installLine}\n` +
        `Order matters: \`--force\` installs over the link, but uninstalling the old package afterwards deletes the shared \`mailman\` command and leaves you with none.`,
    };
  }

  if (owner.packageName) {
    return {
      ok: false,
      detail:
        `\`mailman\` → ${owner.packageName} ${owner.packageVersion ?? 'unknown'} (${owner.binPath}) — an unrelated package holding that command name.\n` +
        `Use the \`mcp-mailman\` alias for this tool, or remove that package and run: ${installLine}`,
    };
  }

  return {
    ok: false,
    detail:
      `\`mailman\` → ${owner.binPath}, which isn't an npm package (GNU Mailman installs a \`mailman\` here on some systems).\n` +
      `Use the \`mcp-mailman\` alias — it points at this same tool — or rename/remove that file and run: ${installLine}`,
  };
}

/**
 * Which `mailman` a terminal actually runs, and whether it's this package.
 * Offline and filesystem-only, so `doctor --offline` still reports it.
 */
export function inspectCliBinary(): BinCheckResult {
  const ownDir = fileURLToPath(new URL('../../', import.meta.url));
  const binPath = findOnPath('mailman');
  return classifyBinOwner({
    ownName: getPackageName(),
    ownVersion: getPackageVersion(),
    ownDir,
    owner: binPath ? resolveBinOwner(binPath) : null,
    pm: detectPackageManager(),
  });
}
