# Changelog

All notable changes to this project will be documented in this file.

## [1.4.0] - 2026-08-03

### Added

- **Replies now thread.** `draft_email` accepts `inReplyTo` and `references`, and
  emits the RFC 5322 `In-Reply-To`/`References` headers. Previously mailman set
  only `X-Mailer` and a fresh `Message-ID`, so a reply arrived as a brand-new
  message: Gmail's web UI often regrouped it by subject, but Outlook, Apple Mail
  and Thunderbird thread strictly on those headers and showed it detached. The
  `reply` template could quote the original but never thread it — the tool
  surface advertised reply support it could not actually deliver.
- **`read_email` returns `messageId`**, the original's RFC 5322 header. Nothing in
  the surface carried it before, so a reply was impossible to construct even by
  hand: `id` is a provider-local handle (an IMAP UID or Gmail API id) and will not
  thread anything. The schema says which of the two it wants, because passing the
  wrong one fails silently.
- `references` defaults to `[inReplyTo]` — correct for replying to a root message,
  so a caller only needs the single id `read_email` hands back. Pass the array
  explicitly to preserve a longer chain.

Threading carries through the whole path: draft → `confirm_send`, and draft →
`schedule_send` → the encrypted entry → dispatch, so a reply queued for 9am still
lands in its thread. The scheduled fields are optional, so entries queued by an
earlier version still parse rather than becoming undecryptable on upgrade.

Both transports covered: the App Password/SMTP path via nodemailer, and the Gmail
API path asserted on the compiled RFC-822 bytes. A fresh message emits neither
header — an empty `In-Reply-To` is malformed and would thread the message under
nothing.

### Internal

- One `escapeHtml`, not two. `templates.ts` had a private copy escaping only
  `& < >` while `compose.ts` gained a more complete one in 1.3.2; two subtly
  different escapers in one mail pipeline is how one of them ends up wrong.

## [1.3.2] - 2026-08-03

### Fixed

