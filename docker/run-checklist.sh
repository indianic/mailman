#!/usr/bin/env bash
###############################################################################
# In-container cross-OS smoke checklist (Linux/Ubuntu). Runs the storage,
# keychain, machine-boundness, editor-config, scheduler-line, and CLI-surface
# steps from docs/CROSS-OS.md that DON'T need a real Gmail account — a fake
# but well-formed App Password exercises the whole encrypt/keychain path
# offline. Real send+read stays the macOS-verified manual step.
#
# Arg: "desktop" (default) runs with a gnome-keyring Secret Service up and
# expects the success path; "headless" runs with NO keyring and expects
# mailman to fail CLEAN (NO_MASTER_KEY / KeyringUnavailable), never plaintext.
#
# Emits `PASS:`/`FAIL:` lines; exits non-zero if any step failed.
###############################################################################
set -uo pipefail

MODE="${1:-desktop}"
FAILURES=0
FAKE_PASS="abcdefghijklmnop"   # 16 chars, App-Password-shaped, not a real secret
export MCP_MAILMAN_CONFIG_DIR="/tmp/mailman-cfg"
GLOBAL_ROOT="$(npm root -g)"
PKG_DIR="$GLOBAL_ROOT/@indianic/mailman"

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILURES=$((FAILURES + 1)); }
# NOTE = informational finding, recorded but NOT a platform-smoke failure
# (e.g. the keytar↔keyring migration probe, which tests a FUTURE swap, not
# 0.x's actual keytar-only behavior).
note() { echo "NOTE: $1"; }

echo "=== mailman Linux smoke — mode: $MODE ==="
echo "node $(node --version) | npm root -g: $GLOBAL_ROOT"

# 1) both bins on PATH, version resolves through the shared helper
if command -v mailman >/dev/null && command -v mcp-mailman >/dev/null; then
  pass "both bins on PATH (mailman + mcp-mailman) → $(mailman --version)"
else
  fail "mailman/mcp-mailman not both on PATH"
fi

# 2) doctor — keyring probe outcome depends on mode
DOCTOR_OUT="$(mailman doctor 2>&1 || true)"
if [ "$MODE" = "desktop" ]; then
  echo "$DOCTOR_OUT" | grep -q "Keyring backend.*reachable" \
    && pass "doctor: keyring reachable" \
    || fail "doctor: keyring NOT reachable under gnome-keyring — $(echo "$DOCTOR_OUT" | grep -i keyring)"
else
  # headless: probe should report unreachable (not crash)
  echo "$DOCTOR_OUT" | grep -qi "keyring" \
    && pass "doctor: ran and reported keyring status (headless)" \
    || fail "doctor: no keyring line in headless output"
fi

# --- keychain + storage: drive the installed package's own modules, exactly
#     like the macOS verification (configureAccount encrypts a FAKE account) ---
KEYCHAIN_JS=$(cat <<JS
const acc = await import('file://$PKG_DIR/dist/accounts.js');
const { getMasterKeyOrThrow, NoMasterKeyError } = await import('file://$PKG_DIR/dist/config/keychain.js');
const fs = await import('node:fs');
const path = await import('node:path');
const cfg = process.env.MCP_MAILMAN_CONFIG_DIR;
await acc.configureAccount({ alias: 'ci', email: 'ci@example.com', method: 'app-password', credentials: { user: 'ci@example.com', pass: '$FAKE_PASS' } });
const key = await getMasterKeyOrThrow();
if (!key || key.length !== 32) throw new Error('master key not 32 bytes');
const raw = fs.readFileSync(path.join(cfg, 'accounts.json'), 'utf8');
if (raw.includes('$FAKE_PASS')) throw new Error('PLAINTEXT LEAK: app password found in accounts.json');
const creds = await acc.getDecryptedCredentials((await acc.listAccounts())[0]);
if (creds.pass !== '$FAKE_PASS') throw new Error('decrypt roundtrip mismatch');
console.log('KEYCHAIN_OK');
JS
)

