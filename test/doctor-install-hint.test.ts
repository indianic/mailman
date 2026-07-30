import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installHint } from '../src/cli/doctor.js';

/**
 * `mailman doctor --fix` prints a platform-specific install command. The whole
 * point is that it is right on a machine the developer is not sitting at, so
 * the per-platform strings are asserted here rather than discovered by a user
 * on Windows.
 *
 * installHint is pure and takes `platform` explicitly for exactly this reason.
 */

test('node/npm hints are platform-specific', () => {
  assert.match(installHint('node', 'darwin'), /brew install node/);
  assert.match(installHint('node', 'win32'), /winget install --id OpenJS\.NodeJS\.LTS/);
  assert.match(installHint('node', 'linux'), /nodejs\.org\/en\/download\/package-manager/);
  // npm ships with node, so it must not send people somewhere different.
  assert.equal(installHint('npm', 'darwin'), installHint('node', 'darwin'));
  assert.equal(installHint('npm', 'win32'), installHint('node', 'win32'));
});

test('no platform hint leaks another platform’s package manager', () => {
  assert.doesNotMatch(installHint('node', 'darwin'), /winget|apt|dnf/);
  assert.doesNotMatch(installHint('node', 'win32'), /brew|apt|dnf/);
  assert.doesNotMatch(installHint('node', 'linux'), /brew|winget/);
});

test('libsecret hint covers the three main Linux package managers', () => {
  const hint = installHint('libsecret', 'linux');
  assert.match(hint, /apt install libsecret-1-0/);
  assert.match(hint, /dnf install libsecret/);
  assert.match(hint, /pacman -S libsecret/);
});

test('the keyring daemon hint is distinct from the libsecret hint', () => {
  // Two different root causes for "the keyring does not work": the library is
  // missing, or it is present but no Secret Service daemon is running.
  // Verified against real containers — node:20-slim hits the first, the smoke
  // base image (which has libsecret-1-0 but no dbus) hits the second. One
  // generic message would send half of those users to the wrong fix.
  const lib = installHint('libsecret', 'linux');
  const daemon = installHint('keyring-daemon', 'linux');
  assert.notEqual(lib, daemon);
  assert.match(daemon, /gnome-keyring/);
  assert.match(daemon, /desktop session/);
  assert.doesNotMatch(daemon, /libsecret-1-0/);
});

test('every hint is a runnable command or a URL, never prose', () => {
  for (const tool of ['node', 'npm', 'libsecret', 'keyring-daemon']) {
    for (const platform of ['darwin', 'win32', 'linux']) {
      const hint = installHint(tool, platform);
      assert.ok(hint.trim().length > 0, `${tool}/${platform} has no hint`);
      assert.ok(
        /^(sudo |brew |winget |npm |see https?:\/\/)/.test(hint.trim()),
        `${tool}/${platform} is not actionable: ${hint}`,
      );
    }
  }
});

test('an unknown tool degrades to a generic hint rather than throwing', () => {
  // doctor must never crash because a new check was added without a hint.
  assert.match(installHint('some-future-dep', 'linux'), /package manager/);
});
