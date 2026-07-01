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
