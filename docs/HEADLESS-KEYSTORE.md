# Headless keystore — Implementation Checklist

Makes mailman usable on headless Linux (servers, containers, CI, WSL) without
weakening the security model. Phased so each phase is shippable on its own.

> **Status — in progress, started 2026-08-03.** Phase 0 fixes bugs that exist
> in released 1.2.1 and needs none of the abstraction; it ships first.

Source of the report: a real Ubuntu 24.04 server with no desktop. `npm install
-g` succeeded, then setup failed three times in a row — missing `libsecret`,
then a present library with no Secret Service on the bus, then `doctor --fix`
advising "log into a desktop session" on a machine with no session to log into.
Making the keyring work took 16 extra packages, a `gnome-keyring-daemon
--unlock` systemd user service fed a password file, and `loginctl
enable-linger`. That is not a reasonable install path for a mail CLI.

## What the investigation confirmed, and what it corrected

Verified against source on 2026-08-03, not taken from the report:

- ✅ One secret only — a 256-bit master key, base64, service `mcp-mailman`,
  account `master-key` (`src/config/keychain.ts:3-4,15-22`). Everything else is
  encrypted with it.
- ✅ `doctor` prints `libsecret: present (keytar can reach the Secret Service)`
  off a bare `ldconfig` grep (`src/cli/doctor.ts:57-68`) — the parenthetical is
  a **false claim** on a headless box: present library, no daemon.
- ✅ `installHint('keyring-daemon')` ends in "then log into a desktop session"
  (`src/cli/doctor.ts:101`).
- ✅ The cron line carries no D-Bus env (`src/scheduler/ticker-install.ts:107`).
  It *does* inline `PATH=`, so the injection pattern already exists.
- ✅ No plaintext fallback, deliberately, and every caller discriminates on the
  two exported error classes.
- ❌ **"Any invocation crashes before the CLI starts" is wrong**, and so is the
  fix it implies. keytar is already dynamically imported at all four sites
  (`keychain.ts:27`, `doctor.ts:109`, `reset.ts:25`, tests). Verified by running
  the CLI under an ESM loader hook that makes `import('keytar')` throw the exact
  linker error: `help`, `doctor --offline` and `status` all complete normally.
- ❌ …**but the real bug is worse.** `getKeytar()` is called *outside* the
  try/catch (`keychain.ts:42,64,89`), so a native-load failure escapes as a bare
  `Error`, never `KeyringUnavailableError` — bypassing every handler in the tree
  (`tools/configure-account.ts:70`, `tools/confirm-send.ts:91`,
  `tools/mail-helpers.ts:21`, `cli/account.ts:252,290,492`,
  `cli/rotate-key.ts:30`). That is why `mailman init` on that server produced a
  raw linker stack trace instead of the friendly no-keyring path.
- ❌ `MAILMAN_NOTIFY_*` does not exist. The real set is
  `MCP_MAILMAN_CONFIG_DIR`, `MCP_MAILMAN_DEBUG`, `MAILMAN_SESSIONS_DIR`,
  `MAILMAN_NO_UPDATE_NOTIFIER` — the inconsistency is real, the example wasn't.
- ❌ "Check whether keytar is still maintained" is already answered in-repo:
  [KEYTAR-MIGRATION.md](KEYTAR-MIGRATION.md) (archived by the Atom org, migrate
  to `@napi-rs/keyring`, cross-read verified both directions on macOS, Linux
  attribute-set gotcha documented). Stays out of this change.

Two bugs found that the report didn't ask about, both in scope here:

- `auth rotate-key` re-encrypts `accounts.json` only (`cli/rotate-key.ts:54`),
  but `scheduled.json`'s content uses the same master key
  (`scheduler/store.ts:31-32`). After a rotation every pending scheduled send
  fails its GCM tag check; `dispatchOne` swallows it as retryable and marks it
  `failed` after 5 attempts. Silent loss.
- `doctor`'s keyring probe hardcodes service `'mcp-mailman'`
  (`cli/doctor.ts:110-112`) instead of `getServiceName()`, so running doctor
  under `MCP_MAILMAN_CONFIG_DIR` writes and deletes a probe item in the **real**
  namespace.

## Design decisions

- **Four backends, not three.** `os-keychain` (not `secret-service` — the keytar
  path is macOS Keychain and Windows Credential Manager too, so a Linux-only
  name would be wrong on two of three platforms and would leak into `doctor`
  output and `migrate-keystore --to` values), `passphrase`, `env`, `file`.
