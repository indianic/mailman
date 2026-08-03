#!/usr/bin/env bash
###############################################################################
# In-container verification for the headless keystore work.
#
#   bash run-keystore-checks.sh <none|libsecret|full|musl>
#
# Runs against the GLOBALLY INSTALLED package (the packed tarball's dist/), not
# src/ — so this checks the artifact a user actually gets, on the OS the bug was
# reported on. Every assertion prints PASS/FAIL and the script exits non-zero if
# any failed.
###############################################################################
set -uo pipefail

MODE="${1:-none}"
PKG_ROOT="$(npm root -g)/@indianic/mailman"
DIST="$PKG_ROOT/dist"
FAILURES=0
CHECKS=0

pass() { CHECKS=$((CHECKS + 1)); echo "  PASS  $1"; }
fail() { CHECKS=$((CHECKS + 1)); FAILURES=$((FAILURES + 1)); echo "  FAIL  $1"; [ -n "${2:-}" ] && echo "        ↳ $2"; }
section() { echo; echo "── $1 ──"; }

# assert_contains <label> <haystack> <needle>
assert_contains() {
  if printf '%s' "$2" | grep -qF -- "$3"; then pass "$1"; else fail "$1" "expected to contain: $3"; fi
}
assert_not_contains() {
  if printf '%s' "$2" | grep -qF -- "$3"; then fail "$1" "must NOT contain: $3"; else pass "$1"; fi
}
# assert_contains_any <label> <haystack> <needle> [<needle>...]
assert_contains_any() {
  local label="$1" hay="$2"; shift 2
  for needle in "$@"; do
    if printf '%s' "$hay" | grep -qF -- "$needle"; then pass "$label"; return; fi
  done
  fail "$label" "expected one of: $*"
}
assert_eq() {
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "got [$2], want [$3]"; fi
}

# A fresh config dir per scenario. MCP_MAILMAN_CONFIG_DIR namespaces the config
# files, the keytar service name and the file-backend key path all at once.
new_profile() { mktemp -d "/tmp/mailman-profile-XXXXXX"; }

# Drive the installed dist directly for anything the CLI only exposes
# interactively (there is no non-interactive `account add`).
node_run() { node --input-type=module -e "$1"; }

echo "======================================================================="
echo "mailman headless-keystore checks · KEYRING_LEVEL=$MODE"
echo "package: $(node -e "console.log(require('$PKG_ROOT/package.json').name + '@' + require('$PKG_ROOT/package.json').version)")"
echo "node:    $(node --version)   arch: $(uname -m)"
echo "======================================================================="

###############################################################################
section "environment is what we think it is"
###############################################################################
LDCONFIG_OUT="$(ldconfig -p 2>/dev/null | grep -c 'libsecret-1\.so' || true)"
# Resolved from the global install: keytar lives in mailman's own dependency
# tree, so requiring it by bare name from /work would just be "Cannot find
# module" and prove nothing about libsecret.
KEYTAR_LOAD="$(cd "$PKG_ROOT" && node -e "try { require('keytar'); console.log('loaded'); } catch (e) { console.log('LOAD_ERROR:' + e.message.replace(/\n/g, ' ')); }" 2>&1 | tail -1)"

case "$MODE" in
  none|musl)
    assert_eq "libsecret is absent from the library path" "$LDCONFIG_OUT" "0"
    # This is the crash the report opened with. Proving it still happens at the
    # keytar level is what makes the rest of this file meaningful: mailman has to
    # cope with a native module that cannot load.
    assert_contains "keytar itself cannot load (libsecret linked at runtime)" "$KEYTAR_LOAD" "libsecret-1.so.0"
    ;;
  libsecret)
    if [ "$LDCONFIG_OUT" -gt 0 ]; then pass "libsecret IS on the library path"; else fail "libsecret IS on the library path"; fi
    assert_eq "keytar loads fine — only the daemon is missing" "$KEYTAR_LOAD" "loaded"
    ;;
  full)
    if [ "$LDCONFIG_OUT" -gt 0 ]; then pass "libsecret IS on the library path"; else fail "libsecret IS on the library path"; fi
    assert_eq "keytar loads fine" "$KEYTAR_LOAD" "loaded"
    ;;
