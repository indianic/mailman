import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { classifyBinOwner, findOnPath, parseShimPackageName, resolveBinOwner, type BinOwner } from '../src/cli/bin-conflict.js';

const OWN = { ownName: '@integratex/mailman', ownVersion: '1.1.2', ownDir: '/opt/homebrew/lib/node_modules/@integratex/mailman', pm: 'npm' as const };

function owner(overrides: Partial<BinOwner> = {}): BinOwner {
  return {
    binPath: '/opt/homebrew/bin/mailman',
    realPath: '/opt/homebrew/lib/node_modules/@indianic/mailman/bin/mcp-mailman.js',
    packageName: '@indianic/mailman',
    packageVersion: '1.1.0',
    packageDir: '/opt/homebrew/lib/node_modules/@indianic/mailman',
    ...overrides,
  };
}

test('an older mailman package owning the command fails with the uninstall-then-install fix', () => {
  const result = classifyBinOwner({ ...OWN, owner: owner() });
  assert.equal(result.ok, false);
  assert.match(result.detail, /@indianic\/mailman 1\.1\.0/);
  assert.match(result.detail, /EEXIST/);
  // The order is the whole point: uninstall must be listed before install,
  // because npm's uninstall deletes the shared `mailman` link even when it
  // has been force-relinked at the newer package.
  assert.ok(
    result.detail.indexOf('npm uninstall -g @indianic/mailman') < result.detail.indexOf('npm install -g @integratex/mailman'),
    'uninstall step must come before the install step',
  );
});

test('the fix commands follow the detected package manager', () => {
  const result = classifyBinOwner({ ...OWN, pm: 'pnpm', owner: owner() });
  assert.match(result.detail, /pnpm remove -g @indianic\/mailman/);
  assert.match(result.detail, /pnpm add -g @integratex\/mailman/);
});

test('an unrelated npm package holding the name points at the mcp-mailman alias', () => {
  const result = classifyBinOwner({
    ...OWN,
    owner: owner({ packageName: 'some-other-tool', packageVersion: '2.0.0', packageDir: '/usr/local/lib/node_modules/some-other-tool' }),
  });
  assert.equal(result.ok, false);
  assert.match(result.detail, /mcp-mailman/);
});

test('a non-npm binary (GNU Mailman) is reported as such, not as a package', () => {
  const result = classifyBinOwner({
    ...OWN,
    owner: owner({ binPath: '/usr/bin/mailman', realPath: '/usr/bin/mailman', packageName: null, packageVersion: null, packageDir: null }),
  });
  assert.equal(result.ok, false);
  assert.match(result.detail, /GNU Mailman/);
  assert.match(result.detail, /mcp-mailman/);
});

test('the command resolving to this very install passes', () => {
  const result = classifyBinOwner({
    ...OWN,
    owner: owner({ packageName: '@integratex/mailman', packageVersion: '1.1.2', packageDir: OWN.ownDir }),
  });
  assert.equal(result.ok, true);
  assert.match(result.detail, /this install/);
});

test('a second copy of the same package passes but says so (the npx case)', () => {
  const result = classifyBinOwner({
    ...OWN,
    ownDir: '/Users/x/.npm/_npx/abc123/node_modules/@integratex/mailman',
    owner: owner({ packageName: '@integratex/mailman', packageVersion: '1.0.9', packageDir: '/opt/homebrew/lib/node_modules/@integratex/mailman' }),
  });
  assert.equal(result.ok, true);
  assert.match(result.detail, /npx/);
});

test('no mailman on PATH is not a failure', () => {
  const result = classifyBinOwner({ ...OWN, owner: null });
  assert.equal(result.ok, true);
  assert.match(result.detail, /isn't on your PATH|no `mailman` on PATH/);
});

test('parseShimPackageName recovers the scope from a Windows .cmd shim', () => {
  const shim = '@"%~dp0\\node_modules\\@integratex\\mailman\\bin\\mcp-mailman.js" %*';
  assert.equal(parseShimPackageName(shim), '@integratex/mailman');
  assert.equal(parseShimPackageName('"$basedir/node_modules/mcp-mailman/bin/mcp-mailman.js"'), 'mcp-mailman');
  assert.equal(parseShimPackageName('#!/bin/sh\nexec node /usr/bin/whatever'), null);
});

test('findOnPath returns the first hit and resolveBinOwner names the package behind it', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mailman-bin-'));
  const emptyDir = path.join(root, 'empty');
  const binDir = path.join(root, 'bin');
  const pkgDir = path.join(root, 'lib', 'node_modules', '@indianic', 'mailman');
  mkdirSync(emptyDir);
  mkdirSync(binDir);
  mkdirSync(path.join(pkgDir, 'bin'), { recursive: true });
  writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@indianic/mailman', version: '1.1.0' }));
  const target = path.join(pkgDir, 'bin', 'mcp-mailman.js');
  writeFileSync(target, '#!/usr/bin/env node\n');
  chmodSync(target, 0o755);
  symlinkSync(target, path.join(binDir, 'mailman'));

  // Earlier PATH entries without a hit must be skipped, not short-circuit.
  const found = findOnPath('mailman', { PATH: [emptyDir, binDir].join(path.delimiter) }, 'linux');
  assert.equal(found, path.join(binDir, 'mailman'));

  const resolved = resolveBinOwner(found!);
  assert.equal(resolved.packageName, '@indianic/mailman');
  assert.equal(resolved.packageVersion, '1.1.0');
});

test('findOnPath still reports a broken symlink — it collides with npm just the same', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mailman-bin-'));
  symlinkSync(path.join(root, 'gone', 'mcp-mailman.js'), path.join(root, 'mailman'));
  assert.equal(findOnPath('mailman', { PATH: root }, 'linux'), path.join(root, 'mailman'));
});
