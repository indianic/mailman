# mailman — Architecture Plan

`mcp-mailman` is a standalone, publishable npm package (not part of any other
repo) that runs an MCP server for sending and reading email. It is registered
globally with any Claude CLI installation and works on macOS, Linux, and
Windows — mostly pure Node.js (`nodemailer`, `imapflow`, `googleapis`), with
one native dependency (`keytar`) taken on deliberately for machine-bound
credential security (see Security model below).

## Goals

- Send email (Gmail today; SMTP-generic design leaves room for other
  providers later) from a natural-language request in any Claude CLI session.
- Attach one or more documents by explicit path, glob, or "all files in a
  folder" — resolved by the calling Claude session from conversation context,
  not hardcoded to one mode.
- Never send silently: every send is a **draft → preview → explicit
  confirmation → send** flow.
- Support multiple Gmail accounts, each with its own auth method, with a
  configurable default so the common case needs zero extra arguments.
- Suggest recipients as an address is typed/described, pulling from a local
  address book and, for OAuth2 accounts, the account's Google Contacts.
- Read, list, and search the inbox/sent mail too — "last 10 emails," "search
  for X," "read this one" — not just send.
- Support scheduling a send for a future time ("send this tomorrow at 9am"),
  reliably surviving the MCP server process not being alive at that moment —
  not just an in-memory timer that dies with the session.
- Store all state in one **global, per-OS-user** location — never
  project-relative — so it's configured once per machine and available from
  every project/terminal/Claude session on that machine.

## Package layout

```
mailman/
├── package.json          bin: "mcp-mailman", published to npm
├── src/
│   ├── index.ts            MCP server entrypoint (stdio transport)
│   ├── tools/               one file per MCP tool — see docs/SKILLS.md
│   ├── cli/                 one file per terminal command — see docs/CLI.md
│   │   ├── init.ts, account.ts, contacts.ts, settings.ts
│   │   ├── auth-login.ts, rotate-key.ts
│   │   ├── register.ts, doctor.ts, reset.ts
│   │   ├── send-scheduled.ts   the ticker's dispatch target — CLI-only
│   │   └── status.ts        renders collectStatus() via @clack/prompts
│   ├── auth/
│   │   ├── app-password.ts    SMTP login (nodemailer + Gmail SMTP)
│   │   └── oauth2.ts          Google OAuth2 (XOAUTH2), refresh-token flow
│   ├── mail/
│   │   ├── provider.ts           the MailProvider interface (see below)
│   │   ├── gmail-api-client.ts   GmailApiProvider — list/search/read via Gmail API (oauth2 accounts)
│   │   ├── imap-client.ts        ImapSmtpProvider — list/search/read via IMAP (app-password accounts)
│   │   └── normalize.ts          maps both backends into one common email shape
│   ├── scheduler/
│   │   ├── store.ts             read/write scheduled.json (encrypted, same master key as accounts.json)
│   │   ├── ticker-install.ts    per-OS idempotent registration (launchd/cron/Task Scheduler)
│   │   └── dispatch.ts          fires due sends via MailProvider.send(), retry/fail bookkeeping
│   ├── config/
│   │   ├── paths.ts           cross-platform global config dir resolution
│   │   ├── store.ts           read/write accounts.json, contacts.json, settings.json
│   │   ├── schema.ts          zod schemas for all three files
│   │   └── keychain.ts        master-key generation/retrieval via keytar (see Security model)
│   ├── status.ts             collectStatus() — shared data source for `status` CLI + get_status tool
│   ├── response.ts           toolResponse()/toolError() JSON-in-text helpers (see Output format below)
│   ├── audit.ts              append-only activity.log writer (see Security model)
│   └── logging.ts           redacts secrets; never logs credentials/bodies by default
├── bin/mcp-mailman.js      thin shim — dispatches into dist/index.js (MCP) or dist/cli/* by argv
└── README.md
```

## Output format — JSON text responses, host-agnostic