esac

###############################################################################
section "the CLI starts at all"
###############################################################################
# Before this work these were fine too (keytar was already lazily imported), but
# they are the cheapest possible regression net for the delegation rewrite.
VERSION_OUT="$(mailman --version 2>&1)"
if [ -n "$VERSION_OUT" ] && ! printf '%s' "$VERSION_OUT" | grep -q 'libsecret'; then
  pass "mailman --version works ($VERSION_OUT)"
else
  fail "mailman --version works" "$VERSION_OUT"
fi
HELP_OUT="$(mailman help 2>&1)"
assert_contains "mailman help works" "$HELP_OUT" "auth migrate-keystore"

###############################################################################
section "doctor tells the truth about this machine"
###############################################################################
PROFILE="$(new_profile)"
DOCTOR_OUT="$(MCP_MAILMAN_CONFIG_DIR="$PROFILE" mailman doctor --offline 2>&1)"
echo "$DOCTOR_OUT" | sed 's/^/      | /' | grep -E 'libsecret|credential store|Keystore backend|ticker' || true

case "$MODE" in
  musl)
    assert_contains "doctor runs instead of crashing" "$DOCTOR_OUT" "mailman — doctor"
    # Alpine turns out to ship a working ldconfig, so the probe answers "NOT
    # FOUND" — but a more minimal musl image would have no ldconfig at all and
    # honestly report "could not verify". Both are correct; inventing a verdict
    # because the tool that lists libraries is absent would not be.
    assert_contains_any "libsecret probe is honest about the library" "$DOCTOR_OUT" \
      "NOT FOUND" "could not verify"
    assert_contains "credential store reported unreachable" "$DOCTOR_OUT" "OS credential store: unreachable"
    assert_not_contains "no false 'keytar can reach the Secret Service' claim" "$DOCTOR_OUT" "keytar can reach the Secret Service"
    ;;
  none)
    assert_contains "doctor runs instead of crashing" "$DOCTOR_OUT" "mailman — doctor"
    assert_contains "libsecret reported NOT FOUND" "$DOCTOR_OUT" "NOT FOUND"
    assert_contains "credential store reported unreachable" "$DOCTOR_OUT" "OS credential store: unreachable"
    # The bug: the summary line used to claim the library meant keytar could
    # reach the Secret Service.
    assert_not_contains "no false 'keytar can reach the Secret Service' claim" "$DOCTOR_OUT" "keytar can reach the Secret Service"
    ;;
  libsecret)
    assert_contains "libsecret reported present, library only" "$DOCTOR_OUT" "the library only"
    assert_contains "credential store reported unreachable" "$DOCTOR_OUT" "OS credential store: unreachable"
    # The two states have different fixes, and this is the one where installing
    # libsecret again would change nothing.
    assert_contains "diagnosed as a missing DAEMON, not a missing library" "$DOCTOR_OUT" "nothing is serving the Secret Service"
    assert_not_contains "no false 'keytar can reach the Secret Service' claim" "$DOCTOR_OUT" "keytar can reach the Secret Service"
    ;;
  full)
    assert_contains "credential store reachable" "$DOCTOR_OUT" "OS credential store: reachable"
    assert_contains "keystore backend is os-keychain by default" "$DOCTOR_OUT" "Keystore backend: os-keychain"
    ;;
esac

if [ "$MODE" != "full" ]; then
  FIX_OUT="$(MCP_MAILMAN_CONFIG_DIR="$PROFILE" mailman doctor --offline --fix 2>&1)"
  # The advice that started this: useless on a machine with no session.
  assert_not_contains "--fix no longer says 'log into a desktop session' first" \
    "$(printf '%s' "$FIX_OUT" | grep -A1 'keyring-daemon:' | head -1)" "desktop session"
  assert_contains "--fix points at a headless keystore" "$FIX_OUT" "migrate-keystore --to passphrase"
fi
rm -rf "$PROFILE"