- **`env` (`MAILMAN_MASTER_KEY`, base64) is the container/CI answer.** No KDF,
  nothing at rest, the platform owns the secret — Docker/K8s secrets, systemd
  `LoadCredential=`, CI variables. ~20 lines, and it removes most of the demand
  for `file`.
- **`file` is included, but not for the reason originally proposed.** The honest
  case isn't "installs that can't supply a passphrase" — it's the cron ticker.
  `MAILMAN_MASTER_PASSPHRASE` in a crontab *is* a key file with extra steps, and
  a worse one, since a passphrase is likelier to be reused elsewhere than 32
  random bytes.
- **A recorded backend pointer is what makes "never orphan" achievable.** A
  failed Secret Service probe cannot distinguish "no key here" from "daemon is
  down"; guessing wrong mints a fresh key on another backend and orphans
  `accounts.json`. `keystore.json` in the config dir records the backend, KDF
  params and salt — no key material — and makes resolution deterministic.
  Living in the config dir means `MCP_MAILMAN_CONFIG_DIR` isolation is
  inherited for free, and a salt beside the ciphertext costs nothing, since the
  passphrase is the secret.
- **`passphrase` trades machine-binding for passphrase-binding.** Config dir
  plus a known passphrase is decryptable anywhere. Say so; don't imply
  otherwise. Same for `file`: it defends against accidental co-copying (rsync
  the config dir, `docker COPY`, a stray commit), not against local read access.
- **The in-memory KDF cache buys nothing for the ticker**, which is a fresh
  `npx` process every 3 minutes. Each tick pays full scrypt — fine at that
  cadence, but document it rather than implying a cache helps.

## Phase 0 — bugs in released 1.2.1 (ships independently)