Mailman is meant to work from any MCP host (Claude Code, Cursor, Windsurf,
whatever else speaks MCP) — so no tool response ever bakes in formatting
meant for one specific host's UI. Every tool result is a JSON payload
serialized into the MCP `content` array's `text` block, matching the
convention already used by this monorepo's other MCP server
(`mcp-server/src/types.ts`'s `textResponse()`/`errorResponse()`):

```ts
// src/response.ts
function toolResponse(value: unknown): ToolResponse {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}
function toolError(code: string, message: string): ToolResponse {
  return { content: [{ type: 'text', text: JSON.stringify({ code, message }) }], isError: true };
}
```

- **Success**: the `Output` shape documented per-tool in docs/SKILLS.md,
  JSON-stringified.
- **Failure**: `{ code, message }` (see the error-code table under
  Concurrency, resilience & idempotency below) — a structured upgrade over
  the sibling project's plain-string `errorResponse`, since mailman's
  control flow (ambiguous account, rate limiting, expired drafts) needs a
  code to branch on, not just prose to pattern-match.
- **Why JSON-in-text over the newer MCP `structuredContent`/`outputSchema`
  fields**: not every MCP host has adopted `structuredContent` yet, but
  every host can render a text block — and since that text is valid JSON,
  any host that *wants* to parse it programmatically still can. This is the
  same choice the sibling `mcp-server` already made; mailman follows it for
  consistency across this developer's MCP projects, not just as an isolated
  decision.
- The one exception is `mcp-mailman status`, the **CLI** command (not an
  MCP tool) — that's the only place a host-specific pretty tree render is
  appropriate, because it's a human looking at a terminal directly, not an
  AI host parsing a tool result. `get_status` (the MCP tool) returns the
  same underlying data as plain JSON, per the CLI status output section
  below.
- Adopting the sibling project's `next_steps` pattern too: select tools
  (`draft_email`, `suggest_recipients` on an ambiguous match) can include a
  `next_steps: string[]` hint array in their JSON payload — a
  belt-and-suspenders nudge ("show this preview and get explicit
  confirmation before calling confirm_send") reinforcing what the tool
  description already says, in case a host's model skims past it.

## Provider abstraction — one interface, two backends today

Every account-scoped operation (send, list, search, read, list-contacts)
goes through one internal interface, not five call sites each branching on
`method`:

```ts
interface MailProvider {
  send(message: OutboundMessage): Promise<{ messageId: string }>
  list(opts: { folder: Folder; limit: number; pageToken?: string }): Promise<Page<EmailSummary>>
  search(opts: { query: string; folder: Folder; limit: number; pageToken?: string }): Promise<Page<EmailSummary>>
  read(id: string): Promise<EmailDetail>
  listContacts(): Promise<Contact[]>
}
```

- `GmailApiProvider` (oauth2 accounts) and `ImapSmtpProvider` (app-password
  accounts) both implement this. Tools call `getProvider(account)` and never
  branch on `method` themselves.
- This is what makes "IMAP search is a simplified subset" a one-line fact
  inside `ImapSmtpProvider`, not something every tool has to special-case.
- Deliberately scoped to Gmail-only backends for now — the interface is
  provider-agnostic so a third backend (plain SMTP+IMAP for a non-Gmail
  address, or Outlook/Graph API later) is a new class implementing
  `MailProvider`, not a rewrite of the tool layer. Not building that third
  backend now — just not closing the door on it structurally.

## Auth: both methods, selectable per account

Each configured account picks its own method — there's no global "the app
uses OAuth2" switch:

```jsonc
// accounts.json entry — no "default" field here; settings.json's
// defaultAccount is the single source of truth (see "Multi-account +
// settings" below), so there's only one place that can ever disagree
// with itself about which account is default.
{
  "alias": "personal-gmail",
  "email": "you@gmail.com",
  "method": "app-password" | "oauth2",
  // app-password: smtp.gmail.com:465, user + 16-char app password
  // oauth2: clientId, clientSecret, refreshToken (from `mcp-mailman auth login`)
  "displayName": "Kalpesh Gamit", // optional — "From Name" shown to recipients
  "signature": "-- Kalpesh"       // optional — appended to every draft from this account
}
```

- **App Password**: `nodemailer.createTransport({ service: 'gmail', auth: { user, pass } })`.
  Fast setup (2-Step Verification + generated app password), no Google Cloud
  project needed.
- **OAuth2**: one-time `mcp-mailman auth login <alias>`, stores a refresh
  token; at send-time it's exchanged for a short-lived access token
  (XOAUTH2). Required if a Workspace admin disables app passwords, and
  needed anyway for Google Contacts access (see Recipient suggestions
  below) and for reading mail via the Gmail API (see Reading/listing/
  searching mail below). Two completion paths, chosen automatically:

  **Loopback redirect only — there is no device-flow fallback.** A local
  HTTP listener opens on an ephemeral port, the default browser opens
  straight to Google's consent screen with that as the redirect target.
  One click on "Allow," Google redirects to `localhost:<port>`, the
  listener captures the code automatically and exchanges it for tokens.
  No manual copy-paste at any point.

  When no local GUI browser is reachable (headless Linux with no
  `DISPLAY`/`WAYLAND_DISPLAY`, an SSH session, a container) or
  `--no-browser` is passed explicitly, mailman skips trying to launch a
  browser and instead prints the consent URL plus an `ssh -L
  <port>:localhost:<port> <host>` command to run *from your local
  machine* — forward the ephemeral port back to wherever mailman is
  running, open the printed URL in your local browser, approve, and the
  same listener captures the redirect through the tunnel exactly as it
  would locally. Same code path either way; headless is just "you're
  opening the browser somewhere else and tunneling the callback back."

  **Device Authorization Grant (RFC 8628) was considered and rejected.**
  Checked against Google's live docs at implementation time (Phase 4) per
  this doc's original instruction not to trust its own assumptions here:
  the device-flow grant only supports a small scope allowlist (OpenID
  Connect's `email`/`openid`/`profile`, `drive.appdata`/`drive.file`,
  YouTube) — Gmail and Contacts scopes are not on it and cannot be
  requested via device flow at all, on any client type. So the
  "print a code, approve from any device" fallback this doc originally
  described is not just a client-type detail that changed — it's
  categorically infeasible for what mailman needs, and isn't built.
  Google's deprecated-in-2022 manual copy-paste-code (OOB) flow was never
  an option either.

Since reading mail is now in scope, the OAuth2 consent screen requests three
scopes, not one: `gmail.send`, `gmail.readonly`, `contacts.readonly`.
`gmail.readonly` is a materially broader grant than send-only (it's read
access to the whole mailbox) — worth being explicit about in the `auth
login` prompt/README rather than bundling it silently into "just send email"
setup. App Password accounts get inbox read access implicitly (the same app
password that authorizes SMTP also authorizes IMAP on that Gmail account),
so there's no separate consent step there — but it's the same capability
being granted either way and should be described as such in the account
list (`list_accounts` output could note `"canRead": true` per account).

## Global config — never project-relative

```
macOS:   ~/Library/Application Support/mcp-mailman/
Linux:   ~/.config/mcp-mailman/
Windows: %APPDATA%\mcp-mailman\
```

- `accounts.json`, `contacts.json`, `settings.json` all live **only** here,
  resolved via `os.homedir()` — never `process.cwd()`. No per-project
  `.mcp-mailman/` lookup, no "walk up from cwd" behavior.
- Registered with `claude mcp add` as a **global** MCP server entry, not a
  project-scoped `.claude/mcp.json`.
- Optional escape hatch: `MCP_MAILMAN_CONFIG_DIR` env var override for users
  who deliberately want to isolate configs (e.g. work vs personal machine
  profiles). Default with no env var set is always the single global path.
- Secrets (app passwords, OAuth client secret + refresh token) are encrypted
  at rest, never stored as plaintext JSON — key management is machine-bound;
  see Security model below.
- Drafts (see below) are **in-memory only**, never written to disk — a
  process restart invalidates any pending draft, which is fine since they're
  short-lived.

## Security model — machine-bound credentials + activity audit

Encryption alone isn't enough: if the *key* travels with the *ciphertext* —
e.g. both live in the same config directory — copying that whole directory
to another machine still lets an attacker decrypt everything. The fix is to
keep the key somewhere that physically doesn't travel with a file copy: the
OS's own credential store.

**Machine binding via `keytar`:**

- On first `configure_account` call ever, generate a random 256-bit master
  key and store it via `keytar.setPassword('mcp-mailman', 'master-key', ...)`.
  This writes into macOS Keychain, Windows Credential Manager (DPAPI-backed),
  or the Linux Secret Service (`libsecret` — gnome-keyring/kwallet), each of
  which is tied to that specific OS user login/machine.
- `accounts.json` secrets are encrypted with this master key (AES-256-GCM).
  The JSON file on disk only ever contains ciphertext + IV/auth tag — the key
  itself never touches disk.
- At runtime, `mailman` fetches the key via `keytar.getPassword(...)`. If
  `accounts.json` is copied to a different machine (no matching keychain
  entry there), that call returns `null` and decryption fails outright —
  `mailman` reports "no master key found for this machine, run
  `configure_account` again," never falls back to a weaker/plaintext mode.
- No silent degradation: if the OS credential store is unavailable (e.g. a
  headless Linux box with no keyring daemon running), setup fails with clear
  instructions rather than silently storing the key in plaintext "just to
  make it work." This is a documented limitation for headless Linux, not a
  bug to route around.
- Net effect: `accounts.json` + `contacts.json` + `settings.json` being
  exfiltrated (backup leak, synced cloud folder, stolen drive) is, on its
  own, useless to an attacker — the wrapping key was never in that directory
  and doesn't exist anywhere the file did.

**Activity audit log:**

- Every tool call (`draft_email`, `confirm_send`, `list_recent_emails`,
  `search_emails`, `read_email`, `suggest_recipients`, etc.) appends one line
  to `config-dir/activity.log` (JSONL): timestamp, tool name, account alias,
  and non-sensitive metadata only — recipient *count*, not the recipient
  list; attachment *count*, not filenames; never a body, credential, or
  token.
- Size-capped/rotated (e.g. keep the most recent N entries) so it can't grow
  unbounded.
- Purpose is forensic, not preventive: if you ever need to answer "what did
  this thing actually do, and when," the answer is a local, append-only
  file — not scattered across whatever the OS's default log verbosity
  happened to capture.

## Data integrity & storage (DBA review)

There's no database here — `accounts.json`, `contacts.json`, `settings.json`,
and `scheduled.json` are flat files, and they get the same rigor a DBA would
demand of any small persistent store:

- **Atomic writes, always.** Every write is: serialize → write to a temp
  file in the same directory → `fs.rename()` over the real path. A crash or
  power loss mid-write leaves the *old* file intact, never a half-written or
  corrupt JSON blob. Never write in place.
- **Single in-process writer.** All files go through one write queue
  (`config/store.ts`, shared by `scheduler/store.ts`). Even with only one
  OS process, tool calls can race each other — an `add_contact` auto-upsert
  from `confirm_send` overlapping a manual `configure_account` call, or the
  ticker's `send-scheduled` marking an entry `sent` while `schedule_send`
  adds a new one, for instance. Reads/writes to the *same* file are
  serialized through that queue; unrelated files aren't blocked by each
  other.
- **`schemaVersion` field in every file, checked on load.** A future
  mailman release that changes a file's shape runs a migration keyed on
  that version instead of crashing on an old config or silently misreading
  a field. No migrations exist yet (v1 for all four files), but the field
  ships from day one so it's never a breaking retrofit.
- **Corruption recovery.** Each write to any of the three files first copies
  the current file to `<file>.bak` before the atomic rename. If a load ever
  hits a JSON parse error, fall back to `.bak` and log a warning rather than
  crashing the whole server over one bad file.
- **Growth is a non-issue at this scale.** `contacts.json` grows by one
  entry per unique recipient ever emailed — hundreds to low thousands of
  rows for real usage, and `suggest_recipients`'s linear scan over that is
  sub-millisecond. No indexing, no pruning policy needed; that's a stated
  sizing judgment, not an oversight. `activity.log` is the one file with
  real unbounded-growth risk (one line per tool call) — capped at 5,000
  lines / 5 MB, whichever comes first, rotating the current file to
  `activity.log.1` and starting fresh (single rotation, not a logrotate-style
  chain).
- **Key rotation is CLI-only, never an MCP tool.** `mcp-mailman auth
  rotate-key` generates a new master key, decrypts every account's secrets
  with the old key, re-encrypts with the new one, stores the new key via
  keytar, and atomically swaps `accounts.json`. Deliberately *not* exposed
  as an MCP tool — a high-privilege, hard-to-reverse operation like
  re-keying every stored credential shouldn't be triggerable by anything an
  LLM session could be talked into calling; it requires a human at the
  actual terminal.

## Attachment resolution — flexible by design

The MCP tool stays "dumb"; the calling Claude session decides intent from
natural language and passes one of:

- **Explicit paths**: `attachments: ["/path/a.pdf", "/path/b.docx"]`
- **Glob pattern**: `attachments: ["./output/*.pdf"]`
- **Directory (send-all)**: `attachments: ["./output/"]` → expands to every
  file inside (non-recursive by default, `recursive: true` opt-in)

Resolution enforces:
- Per-file and total size caps (Gmail SMTP hard limit ~25 MB per message —
  reported back as an error, never silently truncated)
- MIME-type inference for attachment headers
- Existence/readability check with a clear error back to Claude if a path is
  missing, so it can re-resolve or ask the user

`mailman` has no memory of "what we were just working on" — turning a phrase
like "those docs" into real paths is Claude's responsibility, done from
conversation context (recently written files, artifacts, etc.) before it
ever calls a tool.

## Send flow: draft → preview → confirm → send

```
User: "mailman, send those docs to kalpesh.gamit@indianic.com"
  → Claude resolves "those docs" to real paths from context
  → Claude auto-composes subject + body (since the user didn't dictate exact
    wording) — this is Claude's language generation; mailman has no LLM inside it
  → Claude calls draft_email({to, subject, body, attachments})
  → mailman resolves attachments, picks the account (see resolution order
    below), returns a full preview + short-lived draftId. Nothing is sent yet.
  → Claude shows the preview and asks for confirmation
  → User confirms
  → Claude calls confirm_send({draftId}) → actual SMTP/OAuth2 dispatch happens
```

`draft_email`'s `subject`/`body` are optional as a safety net — if ever
omitted, `mailman` fills in a minimal templated default (e.g. `Subject: Files
attached`, body listing attachment filenames) rather than erroring out. The
expected/primary path is still Claude always supplying real composed text.

Drafts expire after a configurable TTL (default 10 minutes — see Settings)
so a stale confirmation can't fire off an old, possibly-outdated draft, and
can't double-send if confirmed twice.

## Scheduled sends — persistence beyond the MCP server's lifetime

"Send this later" can't be built as an in-memory timer on the draft store,
because the MCP server is a stdio process the Claude CLI owns and can kill
at any time (see Process lifecycle below) — closing that Claude Code
session hours before the scheduled moment would silently lose the send.
Scheduling needs two things a live process can't guarantee on its own:
durable storage, and a trigger that fires independently of whether mailman
happens to be running at that instant.

**Flow:**

```
User: "mailman, send this tomorrow at 9am instead of now"
  → Claude resolves "tomorrow at 9am" to an absolute instant (mailman does
    no natural-language date parsing itself — same "Claude resolves
    intent, mailman stays dumb" split as attachment paths)
  → Claude calls draft_email(...) as normal, gets a draftId + preview
  → Claude shows the preview *and* the resolved send time, asks to confirm
  → User confirms
  → Claude calls schedule_send({ draftId, sendAt }) instead of confirm_send
  → mailman persists the drafted email to scheduled.json, installs the
    recurring OS ticker job if this machine doesn't have one yet, returns
    a scheduledId. Nothing is sent yet — same non-destructive preview-first
    principle as an immediate send, just with a future execution time
    instead of "now."
```

**Persisted store.** `scheduled.json` lives in the same global config
directory as `accounts.json`, and is encrypted at rest with the same
keytar-backed master key (see Security model) — a scheduled email's
recipient/subject/body sitting in plaintext on disk until it fires would be
a real exposure, so it gets the same treatment as credentials rather than a
separate new mechanism. Each entry: `{ scheduledId, account, to, cc, bcc,
subject, body, bodyType, attachments, sendAt, status: "pending" | "sent" |
"failed", attempts }`.

**The ticker.** One recurring OS-level job per machine, installed once
(idempotently) the first time `schedule_send` is ever called, polling every
1–5 minutes:

| OS | Mechanism |
|---|---|
| macOS | `launchd` agent (`~/Library/LaunchAgents/`), preferred over cron |
| Linux | `crontab` entry |
| Windows | Task Scheduler task |

Each tick runs `mcp-mailman send-scheduled --due` — a **CLI-only** command,
never an MCP tool (it's an OS-triggered background mechanism, not a
conversational action; same exclusion logic as `auth rotate-key`). It reads
`scheduled.json`, dispatches everything with `sendAt <= now` and
`status: "pending"` through the exact same `MailProvider.send()` path
`confirm_send` uses, then marks each `sent` or `failed`.

- **Attachments are re-resolved fresh at fire time**, not snapshotted when
  scheduled — consistent with attachment resolution always being a live
  path lookup elsewhere in this doc. If a file's moved or deleted between
  scheduling and firing, the send fails with `ATTACHMENT_NOT_FOUND` rather
  than silently going out without it.
- **Retries, not silent loss.** A failed dispatch (network blip, expired
  OAuth2 token, missing attachment) retries on the next tick, up to a cap
  (5 attempts); after that it's marked `failed` and surfaces in
  `list_scheduled`/`status` rather than disappearing.
- **Honest limit, not a bug to hide**: if the machine is fully powered off
  (not just asleep) at the scheduled instant, the send fires on the next
  tick after it wakes/boots — cron/launchd/Task Scheduler can't run on a
  powered-off machine. It's late, not lost, and that's worth being upfront
  about rather than implying second-precision delivery guarantees a
  personal-machine scheduler can't actually make.
- **`doctor` reports ticker health** (installed? last observed run?) as a
  recovery path if something's wrong with the OS-level registration,
  rather than that being a total black box.

**Scope, deliberately**: one-time scheduled sends only. Recurring/repeating
sends ("every Monday, send X") are a deliberate non-goal for now, not an
oversight — a materially different feature (needs its own cadence model,
skip/pause semantics, etc.) that can be a future decision if it comes up.

**MCP-tool-only, like sending itself.** `schedule_send`/`cancel_scheduled`
are MCP tools, not CLI commands — scheduling a send is still "sending
mail," just deferred, so it stays behind Claude's conversational
confirm-first flow rather than becoming a bare CLI escape hatch (same
reasoning docs/CLI.md already gives for why `draft_email`/`confirm_send`
aren't CLI commands). `list_scheduled` is read-only and safe either way, so
it gets both an MCP tool and a CLI mirror (`mcp-mailman scheduled list`).

## Concurrency, resilience & idempotency

**Draft store concurrency.** Drafts live in an in-memory `Map<draftId,
Draft>` keyed by `crypto.randomUUID()`. Concurrent `draft_email` calls never
collide on an ID; no further locking is needed since Node's event loop
serializes the synchronous parts of each call.

**`confirm_send` is idempotent.** Calling it twice with the same `draftId`
after a successful send returns the *original* `{ sent: true, messageId,
sentAt }` again rather than attempting to resend. This matters because LLM
agents occasionally retry a tool call when a prior result was ambiguous
(timeout, dropped connection) — a naive implementation would double-send.
The draft's state machine is `pending → sent | expired | cancelled`, and
only the `pending → sent` transition ever dispatches mail.

**Structured error codes, not just error strings.** Every tool that can
fail returns a machine-readable `code` alongside a human-readable `message`,
so Claude can branch reliably instead of pattern-matching prose:

| Code | Where | Meaning |
|---|---|---|
| `ACCOUNT_NOT_FOUND` | any account-scoped tool | `account` param doesn't match a configured alias |
| `AMBIGUOUS_ACCOUNT` | `draft_email` | multiple accounts, no default, no explicit `account` |
| `DRAFT_EXPIRED` | `confirm_send` | TTL elapsed since `draft_email` |
| `DRAFT_ALREADY_SENT` | `confirm_send` | idempotent replay, see above — not a failure Claude needs to surface as an error |
| `ATTACHMENT_TOO_LARGE` | `draft_email`, `preview_attachments` | total size exceeds the ~25 MB cap |
| `ATTACHMENT_NOT_FOUND` | `draft_email`, `preview_attachments` | a given path doesn't resolve to a readable file |
| `AUTH_EXPIRED` | any oauth2-backed tool | refresh-token exchange failed; needs `auth login` re-run |
| `RATE_LIMITED` | Gmail API / IMAP calls | provider backpressure; includes a `retryAfterMs` hint |
| `NO_MASTER_KEY` | any account-scoped tool | keytar has no key for this machine (see Data integrity & storage) |
| `SCHEDULE_NOT_FOUND` | `cancel_scheduled` | `scheduledId` doesn't exist or already fired |

**Provider-level retries.** Gmail API calls retry once on `401` (after an
OAuth2 token refresh) and up to twice more on `429`/`5xx` with exponential
backoff (roughly 500ms/1500ms), then surface `RATE_LIMITED`/`AUTH_EXPIRED`
rather than retrying indefinitely. IMAP connections reconnect once on an
unexpected socket close before surfacing an error — a transient Wi-Fi drop
shouldn't fail a `list_recent_emails` call outright.

**Pagination on read tools.** `list_recent_emails`/`search_emails` cap
`limit` at 50 and return a `nextPageToken`; `snippet` is capped at ~200
characters. `read_email`'s `bodyText`/`bodyHtml` are capped (e.g. 20,000
characters) with a `truncated: true` flag on overflow — a single long email
body or an uncapped message list can otherwise consume a large slice of
Claude's context window for one tool call.

**Destructive-tool confirmation.** `remove_account` requires a
`confirmRemoval: true` flag when removing the *last remaining* account or
the current default — same philosophy as the draft/confirm step for
sending: don't let one ambiguous instruction silently leave zero configured
accounts.

**Process lifecycle.** The MCP server is a long-lived stdio process the
Claude CLI owns and can terminate at any time. On `SIGTERM`/`SIGINT`: flush
any pending `activity.log` write, close an open IMAP session if one is
mid-call, then exit — never attempt to "finish" an in-flight send after a
shutdown signal; better to fail the call cleanly and let Claude retry.

## Multi-account + settings

```
config-dir/
├── accounts.json   [{alias, email, method, credentials(encrypted), ...}, ...]
├── contacts.json    {email, name?, source: "manual"|"recents", useCount, lastUsedAt}
└── settings.json    { defaultAccount: "alias", draftTtlMinutes: 10, alwaysConfirm: true, defaultBodyType: "text" }
```

**Account resolution order** in `draft_email`:

1. Explicit `account` param passed → use it (error if alias doesn't exist).
2. No `account` param, only **one** account configured → use it automatically.
3. No `account` param, **multiple** accounts, `settings.defaultAccount` set → use the default.
4. No `account` param, multiple accounts, **no default set** → return an
   "ambiguous account" error listing all aliases instead of guessing — Claude
   calls `list_accounts`, asks the user, and retries (or sets a default).

The first account ever added is auto-set as default. Adding a 2nd/3rd account
leaves the existing default untouched unless `configure_account` is called
with `setDefault: true`.

`alwaysConfirm` defaults to `true` and is the intended default long-term —
mail is a one-way, externally-visible action, so skipping confirmation isn't
planned even for "trusted" low-risk cases unless a future request explicitly
asks for an opt-out.

## Recipient suggestions — sourced per auth method

`suggest_recipients({query, account?})` merges two sources, ranked and
de-duplicated:

1. **Local address book / recents** (`contacts.json`) — always available.
   Auto-populated: every successful `confirm_send` upserts its recipients
   with a usage count + last-used timestamp, so frequent/recent contacts rank
   first. `add_contact` seeds it manually.
2. **Google Contacts (People API)** — only for accounts using **OAuth2**,
   since that's the one already holding a Google token. Requires the
   `contacts.readonly` (and optionally `contacts.other.readonly`) scope
   during `auth login`. Results are labeled by source ("From Google
   Contacts" vs "Recently emailed") so it's clear which matched.

**App Password** accounts have no Google API access (SMTP login grants no
OAuth scopes), so suggestions fall back to the local address book only — it
builds up from usage rather than pulling the full Google contact list from
day one.

## Reading, listing, and searching mail

Two backends, chosen per account by its auth method — same split as sending:

- **OAuth2 accounts** → **Gmail API** (`googleapis` gmail v1). Preferred
  path: native search query syntax (`from:`, `subject:`, `after:`, `has:attachment`,
  etc. — passed through as-is), thread grouping, and no separate protocol to
  manage beyond the existing OAuth2 token refresh already built for sending.
- **App Password accounts** → **IMAP** (`imapflow` or equivalent). Gmail
  exposes IMAP under the same app password used for SMTP. Search is a
  simplified subset (subject/from/date-range) since IMAP's `SEARCH` command
  is less expressive than Gmail's query syntax — this is a real capability
  gap between the two auth methods worth surfacing in the README, not
  papering over.

Both backends normalize into one common shape (`src/mail/normalize.ts`) so
the tools themselves (`list_recent_emails`, `search_emails`, `read_email`)
don't need to know which backend served a given account.

- **Folder targeting**: `folder?: "inbox" | "sent" | "all"` param, default
  `"inbox"`. "Last 10 emails" → inbox; "last 10 sent" → `folder: "sent"`.
- **`read_email` scope**: returns headers, body (text/html), and attachment
  *metadata* (name/size/type) — it does not download attachment bytes. If
  "save this attachment locally" turns out to be a real need later, that's a
  distinct future tool (`download_attachment`), not bundled into `read_email`.
- **No caching/sync layer**: every call hits the live IMAP/Gmail API
  connection. No local mail database, no background sync — keeps the
  server stateless and avoids a second copy of mail content living on disk
  alongside the encrypted credential store.

## CLI status output

One human-facing diagnostic command, `mcp-mailman status`, rendered as a
`@clack/prompts`-style tree (the ◆/◇/│/└ diamond format) rather than a wall
of plain text — useful for confirming setup worked without digging through
`accounts.json` by hand:

```
┌  mailman — status
│
◆  accounts
│  ◇ personal-gmail   app-password   default   read: yes
│  ◇ work-gmail       oauth2                    read: yes
│
◆  security
│  ◇ master key        found (macOS Keychain)
│  ◇ accounts.json     encrypted (AES-256-GCM)
│
◆  mcp registration
│  ◇ claude cli         registered (global)
│
◆  activity (last 24h)
│  sent: 3   read: 12   searched: 5
│
└  status
```

Implementation note: the CLI command is a thin renderer over a single
`collectStatus()` function in `src/status.ts` — the same function backs a
`get_status` MCP tool (see docs/SKILLS.md) that returns the identical data as
plain JSON for Claude to read/summarize. One data source, two presentations:
a pretty tree for a human running it directly in a terminal, structured JSON
for Claude. Depends on `@clack/prompts` (CLI-only dependency, not loaded by
the MCP server process itself).

`status` is one of a full set of terminal-only commands — setup, account
administration, diagnostics — that never go through the MCP protocol at
all. See [docs/CLI.md](CLI.md) for the complete list and why each one is
CLI-only rather than an LLM-callable tool.

## Testing & CI strategy

- **Unit tests** (no network, no real accounts): attachment resolution
  (paths/glob/dir/size-caps), account resolution order, the draft TTL
  expiry and `pending → sent | expired | cancelled` state machine, contacts
  merge/ranking logic, config atomic-write + `.bak` recovery.
- **Integration tests against fakes, not real Gmail**: `nodemailer`'s
  built-in JSON transport (or `nodemailer-mock`) stands in for SMTP; a local
  test IMAP server (e.g. Dockerized Dovecot) or a mocked `imapflow` client
  stands in for IMAP; Gmail API calls go through a mocked `googleapis`
  client. None of this hits a real Google account.
- **CI (GitHub Actions)**: lint + typecheck + the unit/integration tests
  above run on every PR. The real-Gmail end-to-end tests already called out
  per-phase in docs/CHECKLIST.md (actual delivery, actual OAuth2 flow) stay
  manual/local-only — they need real credentials that have no business
  living in CI secrets for a personal-use tool.
- **Cross-OS verification** stays manual too (Phase 8 in the checklist): CI
  can't easily exercise macOS Keychain / Windows Credential Manager / Linux
  Secret Service from a single runner image the way a real machine can.

## Final naming

Package: **`mcp-mailman`** (checked against the npm registry — available).
Rejected: `mcp-gmail`, `mailbridge-mcp` (both taken); `mcp-mailer` and
`mcp-send-mail` were also available but `mailman` was preferred for being
more memorable/brandable and fitting the draft → confirm → deliver framing.

## Build phases

See [docs/CHECKLIST.md](docs/CHECKLIST.md) for the actionable, checkbox
version of this list.

1. Core send path (App Password only) + draft/confirm flow
2. Attachment resolution (glob/dir expansion, size/type validation)
3. Security hardening (encrypt stored secrets, redact logs, enforce size caps)
4. OAuth2 auth path (Google Cloud client setup, `auth login`, XOAUTH2 transport)
5. Multi-account + settings (list/configure/remove account, default resolution, get/update settings)
6. Recipient suggestions (local contacts store, Google People API for OAuth2 accounts)
7. Reading/listing/searching mail (Gmail API for OAuth2 accounts, IMAP for App Password accounts)
8. Scheduled sends (`scheduled.json`, per-OS ticker install, `schedule_send`/`list_scheduled`/`cancel_scheduled`, `send-scheduled` CLI dispatch)
9. Polish & publish (README finalized, npm publish, `claude mcp add` docs, cross-OS testing)