###############################################################################
section "passphrase keystore: full credential round trip"
###############################################################################
PROFILE="$(new_profile)"
export MCP_MAILMAN_CONFIG_DIR="$PROFILE"
export MAILMAN_KEYSTORE=passphrase
export MAILMAN_MASTER_PASSPHRASE="a real headless server passphrase"

CONFIGURE_OUT="$(node_run "
const { configureAccount, getDecryptedCredentials, listAccounts } = await import('$DIST/accounts.js');
await configureAccount({
  alias: 'work', email: 'me@example.com', method: 'app-password',
  credentials: { user: 'me@example.com', pass: 'abcd efgh ijkl mnop' },
});
const creds = await getDecryptedCredentials((await listAccounts())[0]);
console.log('DECRYPTED:' + creds.pass);
" 2>&1)"
assert_contains "configure + decrypt an account with no keyring at all" "$CONFIGURE_OUT" "DECRYPTED:abcd efgh ijkl mnop"

# The property the whole security model rests on.
if [ -f "$PROFILE/accounts.json" ]; then pass "accounts.json was written"; else fail "accounts.json was written"; fi
assert_not_contains "the app password is NOT on disk in plaintext" "$(cat "$PROFILE"/*.json)" "abcd efgh ijkl mnop"
assert_not_contains "the passphrase is NOT on disk" "$(cat "$PROFILE"/*.json)" "a real headless server passphrase"
assert_contains "keystore.json records the backend" "$(cat "$PROFILE/keystore.json")" '"backend": "passphrase"'
assert_contains "keystore.json holds a salt, not a key" "$(cat "$PROFILE/keystore.json")" '"salt"'

# A fresh process — i.e. no in-memory derived-key cache to accidentally satisfy it.
WRONG_OUT="$(MAILMAN_MASTER_PASSPHRASE="the wrong passphrase" node_run "
const { listAccounts, getDecryptedCredentials } = await import('$DIST/accounts.js');
try { const c = await getDecryptedCredentials((await listAccounts())[0]); console.log('LEAKED:' + c.pass); }
catch (e) { console.log('REFUSED:' + e.constructor.name + ':' + e.message.slice(0, 60)); }
" 2>&1)"
assert_contains "a wrong passphrase is refused in a fresh process" "$WRONG_OUT" "REFUSED:"
assert_not_contains "a wrong passphrase does not decrypt anything" "$WRONG_OUT" "LEAKED"
assert_contains "...and is refused with an explanation, not a crypto error" "$WRONG_OUT" "does not match"

DOCTOR_PP="$(mailman doctor --offline 2>&1)"
assert_contains "doctor names the active backend" "$DOCTOR_PP" "Keystore backend: passphrase"
if [ "$MODE" != "full" ]; then
  # A working setup must not be reported as broken because of a store it does not use.
  assert_contains "unreachable credential store is not counted against a passphrase setup" "$DOCTOR_PP" "not in use"
  # Found on Alpine: libsecret was listed as a MISSING DEPENDENCY on a machine
  # where the active keystore has no use for it, so doctor concluded "Some checks
  # failed" over a setup that works.
  assert_contains "libsecret is not a missing dependency for this keystore" "$DOCTOR_PP" "not needed"
  assert_not_contains "...so nothing is reported as missing" "$DOCTOR_PP" "missing: libsecret"
  assert_contains "...and the whole run is green" "$DOCTOR_PP" "All checks passed"
fi

unset MAILMAN_KEYSTORE MAILMAN_MASTER_PASSPHRASE
rm -rf "$PROFILE"

###############################################################################
section "env keystore: the container/CI shape"
###############################################################################
PROFILE="$(new_profile)"
export MCP_MAILMAN_CONFIG_DIR="$PROFILE"
export MAILMAN_KEYSTORE=env
export MAILMAN_MASTER_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"