- [x] Move `getKeytar()` inside the guarded region in `readMasterKeyRaw`,
      `getOrCreateMasterKey` and `setMasterKey` so a native-load failure becomes
      `KeyringUnavailableError`; regression test with a failing keytar import —
      done via a `withKeyring(op, load)` helper that owns load + call + wrap;
      `load` defaults to the real import and is overridden in tests (same seam
      style as `buildLaunchdPlist`'s `nodeBinDir`). The message now also splits
      missing-library from no-daemon, so the library case names the `apt install`
- [x] `auth rotate-key` re-encrypts `scheduled.json` alongside `accounts.json`,
      both written before the stored key is swapped; test — extracted a TTY-free
      `rotateMasterKey({confirm, warn})` core so the whole path is testable (5
      tests). Dry-runs every blob first: an undecryptable *account* blocks the
      rotation before anything is written, an undecryptable *scheduled entry* is
      warned about and skipped, so pre-existing queue damage can't block
      rotation forever. `docs/CLI.md` updated to match
- [x] `doctor` reports library presence and Secret Service reachability as
      separate facts, and probes under `getServiceName()`; test — the row is now
      `OS credential store` (leaving `Keystore backend` free for the active
      backend in Phase 3), and an exported `classifyKeyringFailure()` routes
      `--fix` off what the probe actually reported instead of what `ldconfig`
      guessed. Fixes two mis-routings: a present-but-unusable library was
      advised to install gnome-keyring, and an `ldconfig`-less image (musl,
      minimal containers) never got a hint at all. The probe also now verifies
      the value it reads back

**Phase 0 done.** `npm test` 249 pass / 0 fail (1 pre-existing Linux-only skip),
lint and typecheck clean. Shippable on its own — no part of it depends on the
backend abstraction.

## Phase 1 — the backend abstraction

- [x] `src/config/keystore/` — `Backend` interface, `keystore.json` pointer, and
      resolution order: explicit `MAILMAN_KEYSTORE` → recorded backend →
      reachable `os-keychain` holding a key → hard error naming `auth
      migrate-keystore`. Never an auto-create onto a new backend
- [x] `os-keychain` backend — today's keytar path, same service/account names,
      same storage location, zero migration for existing installs
- [x] `passphrase` backend — scrypt from `MAILMAN_MASTER_PASSPHRASE` or a clack
      `password` prompt + random salt in `keystore.json`. `N=2^15, r=8, p=1`
      with an **explicit `maxmem`** (Node's default 32 MiB throws
      `ERR_CRYPTO_INVALID_SCRYPT_PARAMS` at that `N` — verified). Wrong
      passphrase rejected cleanly, not as a GCM tag crash
- [x] `env` backend — base64 32 bytes from `MAILMAN_MASTER_KEY`, nothing
      persisted; wrong length / non-base64 rejected with a clear message
- [x] `file` backend — opt-in via `MAILMAN_KEYSTORE=file`, random 32 bytes,
      `O_EXCL` at 0600, default path **outside** the config dir, loud warning on
      create, degraded (not healthy) in `doctor`
- [x] `keychain.ts` delegates; all seven exports keep identical semantics and
      none of the eight importers change

Notes from building it:

- **`setMasterKey(key)` cannot work on a deriving backend.** scrypt cannot be
  made to produce a *chosen* key, and `env`'s key belongs to the platform. Both
  throw `KeystoreNotStorableError`; rotation goes through a two-phase
  `prepareRotation()` that returns the next key and persists it only on
  `commit()` — which is also what preserves `rotate-key`'s crash-safe ordering
  (re-encrypt the files, *then* swap the key material).
- **Two bugs the tests caught, both mine, both fixed:** the derived-key cache was
  keyed on the salt but not the passphrase, so within one process a wrong
  passphrase got a cache hit on the *right* key and was silently accepted; and
  `env.read()` returned `Promise.resolve(load())`, which threw synchronously out
  of a method every caller treats as async, sailing past `.catch()`.
- **One extra guard beyond the original plan.** `MAILMAN_KEYSTORE=passphrase` on
  a machine with a healthy `os-keychain` key doesn't fail, it *succeeds* — and
  mints a second key while `accounts.json` stays encrypted under the first.
  `resolveForCreate` now refuses when the chosen backend disagrees with the
  recorded/expected one and ciphertext already exists. Deliberately scoped to
  backend *disagreement*: a missing key on the backend that legitimately owns it
  is pre-existing behaviour this change doesn't reach into.

**Phase 1 done.** `npm test` 276 pass / 0 fail. Verified end to end under a
loader hook that makes `import('keytar')` fail exactly as a missing libsecret
does: `configure_account` and a credential read both succeed on
`MAILMAN_KEYSTORE=passphrase`, the config dir holds no key material, and a fresh
process with the wrong passphrase is refused rather than returning garbage.

## Phase 2 — commands

- [x] `mailman auth migrate-keystore --to <backend>` — read via current, write
      via target, verify a round-trip read, update the pointer, then remove the
      source. Never regenerates the key
- [x] `auth rotate-key` on every backend (for `passphrase`: fresh salt, and
      optionally a new passphrase), keeping the crash-safe write ordering
- [x] `mailman reset` removes the active backend's key material through the
      backend interface — a `file` key outside the config dir would otherwise
      survive and be orphaned

Notes from building it:

- **Migration has two genuinely different shapes**, decided by a new
  `canStore` flag rather than by catching an error. A *storable* target
  (`os-keychain`, `file`) receives the existing key, so no ciphertext is
  rewritten at all; a *deriving* target (`passphrase`, `env`) supplies its own
  key, so everything is re-encrypted through the same engine `rotate-key` uses.
  The move path reads the key back out of the target through a freshly-built
  backend and compares it **before** removing the source copy.
- **`rotate-key` and `migrate-keystore` now share one engine** (`src/rekey.ts`),
  which is what makes "rotate works on every backend" true rather than asserted.
  `prepareNewKey` is called *after* confirmation, so the new-passphrase prompt
  happens at the right moment, and `env` fails there — after the confirm, before
  any write — rather than half way through.
- **Another bug the tests caught:** `os-keychain.store()` persisted the key but
  didn't claim the pointer (`file.store()` already did). A *move* migration is
  exactly a `store()` on the target, so migrating back to `os-keychain` left
  `keystore.json` still naming `passphrase` — reads kept working only because the
  outgoing backend happened to derive the same key.
- **`reset` reads the pointer before the wipe**, since `keystore.json` is what
  says where the key lives and it sits inside the directory being deleted. A
  broken/unknown keystore selection no longer blocks a reset — reset is the
  documented way out of that state.

## Phase 3 — the ticker

- [ ] `buildCronLine` inlines `DBUS_SESSION_BUS_ADDRESS` and `XDG_RUNTIME_DIR`
      when present at install time, plus `MAILMAN_KEYSTORE=<backend>`, so cron
      never probes a bus it cannot reach
- [ ] `doctor` shows the active backend, and warns when the ticker is installed
      in crontab with `os-keychain` active and no `DBUS_SESSION_BUS_ADDRESS` in
      the crontab. Replaces "then log into a desktop session" with real headless
      guidance, keeps the desktop hint for desktop Linux, and mentions
      `loginctl enable-linger` — `/run/user/UID` vanishes without it, so env
      injection alone is not sufficient

## Phase 4 — tests and docs

- [x] Tests: `os-keychain` available / unavailable, passphrase round-trip, wrong
      passphrase rejected, existing-key precedence (no silent regeneration),
      migration, and `MCP_MAILMAN_CONFIG_DIR` isolation of salt/key/pointer
- [x] Suite runs keyring-free. Measured with a loader hook that makes
      `import('keytar')` fail exactly as a missing libsecret does: **39 failures
      before, 0 after** (14 skipped — the ones genuinely about the OS credential
      store). Tests now default to the `passphrase` keystore via a shared
      `test/support/isolate.ts`, which also replaced four near-identical
      hand-rolled isolation helpers. `.github/workflows/ci.yml:22,37` installs
      only `libsecret-1-dev` and runs `npm test` — `.gitlab-ci.yml` documents
      that exact state as 25 failures, so the mirror's CI is fixed as a side
      effect
- [x] Docs: a headless/Docker/CI section replacing `README.md:219-221` (with a
      per-backend "protects against / does not protect against" table), the
      `docs/CROSS-OS.md` matrix + known risks, `docs/CLI.md` (`doctor`,
      `rotate-key`, `reset`, and the new `migrate-keystore`), and a `CHANGELOG`
      entry

**Phase 4 done.** Final state: `npm test` 304 pass / 0 fail with a real keychain,
291 pass / 0 fail / 14 skipped with no keyring at all. Lint and typecheck clean.

Two more things the tests caught, both worth keeping in mind:

- **`os-keychain.store()` did not claim the pointer** (`file.store()` already
  did). A *move* migration is exactly a `store()` on the target, so migrating
  back to `os-keychain` left `keystore.json` still naming `passphrase` — reads
  kept working only because the outgoing backend happened to derive the same key.
- **A pinned `MAILMAN_KEYSTORE` outlives a migration.** An explicit override
  outranks the recorded pointer on every later command, so migrating away from it
  succeeds and then every subsequent command reports "no master key found".
  `migrate-keystore` now warns when the environment is pinned to something other
  than the target.

## Verified on real Ubuntu

```bash
./docker/test-headless-keystore.sh                          # all four modes, native arch, node 20
./docker/test-headless-keystore.sh --platform linux/amd64   # x64 (keytar prebuilds are per-arch)
./docker/test-headless-keystore.sh --node 18 none           # the floor `engines` claims
```

Reproduces every state from the report on real Ubuntu and runs 50–51 assertions
against the **globally installed tarball** (`dist/`, not `src/`) in each:

| Mode | Environment | Result |
|---|---|---|
| `none` | no libsecret — keytar's native module cannot load | **50 checks, 0 failures** |
| `libsecret` | the library, but nothing serving the Secret Service | **50 checks, 0 failures** |
| `full` | libsecret + gnome-keyring + dbus (desktop equivalent) | **51 checks, 0 failures** |
| `musl` | node:20-alpine, no libsecret — the old "known risk" | **50 checks, 0 failures** |

Run across: **arm64** and **x86_64** (emulated — keytar ships per-arch N-API
prebuilds, so the two do not exercise the same native binary), and on **node 18**
(the `engines` floor) and **node 24** as well as 20. Node 18 matters
specifically because the scrypt parameters need an explicit `maxmem` — getting
that wrong is a hard throw, not a slowdown.

Distinct from `docker/test-linux.sh`, which asserts the *pre-1.3.0* contract
("headless → must fail clean"). That is no longer the contract.

### What these scripts are, and are not

They are **developer tooling, never shipped**: `package.json`'s `files` is
`["dist", "bin", "README.md"]`, so `docker/` and every `.sh` stay out of the
published tarball. Nothing about their shell portability can affect a user on any
OS.

`run-keystore-checks.sh` runs *inside* the containers, so its shell is always
Linux. `test-headless-keystore.sh` runs on the maintainer's machine and needs
`bash` + Docker — fine on macOS and Linux; on Windows it would need Git Bash or
WSL, which has not been tried.

So coverage by platform is:

| Platform | How it's covered |
|---|---|
| **Linux** (glibc + musl) | this Docker harness, four keyring states × 2 arches × node 18/20/24 |
| **macOS** | the unit suite runs natively against a real login Keychain (`os-keychain` create/read/rotate/migrate/reset) |
| **Windows** | **no hardware, not verified.** Same amber column as the rest of `docs/CROSS-OS.md` |

Windows is the honest gap, so the platform-dependent code paths at least take an
explicit `platform` argument and are asserted from any machine —
`credentialStoreName()` and `defaultKeyFilePath()`, alongside the existing
`installHint()`. The one that matters most is `defaultKeyFilePath('win32')`: it has
to resolve under `LOCALAPPDATA`, not `APPDATA`, because the config dir lives in the
**roaming** profile and Windows copies that between machines by design — picking
the wrong one raises no error, it just quietly undoes the property the `file`
backend exists to provide. What is still unverified there is the runtime behaviour
of Credential Manager and Task Scheduler, which needs real hardware.

What it actually exercises, beyond what unit tests can reach: a real `npm install
-g` on a box with no libsecret; `configure_account` + credential decrypt with no
keyring at all; a wrong passphrase refused in a **fresh process** (no in-memory
cache to accidentally satisfy it); the app password and passphrase both absent
from everything on disk; `0600` on the key file and `reset` deleting it from
outside the config dir; a real `crontab` line carrying the D-Bus environment and
**not** the passphrase; a stale line being repaired; `send-scheduled --due`
completing a dispatch with `DBUS_SESSION_BUS_ADDRESS` stripped from the
environment; and — in `full` — that the default path still puts the key in the
Secret Service, plus an `os-keychain → passphrase → os-keychain` round trip that
leaves credentials readable.

**Two real defects it caught that nothing else did**, both in `doctor`, both the
same shape — advice or a verdict that is wrong specifically on a machine without a
desktop. Regression tests for both in `test/doctor-install-hint.test.ts`.

1. **On a bare server, `--fix` sent you further into the dead end.** The probe
   classified the failure as a missing *library* (correct) and printed only `sudo
   apt install libsecret-1-0` — which moves the machine from "no library" to
   "library, no daemon", the next state in the same trap. The keystore escape
   hatch existed only in the `keyring-daemon` hint, which that code path never
   reaches. The `libsecret` hint now offers both routes (and mentions `apk` for
   musl).
2. **A fully working setup was reported as failing.** Found on Alpine: libsecret
   is absent, the `passphrase` keystore works end to end, and `doctor` still
   printed `missing: libsecret` and "Some checks failed". libsecret is a
   dependency of *one* backend, so it is now only reported as missing when
   `os-keychain` is the active one — the same correction already made for the `OS
   credential store` row, which I had missed for the dependency row.

(Three other failures in the first run were bugs in the harness itself, not the
product: `require('keytar')` resolved from `/work` instead of mailman's dependency
tree so the environment probe proved nothing; an assertion truncated the error
message at 80 characters before reaching the text it was looking for; and the
ticker section fabricated `DBUS_SESSION_BUS_ADDRESS`/`XDG_RUNTIME_DIR` and then
*unset* them, destroying the real session bus `dbus-run-session` had provided and
failing every later `os-keychain` check.)

## Deliberately not done

- **Windows Task Scheduler carries no environment.** `schtasks /TR` takes a bare
  command, so unlike cron and launchd the ticker there cannot inherit a
  non-default `MCP_MAILMAN_CONFIG_DIR` or a pinned `MAILMAN_KEYSTORE`. Harmless
  on a default install; it would bite an isolated profile. Left alone because it
  is unverifiable on this hardware — same reason the Windows column of
  `docs/CROSS-OS.md` is amber. Noted there and in `installTickerIfNeeded`.
- **A missing key on the backend that legitimately owns it** (someone deleted
  their keychain entry while `accounts.json` still has ciphertext) still
  regenerates, orphaning the other accounts. Pre-existing behaviour, unrelated to
  headless support, and changing it would turn "re-add my account" into "you must
  reset". Flagged rather than fixed.
- **Cross-process races on `scheduled.json`.** `rotate-key`/`migrate-keystore`
  and the ticker are separate processes, and the write queue in
  `config/store.ts` is per-process. Narrowed by re-encrypting inside
  `updateJsonFile` (so the rewrite applies to the freshest content on disk) but
  not eliminated. Pre-existing; would need a lock file.

## Raised, not acted on

- **Env var prefix.** Anything new uses `MAILMAN_` — it's the product's name;
  `MCP_` is a protocol. Not renaming the existing two:
  `MCP_MAILMAN_CONFIG_DIR` is load-bearing in every editor MCP config already
  written, and the payoff is cosmetic. If unification is wanted, the cheap
  version is accepting both with the `MCP_` form logged as deprecated and no
  removal date.
- **keytar replacement.** Already evaluated — see
  [KEYTAR-MIGRATION.md](KEYTAR-MIGRATION.md). Out of scope here.