- **HTML email signatures were broken two ways.** The account signature is a
  plain-text field — `account profile --signature "Regards,\nKalpesh"` stores a
  real newline — but it was dropped into an HTML body verbatim. Newlines
  collapsed, so a multi-line signature arrived as one run-on line ("Regards,
  Kalpesh Gamit IndiaNIC"), and markup characters were interpreted rather than
  shown: a signature containing `<kalpesh@indianic.com>` **disappeared entirely**
  because the browser read it as an unknown tag, and `Sales & Marketing` was an
  invalid entity. Silent loss of content in every outgoing HTML email. The
  signature is now escaped and then newline-converted (that order matters — the
  reverse escapes the `<br>` it just inserted), CRLF/CR are normalised so a
  signature typed on Windows breaks identically, and a stored signature can no
  longer close the polished theme's card or open a tag that swallows the footer.
  Text bodies are unchanged. The trade-off, stated plainly: a signature that
  deliberately contained HTML now shows its tags literally instead of rendering —
  correct for a field documented as plain text, and a visibly literal tag beats
  content that vanishes.

## [1.3.1] - 2026-08-03

Internal release tooling only — **no change to the published package.** `dist/`
is byte-identical to 1.3.0; this exists because the version was bumped, not
because anything users install has changed.

- `scripts/release-auto` — wraps `scripts/release` and supplies the two
  credentials it otherwise stops to ask for, so a release needs no prompts. The
  npm token must be an *Automation* token (the only type that bypasses 2FA for
  publishing) and is injected through a 0600 temp npmrc deleted on every exit
  path; nothing is written to `~/.npmrc` or the repo. Not shipped: `scripts/` is
  excluded from both the npm tarball and the GitHub mirror.

## [1.3.0] - 2026-08-03

### mailman now works on headless Linux — servers, containers, CI, WSL

Installing on a desktop-less Ubuntu box used to fail three times in a row: a raw `libsecret-1.so.0: cannot open shared object file` linker crash, then `Keyring backend: unreachable` once the library was installed, then `doctor --fix` advising you to "log into a desktop session" on a machine with no session to log into. Getting `gnome-keyring` working headlessly took ~16 extra packages, an `--unlock` systemd user service fed a password file, and `loginctl enable-linger`. That is not an install path for a mail CLI.

The master key now lives behind a **keystore backend** (`src/config/keystore/`). `keychain.ts` keeps its exact public surface — `getOrCreateMasterKey`, `getMasterKeyOrThrow`, `setMasterKey`, `generateMasterKey`, `getServiceName`, `NoMasterKeyError`, `KeyringUnavailableError` — and every one of its callers is unchanged.

- **`os-keychain`** (default, unchanged) — macOS Keychain, Windows Credential Manager, Linux Secret Service. Same service name, same account name, same storage location: **no existing install migrates or re-keys.**
- **`passphrase`** — scrypt from `MAILMAN_MASTER_PASSPHRASE` or an interactive prompt, plus a random salt. **No key material at rest.** A wrong passphrase is rejected with a sentence rather than a GCM auth-tag failure from inside a send.
- **`env`** — a base64 key handed over in `MAILMAN_MASTER_KEY`. Nothing is persisted; the platform owns the secret. The right answer for Docker/Kubernetes secrets, systemd `LoadCredential=`, and CI.
- **`file`** — opt-in `0600` key file created with `O_EXCL`, **outside** the config dir so key and ciphertext are not copied together. Reported by `doctor` as degraded, not healthy.

**Existing secrets are never orphaned.** A recorded backend always beats a probe, so a reachable keychain cannot silently take over a `passphrase` install. Setting `MAILMAN_KEYSTORE` to something other than where the key already lives is *refused* when credentials exist, rather than quietly minting a second key that leaves the first batch unreadable — the failure mode this whole design is arranged around. Where the key lives is recorded in a new `keystore.json` (backend name, scrypt salt, key-file path — **no key material**), because an unreachable Secret Service is otherwise indistinguishable from an empty one, and guessing wrong is what destroys credentials.

- **New: `mailman auth migrate-keystore --to <backend>`** — the sanctioned way to move the key. A target that can hold a key receives the existing one and nothing is re-encrypted; a target that supplies its own key causes every stored credential to be rewritten under it. The key is read back out of the target and verified *before* the old copy is removed.
- **`mailman auth rotate-key` works on every backend.** For `passphrase` that means a fresh salt against the same passphrase; `env` refuses, because there is nowhere for mailman to put a new key.
- **`mailman reset` no longer orphans a `file` key.** It removes key material through the backend, so a key deliberately kept outside the config dir doesn't survive the wipe as 32 bytes of live secret in `~/.local/state`.

### Fixed

- **A missing `libsecret` produced a raw linker stack trace instead of the no-keyring guidance.** The keytar import sat *outside* the try/catch in all three of `keychain.ts`'s functions, so a native-load failure escaped as a bare `Error` and slipped past every `instanceof KeyringUnavailableError` handler in the codebase — the exact handlers that exist to explain this. (`--help`, `doctor` and `status` were always fine; keytar has been lazily imported for a long time.)
- **`auth rotate-key` silently killed pending scheduled sends.** It re-encrypted `accounts.json` only, but `scheduled.json`'s message content uses the same master key. Every queued entry was left readable solely under the discarded key: `scheduled list` broke, and the ticker's GCM auth-tag failure was swallowed as a retryable error, so those sends died quietly after 5 attempts. Both files now rotate together, with an up-front dry run — an undecryptable *account* blocks the rotation before anything is written, an already-orphaned *scheduled* entry is reported and skipped so pre-existing damage can't block rotation forever.
- **Scheduled sends on Linux failed at 3am with `Cannot autolaunch D-Bus without X11 $DISPLAY`.** The crontab line carried `PATH` and nothing else, and cron has no session bus. It now also carries `DBUS_SESSION_BUS_ADDRESS`, `XDG_RUNTIME_DIR`, `MCP_MAILMAN_CONFIG_DIR` and `MAILMAN_KEYSTORE`, and an older line is repaired the next time a send is scheduled. Secrets are deliberately *not* written there — `doctor` reports the passphrase-under-cron combination instead of quietly putting your passphrase in a crontab.
- **`doctor` claimed `libsecret: present (keytar can reach the Secret Service)`** off a bare `ldconfig` grep. That is false on a headless box — present library, no daemon. Library and daemon are now separate rows, `--fix` routes off what the probe actually reported rather than what `ldconfig` guessed (fixing two mis-routings: a present-but-unusable library was told to install gnome-keyring, and an `ldconfig`-less image got no hint at all), and the credential store is only reported as *failed* when it is the store actually in use.
- **`doctor`'s keyring probe wrote into the real keychain namespace** even under `MCP_MAILMAN_CONFIG_DIR`, which exists precisely to keep isolated profiles away from real credentials. It now probes under `getServiceName()`.
- **`doctor --fix` sent headless servers further into the trap.** With no libsecret it printed only `sudo apt install libsecret-1-0`, which moves the machine from "no library" to "library, but no Secret Service daemon" — the next state in the same dead end, and the start of the 16-package detour. The `libsecret` hint now offers the keystore route too (and names `apk` for musl). Found on a real Ubuntu container; the unit tests could not see it because they never asked which of the two Linux failure modes was in play.
- **A working headless setup was reported as broken.** libsecret is a dependency of exactly one backend, but it was reported as a missing dependency regardless — so on Alpine, where the `passphrase` keystore works end to end, `doctor` still printed `missing: libsecret` and "Some checks failed". It is now only counted when `os-keychain` is the active keystore.
- fix: `schedule_send` now returns `DRAFT_ALREADY_SENT` for a draft that has already gone out, instead of `DRAFT_EXPIRED`. The two mean opposite things to a caller deciding what to do next — an expired draft can be recreated and scheduled, whereas an already-sent one means the mail is gone and scheduling it again would send a second copy. `DRAFT_ALREADY_SENT` was declared in `ErrorCodes` and returned by nothing, so a model branching on it had a permanently dead path.
- fix: `chmod` on the config files and the activity log no longer throws where POSIX permissions do not exist (Windows, FAT/exFAT volumes, some network mounts). Both files are now created with mode `0o600` directly and the `chmod` is a re-assertion that is allowed to fail — previously it could take down the surrounding write, credentials included, because a permission bit could not be set.
- `DRAFT_NOT_FOUND` messages now say what to do about it. "No such draft: `<id>`" named the problem and left the caller with nowhere to go; each of the three sites now explains that drafts are in-memory and expire, except `cancel_draft`, where the honest answer is that nothing is pending and no action is needed.
- Docs: `docs/SKILLS.md` now lists the error codes `schedule_send` and `cancel_draft` can return, and says which of them are worth branching on separately.

### Newly supported

- **Alpine/musl works.** `docs/CROSS-OS.md` listed it as a known risk ("no prebuild → source build needs libsecret headers + toolchain"). Verified on `node:20-alpine`: `npm install -g` succeeds, keytar's binary then fails to *load* for want of libsecret, and `MAILMAN_KEYSTORE=passphrase` (or `env`) carries the whole flow with `doctor` reporting green.

### Internal

- `npm test` passes with **no OS keyring at all** (verified under a loader hook that makes `import('keytar')` fail exactly as a missing libsecret does). Tests default to the keyring-free `passphrase` keystore via a new shared `test/support/isolate.ts`; the 14 that are genuinely *about* the OS credential store are skipped rather than failed where none exists. `.gitlab-ci.yml` measured the old state as 25 failures with `libsecret` but no daemon — which is exactly what `.github/workflows/ci.yml` provides, so the mirror's `npm test` was red.
- Full design, and the corrections the investigation made to the original bug report, in [docs/HEADLESS-KEYSTORE.md](docs/HEADLESS-KEYSTORE.md).

## [1.2.1] - 2026-07-30

- `mailman doctor` gained a **dependencies** section and a `--fix` flag. It already reported that the keyring was unreachable but never why, and on Linux there are two causes that look identical from the outside and need different fixes. The section now checks `npm` (which `mailman update` shells out to) and, on Linux only, `libsecret` — keytar's native backend; macOS and Windows ship their own credential store, so nothing is checked or suggested there. `--fix` prints the exact platform command: `sudo apt install libsecret-1-0` when the library is absent, versus `sudo apt install gnome-keyring` when it is present but no Secret Service daemon is running. Both cases verified against real containers. Commands are printed, never executed — installing a system library needs root. Where `ldconfig` is unavailable (musl/Alpine) it reports "could not verify" rather than claiming the library is missing.
- **Every MCP tool schema is now closed and fully documented.** All 25 declare `additionalProperties: false` and an explicit `required` array, and all 34 previously undescribed parameters — including `confirm_send.draftId` and `draft_email.body` — now carry descriptions. Nothing validates arguments against these schemas before dispatch (each handler's zod parse strips unknown keys), so the schema was the only place the contract could be stated: without it a model that invented an argument got a success it should not have and never learned the parameter did not exist. Both fields are now required by `ToolDefinition`, so the compiler rejects a new tool that omits them. No runtime behaviour changed and no existing caller can break.
- Docs: the README advertised 23 MCP tools when the server exposes 25; `list_templates` shipped with no `docs/SKILLS.md` entry at all; and `mailman account password` was implemented and in `mailman help` but missing from `docs/CLI.md`. All three corrected.

## [1.2.0] - 2026-07-30

- Session reports: turn past AI coding sessions into an email. Two new MCP tools — `list_sessions` (search this machine's own transcripts by project, text, branch or recency; metadata only, never transcript content) and `read_session_digest` (a compact, secret-scrubbed skeleton of up to 10 sessions) — plus `mailman session list` / `mailman session report` in the CLI and a `session-report` template. Neither tool summarizes: they extract, and the calling Claude session composes, then sends through the usual `draft_email` → preview → `confirm_send` flow. The skeleton drops every tool result, which is both the bulk of a transcript's bytes and where pasted secrets land — a 986 KB session becomes 19 KB, and across three real transcripts holding 11 credential-shaped strings none reached the skeleton. Surviving text is scrubbed for known token shapes. Indexing is cached on mtime+size, so a first build over 2,258 sessions takes ~4.4s and later runs ~0.2s.

## [1.1.4] - 2026-07-28

- fix: a blocked TLS handshake is no longer reported as a wrong password. On machines with corporate TLS inspection or antivirus HTTPS scanning — routine on managed Windows — setup failed with `self-signed certificate in certificate chain` under the headline "Gmail rejected these credentials", sending users off to regenerate an App Password that Gmail had never seen. Verification now distinguishes certificate-trust, network, anti-abuse and genuine credential failures, headlines each one accurately, and for a trust failure prints the fix (`NODE_OPTIONS=--use-system-ca` in the right shell syntax for the platform, or `NODE_EXTRA_CA_CERTS`) — Node ships its own CA list and never reads the Windows certificate store, which is why the browser works and mailman doesn't. The retry menu now offers "keep the App Password I entered" first whenever the password was never actually checked.
- `mailman doctor`'s SMTP/IMAP reachability checks now complete a fully verified TLS handshake instead of a bare TCP connect. Both Gmail ports are implicit TLS, so the old check reported "reachable ✓" on exactly the machines where nothing could connect; on a trust failure it now names the root CA the chain ends at and prints the same fix once below the checks.

## [1.1.3] - 2026-07-27

- fix: `draft_email` no longer rejects multiple recipients in `to`. A comma/semicolon-separated string (`"alice@example.com, bob@example.com"`) and the `"Name <alice@example.com>"` form are now accepted for `to`/`cc`/`bcc` — previously only an exact bare address or array passed, so callers hit `INVALID_INPUT` and worked around it by demoting a recipient to `cc`. `cc`/`bcc` also accept a bare string now, matching `to`. Unparseable addresses still fail, with an error naming the field and entry.
- `mailman doctor` now reports which `mailman` the shell actually runs. When another package name owns that command (`@indianic/mailman`, `mcp-mailman`) or a non-npm binary shadows it (GNU Mailman's `/usr/bin/mailman`), the check fails and prints the uninstall-then-install fix — the state behind npm's bare `EEXIST: file already exists` install error, which npm raises before any of the incoming package's scripts can run. Reachable as `npx -y @integratex/mailman doctor --offline` while a global install is still blocked.

## [1.1.2] - 2026-07-21

- Fix public build: package name (editor MCP configs, scheduled-send ticker, self-update) now resolved from package.json at runtime, so the public @integratex/mailman build no longer references the private @indianic package. Public npmjs install is now the documented path on GitHub; private-registry docs moved to INTERNAL.md (excluded from the mirror).

## [1.1.0] - 2026-07-06

- feat: mailman account password — update an account's App Password in place (picker + live verify)

## [1.0.0] - 2026-07-03

- release: 1.0.0 — first stable release

## [0.14.0] - 2026-07-03

- feat: branded polished email shell by default with always-on IndiaNIC footer; emailTheme now settable

## [0.13.0] - 2026-07-03

- feat: interactive account picker for remove/set-default + spaced-alias handling

## [0.12.2] - 2026-07-03

- fix: OAuth2 accounts now send via the Gmail REST API (gmail.send scope) instead of SMTP — resolves 'Cant create new access token for user'

## [0.12.1] - 2026-07-03

- fix: interactive signature prompt now accepts multi-line input / paste-from-anywhere

## [0.12.0] - 2026-07-03

- feat: inline App Password setup guide + self-describing settings get/set (valid values + descriptions)

## [0.11.0] - 2026-07-03

- feat: inline step-by-step Google Cloud OAuth client setup guide in the browser sign-in flow

## [0.10.0] - 2026-07-03

- feat: enforce one email = one account (DUPLICATE_EMAIL) across configure_account, account add, auth login

## [0.9.2] - 2026-07-03

- fix: OAuth2 redirect_uri_mismatch guidance (Desktop-app requirement) + 5-min consent timeout instead of hang

## [0.9.1] - 2026-07-03

- fix: OAuth Client ID/Secret now required (no more 'undefined' + empty-credential consent); guard optional profile fields

## [0.9.0] - 2026-07-03

- feat: init/account add offer browser sign-in (OAuth2) as a choice alongside App Password

## [0.8.1] - 2026-07-03

- fix: verify loop no longer traps users — retry/save-anyway/cancel choice, 16-char hint, Google temp-block detection

## [0.8.0] - 2026-07-03

- feat: verify credentials in configure_account before storing; live per-account login check in doctor

## [0.7.0] - 2026-07-03

- feat: verify Gmail credentials at init/account add with retry loop; npm+pnpm-aware update

## [0.6.2] - 2026-07-03

- docs: restructure README to clean Title/Features/Installation/Usage format

## [0.6.1] - 2026-07-03

- fix: confirm_send now enforces alwaysConfirm — refuses to send unless confirm:true is passed (real confirmation gate; previously the setting was ignored)

## [0.6.0] - 2026-07-03

- feat: **message templates** — new `list_templates` tool (182 templates across ~20 categories, filterable by `category`/`search`; core set by default) and an optional `template` param on `draft_email`. Most templates are a subject prefix + a structural hint Claude composes from (mailman stays dumb); `fwd`/`reply` are mechanical and build a real Gmail-style quoted block from `forwarded*` fields.
- feat: **subject improvement** — template prefixes are applied de-duplicated (never `FYI: FYI:` / `Re: Re:`).
- feat: **polished email theme** — opt-in `settings.emailTheme` (`plain`|`polished`) + per-call `theme` param wraps HTML bodies in a clean, minimal shell.
- change: **HTML is now the default body type** for new installs / configs without the field set. Existing configs that explicitly stored `text` are untouched — flip with `mailman settings set defaultBodyType html`.
- Total MCP tools: **23** (added `list_templates`).

## [0.5.6] - 2026-07-02

- compact draft preview (token savings), desktopNotifications settable via MCP tools, FEATURES.md + docs close-out

## [0.5.5] - 2026-07-02

- change: desktop notifications now on by default (disable via settings); simplified to reliable osascript path; toggle added to 'mailman examples'

## [0.5.4] - 2026-07-02

- feat: opt-in native desktop notifications on send (macOS/Linux/Windows), with a branded macOS notification icon via a generated mailman.app bundle

## [0.5.3] - 2026-07-02

- feat(cli): passive 'update available' notifier — cached, non-blocking, TTY-only notice shown before command output when a newer version is published

## [0.5.2] - 2026-07-02

- Sent messages are now branded for easy tracking: Message-ID local part is mcp-mailman.<uuid> and an X-Mailer: mcp-mailman header is set on every send (both App Password and OAuth2).

## [0.5.1] - 2026-07-02

- init/account add no longer ask App Password vs OAuth2 — they go straight into the simple email + App Password flow. OAuth2 stays available via 'mailman auth login <alias>' for Workspace/contacts cases.

## [0.5.0] - 2026-07-02

- New 'mailman account profile' command: view/set/clear your From Name and email signature from the terminal (--name, --signature with \n support, --clear-*); account list now shows the From Name; help/examples document it.

## [0.4.5] - 2026-07-02

- Scheduled-send ticker fix: launchd/cron jobs now carry a PATH that includes node's bin dir — without it every tick failed to find npx (launchd/cron don't inherit the shell PATH).

## [0.4.4] - 2026-07-02

- Tight spacing everywhere: doctor restructured under one ◆ checks section, and all remaining error/info/warning messages (usage errors, update failures, OAuth guidance) now render tight tree rows instead of padded clack log output.

## [0.4.3] - 2026-07-02

- Tightened diamond-tree spacing: rows attach directly (no more double-spacing), blank connector only before each section header — matching the reference design.

## [0.4.2] - 2026-07-02

- help, examples, and error messages now render in the same diamond-tree design as every other command (only --version and bare register stay plain, for scripts and copy-paste).

## [0.4.1] - 2026-07-02

- Interactive commands (init, account add, auth login, rotate-key, register -i) now print a clear 'needs a real terminal' message when run without a TTY (AI-tool shells, pipes, CI) instead of crashing with ERR_TTY_INIT_FAILED.

## [0.4.0] - 2026-07-02

- New 'mailman update' self-update command (alias: upgrade); typo suggestions on unknown commands; bare 'mailman' at a terminal now shows help instead of silently starting the stdio server.

## [0.3.3] - 2026-07-02

- New 'mailman help [command]' and 'mailman examples' subcommands — people type these as commands, not flags.

## [0.3.2] - 2026-07-02

- MCP initialize handshake now reports the real package version (was hardcoded 0.1.0).

## [0.3.1] - 2026-07-02

- Friendly 'requires Node >= 18' message on old Node instead of a cryptic ERR_UNSUPPORTED_ESM_URL_SCHEME crash (surfaced by a real 'mailman init' run on an old shell node).

## [0.3.0] - 2026-07-02

- Primary CLI command is now 'mailman' (e.g. 'mailman init', 'mailman register --tools claude,cursor'); 'mcp-mailman' kept as an alias for hosts where GNU Mailman owns /usr/bin/mailman. All help/usage/docs updated.

## [0.2.0] - 2026-07-02

- init now auto-writes MCP config into your AI tools (Claude Code, Cursor, Gemini CLI, Windsurf, Codex) with a multi-select + scope prompt, ContextBrain-style; new register --tools/-i for scripted or interactive re-registration.

## [0.1.2] - 2026-07-02

- Fix all package references to @indianic/mailman (the old mcp-mailman name 404s) — critically the scheduled-send ticker's npx command, which would have silently failed every scheduled send. README setup overhauled with quick-start wizard, private-registry install, and per-editor MCP config sections.

## [0.1.1] - 2026-07-02

- Add author field (kalpesh); harden release script by removing a risky install-based verification step that had corrupted package.json with a circular self-dependency.

## [0.1.0] - 2026-07-02

- Renamed to @indianic/mailman for the IndiaNIC private registry — scoped so ~/.npmrc's routing resolves it automatically without forcing the private registry across mailman's public dependencies.

## [0.1.0] - 2026-07-02

- First IndiaNIC private-registry release — Gmail send/read MCP server (App Password + OAuth2), draft/confirm safety, scheduled sends, per-account signatures/display names, and a unified terminal-tree CLI output convention.