ENV_OUT="$(node_run "
const { configureAccount, getDecryptedCredentials, listAccounts } = await import('$DIST/accounts.js');
await configureAccount({
  alias: 'ci', email: 'ci@example.com', method: 'app-password',
  credentials: { user: 'ci@example.com', pass: 'zzzz yyyy xxxx wwww' },
});
console.log('DECRYPTED:' + (await getDecryptedCredentials((await listAccounts())[0])).pass);
" 2>&1)"
assert_contains "configure + decrypt from MAILMAN_MASTER_KEY" "$ENV_OUT" "DECRYPTED:zzzz yyyy xxxx wwww"
assert_not_contains "the key itself is never persisted" "$(cat "$PROFILE"/*.json)" "$MAILMAN_MASTER_KEY"

TRUNCATED="$(MAILMAN_MASTER_KEY="$(node -e "console.log(require('crypto').randomBytes(16).toString('base64'))")" node_run "
const { listAccounts, getDecryptedCredentials } = await import('$DIST/accounts.js');
try { await getDecryptedCredentials((await listAccounts())[0]); console.log('ACCEPTED'); }
catch (e) { console.log('REFUSED:' + e.message.slice(0, 70)); }
" 2>&1)"
# base64 decoding silently truncates, so without a length check this would become
# a valid-looking wrong key and surface as an unexplained failure much later.
assert_contains "a truncated MAILMAN_MASTER_KEY is refused by length" "$TRUNCATED" "16 bytes"

unset MAILMAN_KEYSTORE MAILMAN_MASTER_KEY
rm -rf "$PROFILE"

###############################################################################
section "file keystore: key kept out of the config dir"
###############################################################################
PROFILE="$(new_profile)"
export MCP_MAILMAN_CONFIG_DIR="$PROFILE"
export MAILMAN_KEYSTORE=file
export MAILMAN_MASTER_KEY_FILE=/tmp/mailman-file-keystore/master.key
rm -rf /tmp/mailman-file-keystore

FILE_OUT="$(node_run "
const { configureAccount, getDecryptedCredentials, listAccounts } = await import('$DIST/accounts.js');
await configureAccount({
  alias: 'box', email: 'box@example.com', method: 'app-password',
  credentials: { user: 'box@example.com', pass: 'kkkk llll mmmm nnnn' },
});
console.log('DECRYPTED:' + (await getDecryptedCredentials((await listAccounts())[0])).pass);
" 2>&1)"
assert_contains "configure + decrypt via a key file" "$FILE_OUT" "DECRYPTED:kkkk llll mmmm nnnn"
assert_contains "the create is loudly labelled" "$FILE_OUT" "master key is now a plain file"
assert_eq "the key file is 0600" "$(stat -c '%a' "$MAILMAN_MASTER_KEY_FILE")" "600"
# The point of the backend: one copy of the config dir must not take the key too.
if printf '%s' "$MAILMAN_MASTER_KEY_FILE" | grep -q "^$PROFILE"; then
  fail "the key file lives outside the config dir"
else
  pass "the key file lives outside the config dir"
fi

DOCTOR_FILE="$(mailman doctor --offline 2>&1)"
assert_contains "doctor reports the file backend as degraded, not healthy" "$DOCTOR_FILE" "Keystore backend: file"

# reset must not leave a live key behind just because it sits outside the wipe.
mailman reset --yes >/dev/null 2>&1
if [ -f "$MAILMAN_MASTER_KEY_FILE" ]; then
  fail "reset deletes the out-of-tree key file" "still present: $MAILMAN_MASTER_KEY_FILE"
else
  pass "reset deletes the out-of-tree key file"
fi
unset MAILMAN_KEYSTORE MAILMAN_MASTER_KEY_FILE
rm -rf "$PROFILE" /tmp/mailman-file-keystore

###############################################################################
section "never orphan an existing key"
###############################################################################
PROFILE="$(new_profile)"
export MCP_MAILMAN_CONFIG_DIR="$PROFILE"
export MAILMAN_KEYSTORE=file
export MAILMAN_MASTER_KEY_FILE=/tmp/mailman-orphan-test/master.key
rm -rf /tmp/mailman-orphan-test

node_run "
const { configureAccount } = await import('$DIST/accounts.js');
await configureAccount({ alias: 'a', email: 'a@example.com', method: 'app-password',
  credentials: { user: 'a@example.com', pass: 'pppp qqqq rrrr ssss' } });
" >/dev/null 2>&1

