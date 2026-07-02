# mailman — Implementation Checklist

Phased build order. Each phase should be usable/testable on its own before
moving to the next. See [docs/PLAN.md](PLAN.md) for the full rationale behind
each item and [docs/SKILLS.md](SKILLS.md) for exact tool signatures.

## Phase 0 — Project setup

- [x] Create project directory + git repo
- [x] `package.json`, `tsconfig.json`, `.gitignore`
- [x] Install dependencies (`@modelcontextprotocol/sdk`, `nodemailer`, `zod`, `googleapis`, `imapflow`, `keytar`, `open`, `@clack/prompts`)
- [x] `src/config/paths.ts` — resolve global config dir per OS (macOS/Linux/Windows), honoring `MCP_MAILMAN_CONFIG_DIR` override
- [x] `src/index.ts` — minimal MCP server skeleton over stdio transport, registers zero tools yet, confirms `claude mcp add` wiring works end-to-end
- [x] `src/status.ts` — `collectStatus()` skeleton returning empty/placeholder sections (accounts, security, activity) — filled in as later phases add real data
- [x] `mcp-mailman status` CLI command — renders `collectStatus()` via `@clack/prompts` tree output
- [x] `src/mail/provider.ts` — define the `MailProvider` interface (`send`/`list`/`search`/`read`/`listContacts`) that `GmailApiProvider`/`ImapSmtpProvider` implement later
- [x] `src/response.ts` — `toolResponse()`/`toolError(code, message)` helpers (JSON-in-text-block, `isError` flag), mirroring `mcp-server/src/types.ts`'s `textResponse()`/`errorResponse()` convention from this monorepo's other MCP server, extended with a `code` field on errors
- [x] GitHub Actions CI skeleton — lint + typecheck on every PR (tests wired in as each phase adds them)
- [x] CLI arg parsing skeleton (`mcp-mailman <command>`), `--version`/`--help`
- [x] `mcp-mailman doctor` skeleton — keyring backend reachability, Node version check (network/SMTP/IMAP reachability checks added once those modules exist)

## Phase 1 — Core send path (App Password only) + draft/confirm flow

- [x] `src/config/schema.ts` — zod schemas for `accounts.json`, `settings.json`, each with a `schemaVersion` field from day one
- [x] `src/config/store.ts` — single in-process write queue per file; atomic write via temp-file + `fs.rename()`; `.bak` copy before every write; fall back to `.bak` + warn on a JSON parse failure at load
- [x] `src/auth/app-password.ts` — `nodemailer` Gmail SMTP transport, implements `MailProvider.send`
- [x] In-memory draft store: `Map<draftId, Draft>` keyed by `crypto.randomUUID()`, state machine `pending → sent | expired | cancelled`, TTL default 10 min from `settings.draftTtlMinutes`
- [x] Structured error codes (`ACCOUNT_NOT_FOUND`, `AMBIGUOUS_ACCOUNT`, `DRAFT_EXPIRED`, `ATTACHMENT_TOO_LARGE`, `ATTACHMENT_NOT_FOUND`, `NO_MASTER_KEY`, ...) — every failable tool returns `{ code, message }`, not just a message string
- [x] `draft_email` tool — builds preview, stores draft, returns `draftId`
- [x] `confirm_send` tool — idempotent: replaying the same `draftId` after a successful send returns the original result instead of resending; only `pending → sent` dispatches via nodemailer
- [x] `cancel_draft` tool
- [x] `SIGTERM`/`SIGINT` handler — flush pending `activity.log` write, close any open IMAP session, exit cleanly (no attempt to finish an in-flight send)
- [x] Unit tests: draft TTL expiry + state machine, atomic-write + `.bak` recovery
- [x] `mcp-mailman init` / `mcp-mailman account add` CLI commands (App Password path: masked password prompt) — thin wrapper over the same account-creation function `configure_account` calls, not duplicated logic
- [x] Manual end-to-end test: configure one App Password account, draft, confirm, verify real delivery — **done**: registered mailman globally, configured a real App Password account, sent a real self-email, confirmed delivery via a real read-back (found and fixed a real IMAP quoted-printable decoding bug in the process — see commit 5bb70a4)