if [ "$MODE" = "desktop" ]; then
  if node --input-type=module -e "$KEYCHAIN_JS" 2>/tmp/kc.err | grep -q KEYCHAIN_OK; then
    pass "keychain: master key stored (32B), accounts.json ciphertext-only, decrypt roundtrips"
  else
    fail "keychain success path: $(tail -1 /tmp/kc.err)"
  fi

  # 4) machine-boundness: wipe the keyring entry, decrypt must fail NO_MASTER_KEY
  BOUND_JS=$(cat <<JS
const { getServiceName, getMasterKeyOrThrow, NoMasterKeyError } = await import('file://$PKG_DIR/dist/config/keychain.js');
const keytar = (await import('file://$PKG_DIR/node_modules/keytar/lib/keytar.js')).default;
await keytar.deletePassword(getServiceName(), 'master-key');
try { await getMasterKeyOrThrow(); console.log('BAD: key still present'); }
catch (e) { console.log(e instanceof NoMasterKeyError ? 'NO_MASTER_KEY_OK' : 'WRONG_ERR:' + e.constructor.name); }
JS
)
  node --input-type=module -e "$BOUND_JS" 2>/tmp/mb.err | grep -q NO_MASTER_KEY_OK \
    && pass "machine-boundness: missing key → NoMasterKeyError (no plaintext fallback)" \
    || fail "machine-boundness: $(cat /tmp/mb.err; )"

  # 5) @napi-rs/keyring migration PROBE (informational — 0.6.0 plan, not 0.x
  #    behavior). Two questions: does keyring work standalone on Linux, and
  #    can it read an entry keytar wrote? On macOS both were yes. On Linux the
  #    Secret Service matches items by libsecret ATTRIBUTE SETS, and keytar vs
  #    keyring-rs populate different attributes — so cross-read is expected to
  #    fail here even though each library works fine on its own.
  PROBE_JS=$(cat <<JS
const keytar = (await import('file://$PKG_DIR/node_modules/keytar/lib/keytar.js')).default;
const kr = await import('@napi-rs/keyring');
const Entry = kr.Entry ?? kr.default?.Entry ?? kr.default;
// keyring self-roundtrip
let self = 'no';
try { const e = new Entry('mailman-krself', 'p'); e.setPassword('x'); self = e.getPassword() === 'x' ? 'yes' : 'no'; e.deletePassword(); } catch (err) { self = 'err:' + err.message; }
// cross-read: keytar writes, keyring reads
let xread = 'no';
try { await keytar.setPassword('mailman-xread', 'p', 'from-keytar'); const v = new Entry('mailman-xread', 'p').getPassword(); xread = v === 'from-keytar' ? 'yes' : 'no(' + v + ')'; new Entry('mailman-xread', 'p').deletePassword(); } catch (err) { xread = 'err:' + err.message; }
console.log('KEYRING_SELF=' + self + ' XREAD=' + xread);
JS
)
  PROBE_OUT="$(cd /work && node --input-type=module -e "$PROBE_JS" 2>&1 | grep KEYRING_SELF || echo 'KEYRING_SELF=err XREAD=err')"
  note "migration probe (0.6.0): @napi-rs/keyring $PROBE_OUT"
  case "$PROBE_OUT" in
    *"KEYRING_SELF=yes XREAD=yes"*) note "  → Linux cross-read WORKS; migration would be zero-touch here too" ;;
    *"KEYRING_SELF=yes"*)           note "  → keyring works standalone but does NOT cross-read keytar's entry (expected on Linux); a keytar-written master key needs one-time reconfigure or a transitional read-old/write-new step post-swap" ;;
    *)                              note "  → keyring failed to operate standalone here — investigate before any swap" ;;
  esac

  # 6) editor config write
  mailman register --tools claude --scope global >/dev/null 2>&1
  if grep -q '"@indianic/mailman"' "$HOME/.claude.json" 2>/dev/null; then
    pass "register --tools claude wrote ~/.claude.json with the mailman MCP entry"
  else
    fail "register did not write a valid ~/.claude.json"
  fi

  # 8) reset wipes config dir AND keyring entry
  mailman reset --yes >/dev/null 2>&1
  [ ! -d "$MCP_MAILMAN_CONFIG_DIR" ] \
    && pass "reset --yes removed the config dir" \
    || fail "reset left the config dir behind"
else
  # headless: configuring an account must fail clean, not write plaintext
  HEADLESS_JS=$(cat <<JS
const acc = await import('file://$PKG_DIR/dist/accounts.js');
const { KeyringUnavailableError } = await import('file://$PKG_DIR/dist/config/keychain.js');
try { await acc.configureAccount({ alias: 'ci', email: 'ci@example.com', method: 'app-password', credentials: { user: 'ci@example.com', pass: '$FAKE_PASS' } }); console.log('BAD: configured with no keyring'); }
catch (e) { console.log(e instanceof KeyringUnavailableError ? 'KEYRING_UNAVAILABLE_OK' : 'ERR:' + e.constructor.name + ':' + e.message); }
JS
)
  OUT="$(node --input-type=module -e "$HEADLESS_JS" 2>/tmp/hl.err || true)"
  echo "$OUT" | grep -q KEYRING_UNAVAILABLE_OK \
    && pass "headless: configureAccount fails with KeyringUnavailableError (no plaintext fallback)" \
    || fail "headless behavior: $OUT $(cat /tmp/hl.err)"
  [ ! -f "$MCP_MAILMAN_CONFIG_DIR/accounts.json" ] \
    && pass "headless: no accounts.json written on failure" \
    || fail "headless: accounts.json was written despite keyring failure"
fi

# 7) scheduler ticker line resolves the scoped package (pure, mode-independent)
CRON_JS="const m = await import('file://$PKG_DIR/dist/scheduler/ticker-install.js'); console.log(m.buildCronLine().includes('@indianic/mailman') ? 'CRON_OK' : 'CRON_BAD');"
node --input-type=module -e "$CRON_JS" 2>/dev/null | grep -q CRON_OK \
  && pass "cron ticker line npx-resolves @indianic/mailman" \
  || fail "cron ticker line wrong"

echo "=== $MODE: $FAILURES failure(s) ==="
exit $FAILURES