# Now point at a DIFFERENT keystore while credentials already exist. This is the
# dangerous case: it does not fail, it succeeds — minting a second key and
# leaving the first batch permanently unreadable.
ORPHAN_OUT="$(MAILMAN_KEYSTORE=passphrase MAILMAN_MASTER_PASSPHRASE="brand new" node_run "
const { getOrCreateMasterKey } = await import('$DIST/config/keychain.js');
try { await getOrCreateMasterKey(); console.log('ORPHANED: a second key was created'); }
catch (e) { console.log('REFUSED:' + e.message.replace(/\n/g, ' ')); }
" 2>&1)"
assert_contains "switching keystores over existing ciphertext is refused" "$ORPHAN_OUT" "REFUSED:"
assert_not_contains "...and no second key was minted" "$ORPHAN_OUT" "ORPHANED"
assert_contains "...with migrate-keystore named as the way to do it properly" "$ORPHAN_OUT" "migrate-keystore"

unset MAILMAN_KEYSTORE MAILMAN_MASTER_KEY_FILE
rm -rf "$PROFILE" /tmp/mailman-orphan-test

###############################################################################
section "rotate-key covers scheduled sends too"
###############################################################################
PROFILE="$(new_profile)"
export MCP_MAILMAN_CONFIG_DIR="$PROFILE"
export MAILMAN_KEYSTORE=passphrase
export MAILMAN_MASTER_PASSPHRASE="rotation test passphrase"

ROTATE_OUT="$(node_run "
const { configureAccount } = await import('$DIST/accounts.js');
const { createScheduledEntry, decryptContent, listScheduled } = await import('$DIST/scheduler/store.js');
const { rekeyStoredData } = await import('$DIST/rekey.js');
const { getMasterKeyOrThrow } = await import('$DIST/config/keychain.js');
const { resolveForRead } = await import('$DIST/config/keystore/index.js');

await configureAccount({ alias: 'w', email: 'w@example.com', method: 'app-password',
  credentials: { user: 'w@example.com', pass: 'tttt uuuu vvvv wwww' } });
await createScheduledEntry({ account: 'w', sendAt: '2099-01-01T09:00:00.000Z',
  content: { to: ['x@example.com'], cc: [], bcc: [], subject: 'queued', body: 'b', bodyType: 'html', attachments: [] } });

const outcome = await rekeyStoredData({
  loadOldKey: getMasterKeyOrThrow,
  prepareNewKey: async () => (await resolveForRead()).prepareKey('rotate'),
  confirm: () => Promise.resolve(true),
  warn: () => {},
});
console.log('STATUS:' + outcome.status);
// The regression: this used to throw a GCM auth-tag error after a rotation,
// which the ticker swallowed as retryable until the send was marked failed.
const content = await decryptContent((await listScheduled())[0]);
console.log('SUBJECT_AFTER_ROTATION:' + content.subject);
" 2>&1)"
assert_contains "rotation completes" "$ROTATE_OUT" "STATUS:rekeyed"
assert_contains "a queued scheduled send is still readable after rotation" "$ROTATE_OUT" "SUBJECT_AFTER_ROTATION:queued"

unset MAILMAN_KEYSTORE MAILMAN_MASTER_PASSPHRASE
rm -rf "$PROFILE"

###############################################################################
section "the cron ticker carries its own environment"
###############################################################################
PROFILE="$(new_profile)"
export MCP_MAILMAN_CONFIG_DIR="$PROFILE"
export MAILMAN_KEYSTORE=passphrase
export MAILMAN_MASTER_PASSPHRASE="ticker test passphrase"
# Pretend we were installed from a session that had a bus, which is how a desktop
# Linux user reaches this code path. Saved and restored rather than unset at the
# end: under `full` these are REAL (dbus-run-session provides them), and blowing
# them away left every later os-keychain operation with no bus to reach.
SAVED_DBUS="${DBUS_SESSION_BUS_ADDRESS:-}"
SAVED_XDG="${XDG_RUNTIME_DIR:-}"
export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/0/bus"
export XDG_RUNTIME_DIR="/run/user/0"