## Phase 2 — Attachment resolution

- [x] `src/tools/resolve-attachments.ts` — explicit paths, glob, directory (non-recursive default, `recursive` opt-in)
- [x] Per-file + total size cap enforcement (~25 MB Gmail limit), reported as an error not silently truncated
- [x] MIME-type inference for attachment headers
- [x] Missing/unreadable path → clear error back to caller
- [x] `preview_attachments` tool
- [x] Wire attachment resolution into `draft_email`
- [x] Unit tests: paths/glob/dir resolution, per-file + total size caps, missing-path error path

## Phase 3 — Security hardening

- [x] `src/config/keychain.ts` — generate a random 256-bit master key on first `configure_account`, store via `keytar.setPassword('mcp-mailman', 'master-key', ...)`
- [x] Encrypt stored secrets (app passwords, OAuth client secret + refresh token) in `accounts.json` with the keytar-backed master key (AES-256-GCM) — file on disk holds only ciphertext + IV/auth tag, never the key
- [x] `keytar.getPassword` failure/missing-key path → clear "no master key found for this machine, run `configure_account` again" error, never a plaintext fallback
- [x] Headless-Linux-no-keyring-daemon path → fail setup with clear instructions, not a silent plaintext fallback
- [x] Manual test: copy `accounts.json` alone to a second machine (or a fresh keychain/user), confirm decryption fails cleanly there — simulated by deleting the keychain entry under an isolated service name; `confirm_send` returned `NO_MASTER_KEY` cleanly
- [x] `src/audit.ts` — append-only `activity.log` (JSONL): timestamp, tool name, account alias, non-sensitive metadata only (counts, not content); size-capped/rotated
- [x] Wire audit logging into every tool call
- [x] `src/logging.ts` — redact credentials and email bodies from logs by default
- [x] Confirm size caps are enforced pre-send, not just at preview time — verified: a 27MB attachment is rejected at `draft_email` with `ATTACHMENT_TOO_LARGE` before any draft exists
- [x] Confirm drafts never get written to disk (in-memory only, verified by killing the process mid-draft and checking `confirm_send` fails cleanly) — verified: `SIGKILL` mid-draft, fresh process, `confirm_send` returns `DRAFT_NOT_FOUND`
- [x] `mcp-mailman auth rotate-key` CLI command (CLI-only, not an MCP tool) — new master key, decrypt-with-old/re-encrypt-with-new for every account, atomic swap of `accounts.json`
- [x] `activity.log` rotation: cap at 5,000 lines / 5 MB, rotate current file to `activity.log.1` on overflow

## Phase 4 — OAuth2 auth path

