# keytar → @napi-rs/keyring — Migration Evaluation

Status: **evaluated 2026-07-02, recommendation: migrate** (not yet
implemented). Closes the "evaluate migrating off unmaintained keytar"
backlog item from [CROSS-OS.md](CROSS-OS.md).

## Why move at all

`keytar` is unmaintained: the Atom org sunset it and archived the repo.
It still works (2.3M weekly downloads of pure inertia), but it gets no
fixes, and it's a C++/node-gyp addon — the exact class of dependency that
breaks first on new platforms. It's also the source of two known gaps in
our support matrix: no musl/Alpine prebuild, and a source build that needs
`libsecret-1-dev` + a toolchain.

## Candidates (registry data, 2026-07-02)

| | `keytar` (current) | **`@napi-rs/keyring`** | `@postman/node-keytar` |
|---|---|---|---|
| Maintained | ❌ archived; last registry activity 2025 | ✅ active (napi-rs org, last publish 2026-04) | 🟡 fork, active-ish (2026-06) |
| Weekly downloads | 2.30M | 1.58M | 4.6k |
| Implementation | C++ / node-gyp | Rust ([keyring-rs](https://github.com/hwchen/keyring-rs)) via N-API | same C++ as keytar |
| Prebuilds | common glibc/darwin/win32 | **12 targets** incl. linux **musl** x64+arm64, win32 arm64/ia32, freebsd, riscv | like keytar |
| musl/Alpine | ❌ source build | ✅ prebuild | ❌ |
| License / engines | MIT | MIT / node ≥10 | MIT |

`@postman/node-keytar` is a life-support fork — same codebase, negligible
adoption; it postpones the problem without fixing musl. `@napi-rs/keyring`
is the real successor: maintained bindings over the widely-used
keyring-rs, from the team behind the napi-rs toolchain half the JS
ecosystem's native modules build on.

## Empirical compatibility (verified on THIS machine, macOS, 2026-07-02)

The question that decides whether existing users need any migration:
do both libraries address the **same** OS credential record?

- ✅ `new Entry('mcp-mailman', 'master-key').getPassword()` read the
  **real master key that keytar wrote** (44-char base64 of 32 bytes) —
  same Keychain generic-password record, byte-identical value.
- ✅ Reverse direction: keytar read back an entry written by
  `@napi-rs/keyring` — a rollback to keytar would also be lossless.
- ✅ set → get → delete roundtrip clean under a throwaway service name.

So on macOS the swap is **zero-migration**: existing installs keep
decrypting with no user action.

**Linux is different — verified 2026-07-02 in the Docker harness
(`docker/test-linux.sh`), and it changes the plan.** On Linux the two
libraries do **NOT** cross-read: `@napi-rs/keyring` works standalone
(self-roundtrip ✓) but returns `null` for an entry keytar wrote
(`KEYRING_SELF=yes XREAD=no`). The cause is structural, not a bug — the
Secret Service (libsecret) matches items by **attribute sets**, and keytar
vs keyring-rs populate different attributes, so a keyring lookup never
finds keytar's item. macOS avoided this because the Keychain keys generic
passwords natively on (service, account); Linux/libsecret does not.

Consequence: a Linux user who configured mailman on keytar would hit
`NO_MASTER_KEY` after the swap and have to re-run `configure_account`.
**This is acceptable today only because there are zero real Linux installs
yet** (macOS is the only verified platform). But it means the swap is
*not* universally zero-migration, and if Linux users onboard before the
migration lands, 0.6.0 must either (a) accept a one-time reconfigure on
Linux, or (b) ship a transitional step that reads the old key via keytar
and rewrites it via keyring during the upgrade (keeping keytar as a
short-lived transitional dep). Windows cross-read remains unverified (no
Windows Docker on a Linux daemon — needs a CI runner).

## API mapping

keytar's promise API maps onto `Entry` almost 1:1; the only shape change
is instance-vs-static and sync-vs-async (keychain ops are single fast
syscalls — sync is fine; `keychain.ts`'s exported functions stay `async`
so no caller changes at all):

| keytar | @napi-rs/keyring |
|---|---|
| `getPassword(svc, acct)` → `string \| null` | `new Entry(svc, acct).getPassword()` |
| `setPassword(svc, acct, pw)` | `new Entry(svc, acct).setPassword(pw)` |
| `deletePassword(svc, acct)` → `boolean` | `new Entry(svc, acct).deletePassword()` |

Implementation note: confirm `getPassword()`'s missing-entry behavior
(null vs. throw) during the swap and normalize to keychain.ts's existing
"null = not found" contract — wrap in try/catch mapping a not-found error
to null if needed. Everything else (`NoMasterKeyError`,
`KeyringUnavailableError`, the no-plaintext-fallback policy, the
test-isolated service names) is above the seam and unchanged.

## Touchpoints (the entire blast radius)

keytar is imported in exactly four places, all trivially swappable:

- `src/config/keychain.ts` — the seam; all master-key logic
- `src/cli/doctor.ts` — keyring reachability probe
- `src/cli/reset.ts` — best-effort master-key deletion
- `test/accounts.test.ts` (+ keychain tests) — per-test cleanup

Bonus cleanup: the "keytar's CJS named exports are unreliable under
dynamic ESM import, always go through `.default`" workaround (documented
in keychain.ts and doctor.ts) dies with keytar.

## Plan

1. **0.6.0** (next minor after 0.5.0): swap all four touchpoints to
   `@napi-rs/keyring`; remove `keytar`. macOS is zero-migration (verified
   cross-read). Linux does NOT cross-read (verified — see above), but the
   install base there is empty, so a direct swap is still acceptable; if
   that changes, add the read-old-via-keytar/write-new-via-keyring
   transitional step. Update CROSS-OS.md (musl row → 🟡 prebuild
   available; prebuild paragraph rewritten).
2. **Acceptance on this machine**: full test suite green; `mailman
   status` still shows "master key found"; a real send works with **no
   reconfiguration** (proves the existing key kept decrypting).
3. **Rollback**: republish previous version — reverse cross-read is
   verified, so keytar reads whatever keyring wrote in the interim.
4. **Linux/Windows smoke** (tasks #94/#95): add "cross-read a
   keytar-written entry" to each checklist run before declaring the
   platform verified.
