import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installHint, classifyKeyringFailure, tickerConcern, libsecretDependency } from '../src/cli/doctor.js';

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
  for (const tool of ['node', 'npm', 'libsecret', 'keyring-daemon', 'ticker-dbus']) {
    for (const platform of ['darwin', 'win32', 'linux']) {
      const hint = installHint(tool, platform);
      assert.ok(hint.trim().length > 0, `${tool}/${platform} has no hint`);
      // `mailman ` and `loginctl ` joined the list when the headless keystore
      // landed: the fix for an unreachable keyring on a server is a mailman
      // command, not a package install.
      assert.ok(
        /^(sudo |brew |winget |npm |mailman |loginctl |see https?:\/\/)/.test(hint.trim()),
        `${tool}/${platform} is not actionable: ${hint}`,
      );
    }
  }
});

test('an unknown tool degrades to a generic hint rather than throwing', () => {
  // doctor must never crash because a new check was added without a hint.
  assert.match(installHint('some-future-dep', 'linux'), /package manager/);
});

/**
 * The strings below are verbatim from a real Ubuntu 24.04 server with no
 * desktop, walked through the whole sequence: no libsecret, then libsecret with
 * no daemon, then a working keyring whose cron ticker had no bus. Getting the
 * classification wrong sends the user to install something they already have.
 */
test('a missing libsecret is classified as a library problem, not a daemon one', () => {
  assert.equal(
    classifyKeyringFailure(
      '/usr/lib/node_modules/@integratex/mailman/node_modules/keytar/build/Release/keytar.node: ' +
        'libsecret-1.so.0: cannot open shared object file: No such file or directory',
    ),
    'library',
  );
  // node-gyp-build's variant of the same root cause.
  assert.equal(classifyKeyringFailure('Could not locate the bindings file. Tried: ...'), 'library');
});

test('a missing Secret Service is classified as a daemon problem', () => {
  assert.equal(
    classifyKeyringFailure('The name org.freedesktop.secrets was not provided by any .service files'),
    'daemon',
  );
  // What the crontab ticker hits: keyring works interactively, cron has no bus.
  assert.equal(classifyKeyringFailure('Cannot autolaunch D-Bus without X11 $DISPLAY'), 'daemon');
});

test('an unrecognised keyring error is not forced into either bucket', () => {
  // Guessing here would print a confident, wrong fix. `other` routes to the
  // daemon hint but is reported as neither cause in the detail line.
  assert.equal(classifyKeyringFailure('The specified item could not be found in the keyring'), 'other');
  assert.equal(classifyKeyringFailure('Access denied'), 'other');
});

/**
 * The 3am failure mode: cron has no session bus, so a ticker line carrying only
 * PATH cannot reach the Secret Service even though the keyring works perfectly
 * from an interactive shell. Nothing in the terminal hints at it, which is why
 * doctor has to.
 */
const ticker = {
  cronOsKeychain: { mechanism: 'crontab' as const, installed: true, hasDbusEnv: false, backend: 'os-keychain', passphraseInEnv: false },
};

test('a crontab ticker with no D-Bus env is flagged when the OS credential store is in use', () => {
  const concern = tickerConcern(ticker.cronOsKeychain);
  assert.ok(concern, 'this is the reported bug — it must not be silent');
  assert.match(concern.detail, /DBUS_SESSION_BUS_ADDRESS/);
  assert.match(concern.detail, /fail silently/);
  assert.equal(concern.fix, 'ticker-dbus');
});

test('the same ticker is fine once the line carries the bus address', () => {
  assert.equal(tickerConcern({ ...ticker.cronOsKeychain, hasDbusEnv: true }), undefined);
});

test('D-Bus is irrelevant to keystores that do not use a session bus', () => {
  // A passphrase/env/file keystore has no bus to reach, so warning about one
  // would be noise — and noise is how doctor teaches people to ignore doctor.
  for (const backend of ['env', 'file']) {
    assert.equal(tickerConcern({ ...ticker.cronOsKeychain, backend }), undefined, backend);
  }
});

test('launchd and schtasks tickers are never flagged for D-Bus', () => {
  // launchd jobs run inside the user's session; Windows has no D-Bus at all.
  for (const mechanism of ['launchd', 'schtasks'] as const) {
    assert.equal(tickerConcern({ ...ticker.cronOsKeychain, mechanism, hasDbusEnv: undefined }), undefined, mechanism);
  }
});

test('a ticker that was never installed has nothing to warn about', () => {
  assert.equal(tickerConcern({ ...ticker.cronOsKeychain, installed: false }), undefined);
});

test('a passphrase keystore under cron is flagged, with no automatic fix offered', () => {
  const concern = tickerConcern({ ...ticker.cronOsKeychain, backend: 'passphrase', hasDbusEnv: true });
  assert.ok(concern);
  assert.match(concern.detail, /no way to obtain the passphrase/);
  assert.match(concern.detail, /migrate-keystore --to env\|file/);
  // No `fix`: mailman writing a passphrase into a crontab on the user's behalf is
  // not a decision it gets to make, so there is no command to print.
  assert.equal(concern.fix, undefined);
  // ...and once the passphrase is available unattended, it is fine.
  assert.equal(
    tickerConcern({ ...ticker.cronOsKeychain, backend: 'passphrase', hasDbusEnv: true, passphraseInEnv: true }),
    undefined,
  );
});

test('the libsecret hint offers the headless route, not just the install', () => {
  // Found on a real bare-Ubuntu container: `doctor --fix` classified the failure
  // as a missing *library* (correct) and printed only `apt install libsecret-1-0`
  // — which moves a headless box from "no library" to "library, no daemon", the
  // next state in the same dead end. The keystore escape hatch lived only in the
  // keyring-daemon hint, which that path never reaches.
  const hint = installHint('libsecret', 'linux');
  assert.match(hint, /apt install libsecret-1-0/, 'still correct for a desktop machine');
  assert.match(hint, /migrate-keystore --to passphrase/);
  assert.match(hint, /MAILMAN_KEYSTORE=passphrase mailman init/);
});

test('libsecret is not reported missing when the active keystore does not use it', () => {
  // Found on Alpine/musl: libsecret is absent there, the passphrase keystore
  // works perfectly, and doctor still concluded "Some checks failed" over a
  // dependency nothing in the active configuration needs.
  assert.equal(libsecretDependency('passphrase', 'linux')?.ok, true);
  assert.match(libsecretDependency('passphrase', 'linux')!.detail, /not needed/);
  assert.equal(libsecretDependency('env', 'linux')?.ok, true);
  assert.equal(libsecretDependency('file', 'linux')?.ok, true);
  // ...but it is still a real dependency of the backend that actually uses it,
  // so that path must keep probing the library.
  assert.doesNotMatch(libsecretDependency('os-keychain', 'linux')?.detail ?? '', /not needed/);
  // And it stays Linux-only: macOS and Windows ship their own credential store.
  assert.equal(libsecretDependency('os-keychain', 'darwin'), null);
  assert.equal(libsecretDependency('os-keychain', 'win32'), null);
});

test('the libsecret hint covers musl too', () => {
  assert.match(installHint('libsecret', 'linux'), /apk add libsecret/);
});
