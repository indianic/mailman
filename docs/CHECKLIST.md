# mailman — Implementation Checklist

Phased build order. Each phase should be usable/testable on its own before
moving to the next. See [docs/PLAN.md](PLAN.md) for the full rationale behind
each item and [docs/TOOLS.md](TOOLS.md) for exact tool signatures.

## Phase 0 — Project setup

- [x] Create project directory + git repo
- [x] `package.json`, `tsconfig.json`, `.gitignore`
- [ ] Install dependencies (`@modelcontextprotocol/sdk`, `nodemailer`, `zod`, `googleapis`, `imapflow`, `keytar`, `open`, `@clack/prompts`)
- [ ] `src/config/paths.ts` — resolve global config dir per OS (macOS/Linux/Windows), honoring `MCP_MAILMAN_CONFIG_DIR` override
- [ ] `src/index.ts` — minimal MCP server skeleton over stdio transport, registers zero tools yet, confirms `claude mcp add` wiring works end-to-end
- [ ] `src/status.ts` — `collectStatus()` skeleton returning empty/placeholder sections (accounts, security, activity) — filled in as later phases add real data
- [ ] `mcp-mailman status` CLI command — renders `collectStatus()` via `@clack/prompts` tree output

## Phase 1 — Core send path (App Password only) + draft/confirm flow

- [ ] `src/config/schema.ts` — zod schemas for `accounts.json`, `settings.json`
- [ ] `src/config/store.ts` — read/write with atomic writes, create-if-missing
- [ ] `src/auth/app-password.ts` — `nodemailer` Gmail SMTP transport
- [ ] In-memory draft store with TTL (default 10 min, from `settings.draftTtlMinutes`)
- [ ] `draft_email` tool — builds preview, stores draft, returns `draftId`
- [ ] `confirm_send` tool — validates draft not expired/already-sent, dispatches via nodemailer
- [ ] `cancel_draft` tool
- [ ] Manual end-to-end test: configure one App Password account, draft, confirm, verify real delivery

## Phase 2 — Attachment resolution

- [ ] `src/tools/resolve-attachments.ts` — explicit paths, glob, directory (non-recursive default, `recursive` opt-in)
- [ ] Per-file + total size cap enforcement (~25 MB Gmail limit), reported as an error not silently truncated
- [ ] MIME-type inference for attachment headers
- [ ] Missing/unreadable path → clear error back to caller
- [ ] `preview_attachments` tool
- [ ] Wire attachment resolution into `draft_email`

## Phase 3 — Security hardening

- [ ] `src/config/keychain.ts` — generate a random 256-bit master key on first `configure_account`, store via `keytar.setPassword('mcp-mailman', 'master-key', ...)`
- [ ] Encrypt stored secrets (app passwords, OAuth client secret + refresh token) in `accounts.json` with the keytar-backed master key (AES-256-GCM) — file on disk holds only ciphertext + IV/auth tag, never the key
- [ ] `keytar.getPassword` failure/missing-key path → clear "no master key found for this machine, run `configure_account` again" error, never a plaintext fallback
- [ ] Headless-Linux-no-keyring-daemon path → fail setup with clear instructions, not a silent plaintext fallback
- [ ] Manual test: copy `accounts.json` alone to a second machine (or a fresh keychain/user), confirm decryption fails cleanly there
- [ ] `src/audit.ts` — append-only `activity.log` (JSONL): timestamp, tool name, account alias, non-sensitive metadata only (counts, not content); size-capped/rotated
- [ ] Wire audit logging into every tool call
- [ ] `src/logging.ts` — redact credentials and email bodies from logs by default
- [ ] Confirm size caps are enforced pre-send, not just at preview time
- [ ] Confirm drafts never get written to disk (in-memory only, verified by killing the process mid-draft and checking `confirm_send` fails cleanly)

## Phase 4 — OAuth2 auth path

- [ ] Google Cloud OAuth client setup doc (in README) — creating the client ID/secret
- [ ] `mcp-mailman auth login <alias>` CLI command — opens browser via `open`, runs local redirect listener, exchanges code for refresh token
- [ ] `src/auth/oauth2.ts` — access-token refresh + XOAUTH2 nodemailer transport
- [ ] `configure_account` supports `method: "oauth2"`
- [ ] Manual end-to-end test: configure one OAuth2 account, draft, confirm, verify real delivery

## Phase 5 — Multi-account + settings

- [ ] `list_accounts` tool
- [ ] `remove_account` tool (clears `defaultAccount` in settings if it was the default)
- [ ] `get_settings` / `update_settings` tools
- [ ] Account resolution order in `draft_email`: explicit → single-account → default → ambiguous-error
- [ ] First-account-auto-default behavior; `configure_account({ setDefault: true })` for subsequent accounts
- [ ] Manual test: configure 2 accounts, confirm ambiguous-error without a default, set default, confirm it's used

## Phase 6 — Recipient suggestions

- [ ] `contacts.json` schema + store
- [ ] Auto-upsert recipients (with `useCount`/`lastUsedAt`) on every successful `confirm_send`
- [ ] `add_contact` / `remove_contact` tools
- [ ] `suggest_recipients` tool — local recents ranking
- [ ] Google People API integration for `oauth2` accounts (`contacts.readonly` scope), merged + labeled by source in `suggest_recipients` results
- [ ] `list_contacts` tool — full address book, no query ("get my contacts")
- [ ] Manual test: fuzzy name query returns ranked, source-labeled suggestions for both an App Password and an OAuth2 account

## Phase 7 — Reading, listing, searching mail

- [ ] Add `gmail.readonly` scope to the OAuth2 consent request (alongside `gmail.send`, `contacts.readonly`); update `auth login` prompt/README to call out that this grants full-mailbox read access, not just send
- [ ] `src/mail/gmail-api-client.ts` — list/search/read via Gmail API for `oauth2` accounts, native query syntax passed through on search
- [ ] `src/mail/imap-client.ts` — list/search/read via IMAP for `app-password` accounts (same app password authorizes IMAP on Gmail); simplified search subset (subject/from/date-range)
- [ ] `src/mail/normalize.ts` — common email shape both backends map into
- [ ] `list_recent_emails` tool (`folder` defaults `"inbox"`, `limit` defaults `10`)
- [ ] `search_emails` tool (`folder: "inbox" | "sent" | "all"`)
- [ ] `read_email` tool (headers + body + attachment metadata only, no attachment download)
- [ ] `list_accounts` output includes `canRead: true/false` per account so it's visible which accounts have read access granted
- [ ] Manual test: "last 10 emails," "last 10 sent," a search query, and reading one specific email — for both an App Password and an OAuth2 account

## Phase 8 — Polish & publish

- [ ] `get_status` MCP tool — same `collectStatus()` data as the CLI command, returned as JSON for Claude
- [ ] Fill in real data in `collectStatus()`: accounts (alias/method/default/canRead), security (master key found, encrypted), activity counts from `activity.log`
- [ ] Finalize `mcp-mailman status` tree rendering (accounts / security / mcp registration / activity sections)
- [ ] Finalize README (install, both auth setups, usage examples, config paths table, read-access scope disclosure)
- [ ] Cross-OS smoke test: macOS, Linux, Windows — config dir resolution, `claude mcp add` registration, one real send + one real read on each
- [ ] `npm publish` as `mcp-mailman`
- [ ] Document `claude mcp add mailman -- npx -y mcp-mailman` as the standard install step