- [x] Google Cloud OAuth client setup doc (in README) — creating the client ID/secret ("Desktop app" type, for the loopback flow)
- [x] `mcp-mailman auth login <alias>` CLI command, loopback path — local ephemeral-port HTTP listener, opens browser via `open`, captures the redirect code automatically, exchanges for refresh token
- [x] `mcp-mailman auth login <alias>` CLI command, headless fallback — detect no reachable local browser (missing `DISPLAY`/`WAYLAND_DISPLAY` on Linux, or explicit `--no-browser`); print the consent URL plus an `ssh -L` port-forward command instead of launching a browser (same listener, tunneled). **Not** a Device Authorization Grant — checked against Google's live docs at implementation time per this checklist's original instruction, and confirmed the device-flow grant doesn't support Gmail/Contacts scopes on any client type, so it's infeasible here and isn't built.
- [x] Do not implement the deprecated manual copy-paste-code (OOB) flow — Google removed it in 2022
- [x] `src/auth/oauth2.ts` — access-token refresh + XOAUTH2 nodemailer transport, implements `MailProvider.send`
- [x] Retry policy: one retry on `401` after token refresh; up to two more retries on `429`/`5xx` with exponential backoff (~500ms/1500ms), then surface `RATE_LIMITED`/`AUTH_EXPIRED`
- [x] `configure_account` supports `method: "oauth2"`
- [x] `mcp-mailman account add` — wire in the OAuth2 path (same browser flow as `auth login`)
- [ ] Manual end-to-end test: configure one OAuth2 account, draft, confirm, verify real delivery — **pending user action** (needs a real Google Cloud OAuth client; smoke-tested the full pipeline against Google's real token endpoint with fake credentials and got a clean `AUTH_EXPIRED`)

## Phase 5 — Multi-account + settings

- [x] `list_accounts` tool
- [x] `remove_account` tool — requires `confirmRemoval: true` when removing the last remaining account or the current default; otherwise clears `defaultAccount` in settings if it was the default
- [x] `get_settings` / `update_settings` tools
- [x] Account resolution order in `draft_email`: explicit → single-account → default → `AMBIGUOUS_ACCOUNT` error
- [x] First-account-auto-default behavior; `configure_account({ setDefault: true })` for subsequent accounts
- [x] `mcp-mailman account list` / `account remove <alias>` (with `--yes` confirmation gate) / `account set-default <alias>` CLI commands
- [x] `mcp-mailman settings get` / `settings set <key> <value>` CLI commands
- [x] Unit tests: account resolution order (all four branches), `remove_account` confirmation gate
- [x] Manual test: configure 2 accounts, confirm ambiguous-error without a default, set default, confirm it's used

## Phase 6 — Recipient suggestions

- [x] `contacts.json` schema + store
- [x] Auto-upsert recipients (with `useCount`/`lastUsedAt`) on every successful `confirm_send`
- [x] `add_contact` / `remove_contact` tools
- [x] `suggest_recipients` tool — local recents ranking
- [x] Google People API integration for `oauth2` accounts (`contacts.readonly` scope), merged + labeled by source in `suggest_recipients` results
- [x] `mcp-mailman contacts list` / `contacts add <email> [--name]` / `contacts remove <email>` CLI commands
- [x] `list_contacts` tool — full address book, no query ("get my contacts")
- [x] Unit tests: recents/manual/google-contacts merge + ranking logic
- [x] Manual test: fuzzy name query returns ranked, source-labeled suggestions for both an App Password and an OAuth2 account — verified: App Password returns local-only results with an ambiguous-match `next_steps` hint; OAuth2 (fake creds) genuinely reaches Google's People/token endpoint, fails cleanly, and falls back to local-only

## Phase 7 — Reading, listing, searching mail

- [x] Add `gmail.readonly` scope to the OAuth2 consent request (alongside `gmail.send`, `contacts.readonly`); update `auth login` prompt/README to call out that this grants full-mailbox read access, not just send
- [x] `src/mail/gmail-api-client.ts` — `GmailApiProvider implements MailProvider`; list/search/read via Gmail API for `oauth2` accounts, native query syntax passed through on search; retry via `withOAuth2Retry` on 401/429/5xx
- [x] `src/mail/imap-client.ts` — `ImapSmtpProvider implements MailProvider`; list/search/read via IMAP for `app-password` accounts (same app password authorizes IMAP on Gmail); simplified search subset (subject/from/date-range); reconnect-once-on-drop retry
- [x] `src/mail/normalize.ts` — common email shape both backends map into (shared truncation/limit helpers; `MailProvider`'s `EmailSummary`/`EmailDetail` types were already the shared shape from Phase 0)
- [x] `list_recent_emails` tool — `limit` capped at 50, `nextPageToken` on the response, `snippet` capped at ~200 chars
- [x] `search_emails` tool (`folder: "inbox" | "sent" | "all"`) — same `limit`/`nextPageToken` behavior
- [x] `read_email` tool — headers + body + attachment metadata only (no attachment download); `bodyText`/`bodyHtml` capped at ~20,000 chars with a `truncated` flag
- [x] `list_accounts` output includes `canRead: true/false` per account so it's visible which accounts have read access granted (already true since Phase 5, hardcoded `true` per the "expected to always be true today" note)
- [x] Manual test: "last 10 emails," "last 10 sent," a search query, and reading one specific email — for both an App Password and an OAuth2 account — **App Password: done for real** (real account, real send, `list_recent_emails`/`read_email`/`search_emails` all verified against the live inbox — this is what surfaced and got fixed the quoted-printable decoding bug). **OAuth2: still pending user action** — smoke-tested against Google's real endpoints with fake credentials (clean `AUTH_EXPIRED`), but success-path validation needs a real Google Cloud OAuth client

## Phase 8 — Scheduled sends

- [x] `src/config/schema.ts` — zod schema for `scheduled.json`, `schemaVersion` from day one
- [x] `src/scheduler/store.ts` — read/write `scheduled.json` through the same atomic-write + `.bak` + write-queue machinery as `config/store.ts`; encrypted at rest with the keytar-backed master key (only the message `content`; `scheduledId`/`account`/`sendAt`/`status`/`attempts` stay plaintext so the ticker's due-scan doesn't decrypt every entry)
- [x] `src/scheduler/ticker-install.ts` — idempotent per-OS registration: `launchd` agent (macOS), `crontab` entry (Linux), Task Scheduler task (Windows); polls every 1–5 min
- [x] `src/scheduler/dispatch.ts` — resolves attachments fresh (not snapshotted), sends via the same `MailProvider.send()` `confirm_send` uses, retries up to 5 attempts across ticks before marking `failed` (also enforces the size cap pre-send, matching `draft_email` — caught mid-implementation while writing this phase's tests)
- [x] `schedule_send` tool — persists to `scheduled.json`, installs the ticker if not already present, returns `scheduledId`
- [x] `list_scheduled` / `cancel_scheduled` tools; `SCHEDULE_NOT_FOUND` error code
- [x] `mcp-mailman send-scheduled --due` CLI command (ticker's dispatch target — CLI-only, never an MCP tool)
- [x] `mcp-mailman scheduled list` CLI command (read-only mirror of `list_scheduled`)
- [x] `doctor` — report ticker install/last-run health (read-only status check, never installs anything itself)
- [x] `status`/`get_status` — add pending-scheduled count
- [x] Unit tests: due-detection logic, retry/fail-after-cap bookkeeping, attachment re-resolution at fire time (12 new tests, all fast/no-network — a missing-then-oversized attachment proves fresh resolution without ever reaching a real send)
- [ ] Manual test: schedule a send a few minutes out, close the Claude Code session entirely, confirm it still fires via the OS ticker with mailman's MCP process not running — **pending user confirmation**: this requires registering a real `launchd`/`crontab`/Task Scheduler entry on the actual machine, which persists across reboots until removed — asking before doing it rather than installing unilaterally

## Phase 9 — Polish & publish

- [x] `get_status` MCP tool — same `collectStatus()` data as the CLI command, returned as JSON for Claude
- [x] Fill in real data in `collectStatus()`: accounts (alias/method/default/canRead), security (master key found, encrypted), activity counts from `activity.log`, pending-scheduled count
- [x] Finalize `mcp-mailman status` tree rendering (accounts / security / mcp registration / activity / scheduled sections) — already handled all sections generically since Phase 0; just needed real data behind it
- [x] `mcp-mailman register` CLI command — prints the `claude mcp add mailman -- npx -y @indianic/mailman` line (doesn't auto-run it)
- [x] `mcp-mailman doctor` — finalize network/SMTP/IMAP reachability checks alongside the Phase 0 keyring/Node-version checks
- [x] `mcp-mailman reset` CLI command — wipes the config dir + removes the keytar master-key entry; requires explicit `--yes`
- [x] Integration tests against fakes: `nodemailer` JSON transport (SMTP), mocked IMAP-shaped fixtures against the real parsing logic, mocked `fetch` standing in for the Gmail API (mailman uses raw REST via fetch, not the `googleapis` SDK, for Gmail/People calls — same "no real Gmail" testing intent, different mocking boundary) — automatically wired into CI via the existing `npm test` glob
- [x] Finalize README (install, both auth setups, usage examples, config paths table, read-access scope disclosure)
- [ ] Cross-OS smoke test: macOS, Linux, Windows — config dir resolution, `claude mcp add` registration, one real send + one real read on each (manual, not CI — see docs/PLAN.md Testing & CI strategy) — **pending user action**: no Linux/Windows machine available in this session; macOS path exercised throughout via manual verification steps in Phases 1–8
- [ ] `npm publish` as `mcp-mailman` — **pending explicit user confirmation**: a real, public, hard-to-reverse action
- [x] Document `claude mcp add mailman -- npx -y @indianic/mailman` as the standard install step