crontab -r >/dev/null 2>&1
node_run "
const { installTickerIfNeeded } = await import('$DIST/scheduler/ticker-install.js');
console.log(JSON.stringify(await installTickerIfNeeded()));
" >/dev/null 2>&1
CRON_LINE="$(crontab -l 2>/dev/null | grep 'mcp-mailman-ticker' || true)"

if [ -n "$CRON_LINE" ]; then pass "ticker installed into crontab"; else fail "ticker installed into crontab"; fi
# Without these, every scheduled send died with "Cannot autolaunch D-Bus without
# X11 $DISPLAY" — the 3am failure nothing in a terminal hints at.
assert_contains "cron line carries DBUS_SESSION_BUS_ADDRESS" "$CRON_LINE" "DBUS_SESSION_BUS_ADDRESS="
assert_contains "cron line carries XDG_RUNTIME_DIR" "$CRON_LINE" "XDG_RUNTIME_DIR="
assert_contains "cron line pins the keystore" "$CRON_LINE" "MAILMAN_KEYSTORE="
assert_contains "cron line carries the config dir" "$CRON_LINE" "MCP_MAILMAN_CONFIG_DIR="
assert_contains "cron line still sets PATH first" "$CRON_LINE" "PATH="
# Secrets are the user's call to put there, never mailman's.
assert_not_contains "cron line does NOT contain the passphrase" "$CRON_LINE" "ticker test passphrase"
assert_not_contains "cron line does not leak a passphrase var at all" "$CRON_LINE" "MAILMAN_MASTER_PASSPHRASE"

# Self-heal: a line installed before this env existed must be upgraded, since
# installTickerIfNeeded used to return early whenever anything was installed.
crontab -l 2>/dev/null | sed 's/DBUS_SESSION_BUS_ADDRESS=[^ ]* //' | crontab -
STALE="$(crontab -l 2>/dev/null | grep 'mcp-mailman-ticker' || true)"
assert_not_contains "(precondition) the line is now stale" "$STALE" "DBUS_SESSION_BUS_ADDRESS="
node_run "
const { installTickerIfNeeded } = await import('$DIST/scheduler/ticker-install.js');
await installTickerIfNeeded();
" >/dev/null 2>&1
HEALED="$(crontab -l 2>/dev/null | grep 'mcp-mailman-ticker' || true)"
assert_contains "a stale ticker line is repaired on the next install" "$HEALED" "DBUS_SESSION_BUS_ADDRESS="

# And the dispatcher itself must run under cron's environment — no bus, no TTY.
DISPATCH_OUT="$(env -u DBUS_SESSION_BUS_ADDRESS -u XDG_RUNTIME_DIR \
  MCP_MAILMAN_CONFIG_DIR="$PROFILE" MAILMAN_KEYSTORE=passphrase \
  MAILMAN_MASTER_PASSPHRASE="ticker test passphrase" \
  mailman send-scheduled --due 2>&1)"
assert_contains "send-scheduled --due runs with no session bus" "$DISPATCH_OUT" '"sent"'
assert_not_contains "...and not by autolaunching D-Bus" "$DISPATCH_OUT" "autolaunch"

crontab -r >/dev/null 2>&1
unset MAILMAN_KEYSTORE MAILMAN_MASTER_PASSPHRASE
if [ -n "$SAVED_DBUS" ]; then export DBUS_SESSION_BUS_ADDRESS="$SAVED_DBUS"; else unset DBUS_SESSION_BUS_ADDRESS; fi
if [ -n "$SAVED_XDG" ]; then export XDG_RUNTIME_DIR="$SAVED_XDG"; else unset XDG_RUNTIME_DIR; fi
rm -rf "$PROFILE"

###############################################################################
# The default path, and migration, need a real credential store.
###############################################################################
if [ "$MODE" = "full" ]; then
  section "os-keychain default path is unchanged"
  PROFILE="$(new_profile)"
  export MCP_MAILMAN_CONFIG_DIR="$PROFILE"

  DEFAULT_OUT="$(node_run "
