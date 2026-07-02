# Cross-OS Support — Keychain, Config, Scheduler

How mailman's machine-bound storage works on each OS, what's actually been
verified vs. merely implemented, and the exact checklist to run when a
Linux or Windows machine becomes available. This expands the one-line
"cross-OS smoke test" item in [CHECKLIST.md](CHECKLIST.md) Phase 9.

**Legend:** ✅ verified on a real machine · 🟡 implemented + unit-tested,
expected to work, not yet verified on real hardware · ❌ known gap /
deliberate non-goal.

## Support matrix

| Capability | macOS | Linux (desktop) | Linux (headless) | WSL | Windows |
|---|---|---|---|---|---|
| Credential store (master key) | ✅ Keychain (login) | 🟡 Secret Service via libsecret (gnome-keyring / KWallet) | ❌ by design — fails with instructions, never plaintext | ❌ like headless Linux (no Secret Service daemon by default) | 🟡 Credential Manager |
| Config dir | ✅ `~/Library/Application Support/mcp-mailman/` | 🟡 `~/.config/mcp-mailman/` | 🟡 same | 🟡 same | 🟡 `%APPDATA%\mcp-mailman\` |
| Encryption at rest (AES-256-GCM, key never on disk) | ✅ real account | 🟡 same code path | — | — | 🟡 same code path |
| No-keyring failure mode (clear error, no plaintext fallback) | ✅ simulated (deleted keychain entry → clean `NO_MASTER_KEY`) | 🟡 | 🟡 doctor names the missing daemon | 🟡 | 🟡 |
| Scheduled-send ticker | ✅ launchd agent (live fire verified 2026-07-02) | 🟡 crontab entry | 🟡 crontab | 🟡 crontab (needs cron running) | 🟡 Task Scheduler (`schtasks`) |
| CLI bins (`mailman` + `mcp-mailman` alias) | ✅ | 🟡 (GNU Mailman collision possible → use `mcp-mailman`) | 🟡 same | 🟡 | 🟡 npm `.cmd`/`.ps1` shims; no GNU collision |
| MCP stdio server + editor config write | ✅ (Claude Code, real `~/.claude.json`) | 🟡 | ❌ interactive `init` needs a TTY (guard added) | 🟡 | 🟡 |

## How the credential store works per OS

One code path (`src/config/keychain.ts`) — `keytar.setPassword('mcp-mailman',
'master-key', <256-bit key>)` — backed by a different OS facility on each
platform:

- **macOS** — the login Keychain. Inspect with Keychain Access → search
  "mcp-mailman". No extra setup.
- **Windows** — Credential Manager (Generic Credentials). Inspect via
  Control Panel → Credential Manager. No extra setup.
- **Linux** — the Secret Service D-Bus API through `libsecret`, provided by
  gnome-keyring (GNOME) or KWallet (KDE). Requires the **runtime library**
  (`libsecret-1-0` on Debian/Ubuntu, `libsecret` on Fedora/Arch) *and* a
  **running, unlocked** daemon. Inspect with `secret-tool search service
  mcp-mailman` or Seahorse.
- **keytar prebuilds** — keytar 7.x ships N-API prebuilds for common
  glibc/darwin/win32 x64+arm64 targets (N-API = no rebuild on Node major
  bumps). On musl (Alpine) or unusual arches it compiles from source, which
  additionally needs `libsecret-1-dev`, `pkg-config`, and build tools on
  Linux.

**Headless Linux / WSL / containers are a deliberate ❌, not a bug**: no
Secret Service daemon → setup fails with instructions rather than silently
degrading to plaintext (see README's security section). A user who *wants*
keyring-on-headless can run `dbus-run-session` + `gnome-keyring-daemon`,
but mailman doesn't automate or recommend that.

## Verification checklist (run per OS when hardware is available)

Same script on each target — check off per OS:

1. [ ] Node ≥ 18 on PATH (`node --version`); old-Node guard prints the
       friendly message when run with an old binary.
2. [ ] `npm install -g @indianic/mailman` resolves via the `@indianic`
       scope routing in `~/.npmrc`; both `mailman` and `mcp-mailman` bins
       land on PATH (Windows: `.cmd` shims work from cmd + PowerShell).
3. [ ] `mailman doctor` — keyring probe passes (or, headless: fails with
       the daemon-naming message); SMTP/IMAP reachability green.
4. [ ] `mailman init` — full wizard: account stored, keychain entry
       visible in the OS's credential UI, `accounts.json` on disk contains
       ciphertext only (grep for the app password → no hit), editor config
       written and valid JSON/TOML.
5. [ ] Real send + read through the MCP server (draft → confirm → IMAP
       read-back), same as the macOS Phase 1/7 verification.
6. [ ] Machine-boundness: copy `accounts.json` to a second user/machine →
       `confirm_send` fails cleanly with `NO_MASTER_KEY`, no plaintext
       fallback.
7. [ ] Scheduler: `schedule_send` installs the OS ticker (crontab line /
       schtasks task), a send fires with the MCP process closed, and the
       entry is marked `sent`.
8. [ ] `mailman update` self-updates from npm.indianic.in.
9. [ ] `mailman reset --yes` wipes the config dir **and** removes the
       credential-store entry (verify in the OS credential UI).

macOS column of the matrix is filled from the real verification runs on
2026-07-01/02 (see CHECKLIST.md Phases 1, 3, 7 and the `mailman init` run
that wrote `~/.claude.json`).

## Known risks / backlog

- **keytar is unmaintained upstream** (the Atom project sunset it; repo
  archived). **Evaluated 2026-07-02 → migrate to `@napi-rs/keyring`**:
  cross-read of the real keytar-written entry verified in both directions
  on macOS (zero-migration swap), musl/Alpine prebuilds included. Full
  findings + phased plan: [KEYTAR-MIGRATION.md](KEYTAR-MIGRATION.md).
- **musl/Alpine**: no prebuild → source build needs libsecret headers +
  toolchain; document or ship a prebuild if container use becomes real.
- **WSL**: behaves like headless Linux. If demand appears, document the
  `gnome-keyring-daemon` recipe explicitly rather than auto-starting one.
