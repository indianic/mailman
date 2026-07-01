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
- Store all state in one **global, per-OS-user** location — never
  project-relative — so it's configured once per machine and available from
  every project/terminal/Claude session on that machine.

## Package layout

```
mailman/
├── package.json          bin: "mcp-mailman", published to npm
├── src/
│   ├── index.ts            MCP server entrypoint (stdio transport)
│   ├── tools/               one file per MCP tool — see docs/TOOLS.md
│   ├── auth/
│   │   ├── app-password.ts    SMTP login (nodemailer + Gmail SMTP)
│   │   └── oauth2.ts          Google OAuth2 (XOAUTH2), refresh-token flow
│   ├── mail/
│   │   ├── gmail-api-client.ts   list/search/read via Gmail API (oauth2 accounts)
│   │   ├── imap-client.ts        list/search/read via IMAP (app-password accounts)
│   │   └── normalize.ts          maps both backends into one common email shape
│   ├── config/
│   │   ├── paths.ts           cross-platform global config dir resolution
│   │   ├── store.ts           read/write accounts.json, contacts.json, settings.json
│   │   ├── schema.ts          zod schemas for all three files
│   │   └── keychain.ts        master-key generation/retrieval via keytar (see Security model)
│   ├── audit.ts              append-only activity.log writer (see Security model)
│   └── logging.ts           redacts secrets; never logs credentials/bodies by default
├── bin/mcp-mailman.js      CLI shim
└── README.md
```

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
// accounts.json entry
{
  "alias": "personal-gmail",
  "email": "you@gmail.com",
  "method": "app-password" | "oauth2",
  "default": true
  // app-password: smtp.gmail.com:465, user + 16-char app password
  // oauth2: clientId, clientSecret, refreshToken (from `mcp-mailman auth login`)
}
```

- **App Password**: `nodemailer.createTransport({ service: 'gmail', auth: { user, pass } })`.
  Fast setup (2-Step Verification + generated app password), no Google Cloud
  project needed.
- **OAuth2**: one-time `mcp-mailman auth login <alias>` opens a browser
  (Google consent screen), stores a refresh token; at send-time it's
  exchanged for a short-lived access token (XOAUTH2). Required if a Workspace
  admin disables app passwords, and needed anyway for Google Contacts access
  (see Recipient suggestions below) and for reading mail via the Gmail API
  (see Reading/listing/searching mail below).

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

There's no database here — `accounts.json`, `contacts.json`, `settings.json`
are flat files, and they get the same rigor a DBA would demand of any small
persistent store:

- **Atomic writes, always.** Every write is: serialize → write to a temp
  file in the same directory → `fs.rename()` over the real path. A crash or
  power loss mid-write leaves the *old* file intact, never a half-written or
  corrupt JSON blob. Never write in place.
- **Single in-process writer.** All three files go through one write queue
  (`config/store.ts`). Even with only one OS process, tool calls can race
  each other — an `add_contact` auto-upsert from `confirm_send` overlapping
  a manual `configure_account` call, for instance. Reads/writes to the
  *same* file are serialized through that queue; unrelated files aren't
  blocked by each other.
- **`schemaVersion` field in every file, checked on load.** A future
  mailman release that changes a file's shape runs a migration keyed on
  that version instead of crashing on an old config or silently misreading
  a field. No migrations exist yet (v1 for all three), but the field ships
  from day one so it's never a breaking retrofit.
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
├── contacts.json    {email, name?, source: "manual"|"auto", useCount, lastUsedAt}
└── settings.json    { defaultAccount: "alias", draftTtlMinutes: 10, alwaysConfirm: true }
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
`get_status` MCP tool (see docs/TOOLS.md) that returns the identical data as
plain JSON for Claude to read/summarize. One data source, two presentations:
a pretty tree for a human running it directly in a terminal, structured JSON
for Claude. Depends on `@clack/prompts` (CLI-only dependency, not loaded by
the MCP server process itself).

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
8. Polish & publish (README finalized, npm publish, `claude mcp add` docs, cross-OS testing)