const { configureAccount, getDecryptedCredentials, listAccounts } = await import('$DIST/accounts.js');
const { readKeystoreRecord } = await import('$DIST/config/keystore/index.js');
await configureAccount({ alias: 'd', email: 'd@example.com', method: 'app-password',
  credentials: { user: 'd@example.com', pass: 'aaaa bbbb cccc dddd' } });
console.log('DECRYPTED:' + (await getDecryptedCredentials((await listAccounts())[0])).pass);
console.log('BACKEND:' + (await readKeystoreRecord())?.backend);
" 2>&1)"
  printf '%s\n' "$DEFAULT_OUT" | sed 's/^/      | /'
  assert_contains "no MAILMAN_KEYSTORE set: the OS credential store is still used" "$DEFAULT_OUT" "BACKEND:os-keychain"
  assert_contains "configure + decrypt on the default path" "$DEFAULT_OUT" "DECRYPTED:aaaa bbbb cccc dddd"
  # The key must be in the credential store, not the config dir.
  # cd into the package: keytar is in mailman's dependency tree, not resolvable
  # from /work (the same trap the environment probe above fell into).
  KEYTAR_HAS="$(cd "$PKG_ROOT" && node -e "
const keytar = require('keytar');
const crypto = require('crypto');
const hash = crypto.createHash('sha256').update('$PROFILE').digest('hex').slice(0, 12);
keytar.getPassword('mcp-mailman-test-' + hash, 'master-key').then((v) => console.log(v ? 'PRESENT' : 'ABSENT'));
" 2>&1 | tail -1)"
  assert_eq "the master key is in the OS credential store" "$KEYTAR_HAS" "PRESENT"

  section "migrate-keystore moves a real key"
  export MAILMAN_MASTER_PASSPHRASE="migrated on a real box"
  MIGRATE_OUT="$(node_run "
const { migrateKeystore } = await import('$DIST/cli/migrate-keystore.js');
const { getDecryptedCredentials, listAccounts } = await import('$DIST/accounts.js');
const { readKeystoreRecord } = await import('$DIST/config/keystore/index.js');
const accept = { confirm: () => Promise.resolve(true), warn: () => {} };

const out1 = await migrateKeystore('passphrase', accept);
console.log('TO_PASSPHRASE:' + out1.status);
console.log('BACKEND1:' + (await readKeystoreRecord())?.backend);
console.log('READABLE1:' + (await getDecryptedCredentials((await listAccounts())[0])).pass);

const out2 = await migrateKeystore('os-keychain', accept);
console.log('BACK_TO_KEYCHAIN:' + out2.status);
console.log('BACKEND2:' + (await readKeystoreRecord())?.backend);
console.log('READABLE2:' + (await getDecryptedCredentials((await listAccounts())[0])).pass);
" 2>&1)"
  assert_contains "os-keychain -> passphrase re-encrypts" "$MIGRATE_OUT" "TO_PASSPHRASE:reencrypted"
  assert_contains "...pointer updated" "$MIGRATE_OUT" "BACKEND1:passphrase"
  assert_contains "...credentials still readable" "$MIGRATE_OUT" "READABLE1:aaaa bbbb cccc dddd"
  assert_contains "passphrase -> os-keychain moves the key without re-encrypting" "$MIGRATE_OUT" "BACK_TO_KEYCHAIN:moved"
  assert_contains "...pointer updated" "$MIGRATE_OUT" "BACKEND2:os-keychain"
  assert_contains "...credentials survive the round trip" "$MIGRATE_OUT" "READABLE2:aaaa bbbb cccc dddd"

  unset MAILMAN_MASTER_PASSPHRASE
  mailman reset --yes >/dev/null 2>&1
  rm -rf "$PROFILE"
fi

###############################################################################
echo
echo "======================================================================="
if [ "$FAILURES" -eq 0 ]; then
  echo "RESULT: PASS — $CHECKS checks, 0 failures (KEYRING_LEVEL=$MODE)"
else
  echo "RESULT: FAIL — $FAILURES of $CHECKS checks failed (KEYRING_LEVEL=$MODE)"
fi
echo "======================================================================="
exit $((FAILURES > 0 ? 1 : 0))
