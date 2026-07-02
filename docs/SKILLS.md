# mailman — Skills (MCP Tools)

The tools this server exposes to a Claude session. Each tool is a plain,
stateless MCP call — the intelligence of interpreting "those docs" or
composing a subject/body lives in the calling Claude session, not here.

**Every response is JSON in a text block, host-agnostic.** No tool ever
returns host-specific formatted output — the `Output` shapes below are
JSON-serialized into the MCP `content` array's `text` field, the same
convention this monorepo's other MCP server uses (see docs/PLAN.md's Output
format section). Any MCP host — Claude Code, Cursor, Windsurf, etc. — parses
the same JSON and renders it however that host wants.

**Errors are structured, not just prose.** Any tool below that can fail
returns `{ code, message }` (JSON-in-text + `isError: true`) — see the
error-code table in
[docs/PLAN.md](PLAN.md#concurrency-resilience--idempotency) — so Claude can
branch on `code` (e.g. re-ask the user on `AMBIGUOUS_ACCOUNT`, back off and
retry on `RATE_LIMITED`) instead of pattern-matching the message text.

**Not exposed as MCP tools, deliberately**: key rotation
(`mailman auth rotate-key`), the scheduled-send ticker's dispatch
target (`mailman send-scheduled`), and attachment-content download are
CLI-only/CLI-only/unbuilt respectively — see docs/PLAN.md's Data integrity
and Scheduled sends sections for why.

## Terminal output convention

The tools above return plain JSON — this section is about the *other*
half of mailman, the human-facing `mailman <command>` CLI (full list
in [docs/CLI.md](CLI.md)). Every one of those commands renders through
the same shared tree vocabulary (`src/cli/tree.ts`), so `status`,
`account list`, `settings get`, `doctor`, `help`, etc. all look like one
tool instead of a grab-bag of `console.table()`, raw `JSON.stringify()`,
and ad hoc `process.stdout.write()` calls — which is what they were
before this convention existed. The design matches the reference terminal
tool the user pointed to (`ContextBrain`'s own CLI `status` output): a
title, then a strict two-tier diamond hierarchy with plain data lines
underneath, closed by an outro line.

**Spacing is part of the design.** Rows attach tightly to each other; the
single blank rail line belongs to each `◆` section header, nowhere else.
tree.ts writes rows directly rather than through `@clack/prompts`' `log.*`
helpers, which pad a spacer `│` before every message — that padding
double-spaced every list until a real user flagged it against the
reference. Only `intro()`/`outro()` (`┌`/`└`) remain clack's.

```
┌  mailman — status
│
◆  accounts
│  mailman   app-password   default   read: yes
│
◆  security
◇  master key found
◇  accounts.json encrypted (AES-256-GCM)
│
└  status
```

- **`◆` (filled diamond, `section()`)** — a section header; carries the
  one leading blank rail line.
- **`◇` (hollow diamond, `check()`)** — a single confirmatory fact nested
  under a section (e.g. "master key found", or `doctor`'s rows under its
  `◆ checks` header), the same role as `ContextBrain`'s "running
  (pid ...)" line under "dev server". Turns into a red `■` automatically
  when the fact is false — never a standalone "failure" glyph you pick
  manually.
- **`■` (red square, `fail()`)** — an error/usage failure message.
- **`▲` (triangle, `attention()`)** — worth flagging, not a hard failure.
- **`●` (circle, `info()`)** — informational guidance mid-flow.
- **`│` (bar, `detail()`)** — plain data: a table row, a count, a
  `key: value` pair. No icon, just the tree's rail.
- **`┌ title` / `└ closing line`** — `@clack/prompts`' own `intro()`/
  `outro()`, unchanged.

Multi-line messages keep the rail unbroken: continuation lines are
prefixed `│  `.

**Deliberately exempt** — the convention applies to *everything* a human
reads, including `help`, `examples`, and usage errors (originally these
were plain text; the user explicitly asked for the diamond trail
everywhere). Only three outputs stay plain, each because glyphs would
break the output's *function*, not its looks:
- **bare `register`** — prints one copy-pasteable shell command. Tree
  glyphs/indentation would corrupt the paste. (`register --tools`/`-i`,
  which write configs, do render the tree.)
- **`send-scheduled --due`** — the OS ticker's dispatch target, read by a
  log file grep, never a human watching a terminal. Stays raw JSON.
- **`--version`** — a bare value scripts capture (`mailman --version`
  in CI, npm tooling).

Any new CLI command should import `section`/`check`/`detail`/`fail`/
`info`/`attention` from `src/cli/tree.ts` rather than reaching for
`console.table()`, `JSON.stringify()`, clack's `log.*`, or a bare
`process.stdout.write()` — that's how the convention (glyphs *and*
spacing) stays consistent instead of drifting command by command.

## `draft_email`

Resolves recipients/attachments/account and returns a preview. **Does not
send.**

- **Input**: `{ to: string | string[], cc?: string[], bcc?: string[], subject?: string, body: string, bodyType?: "text" | "html", attachments?: string[], account?: string }`
- **Output**: `{ draftId: string, expiresAt: string, preview: { from, to, cc, bcc, subject, bodyPreview, attachments: [{ name, sizeBytes, mimeType }] }, next_steps?: string[] }`
- **Notes**: `subject` is optional — if omitted, mailman fills a minimal
  templated default. `attachments` accepts explicit paths, a glob, or a
  directory (expanded non-recursively unless `recursive: true`). `next_steps`
  is a belt-and-suspenders hint (e.g. "show this preview and get explicit
  confirmation before calling confirm_send") reinforcing the tool
  description in case a host's model skims past it. `bodyType` falls back to
  `settings.defaultBodyType` when omitted. `preview.from` reflects the
  account's `displayName` (e.g. `"Kalpesh Gamit <you@gmail.com>"`) when one
  is set, and `preview.bodyPreview` already includes the account's
  `signature`, if any — the preview shown here is exactly what
  `confirm_send` later dispatches.
- **Example trigger**: *"mailman, send those docs to kalpesh.gamit@indianic.com"*
  → Claude resolves "those docs" to paths, composes subject/body, calls this.

## `confirm_send`

Dispatches the exact draft produced by `draft_email`.

- **Input**: `{ draftId: string }`
- **Output**: `{ sent: true, messageId: string, sentAt: string }`, or an
  error (`DRAFT_EXPIRED`) if the TTL elapsed.
- **Notes**: this is the only tool that actually causes mail to leave the
  machine. Never call it without the user having seen and confirmed the
  `draft_email` preview first. **Idempotent**: calling it again with the
  same `draftId` after a successful send returns the original result
  (`DRAFT_ALREADY_SENT` internally, surfaced as success) instead of
  resending — safe to retry on an ambiguous prior response. On a successful
  send it also fires a best-effort native desktop notification when the
  `desktopNotifications` setting is on (default) — never affects the tool
  result either way.

## `cancel_draft`

Discards a pending draft without sending.

- **Input**: `{ draftId: string }`
- **Output**: `{ cancelled: true }`

## `schedule_send`

Confirms a draft for **future** dispatch instead of immediate sending —
the "send this tomorrow at 9am" case. Persists to `scheduled.json`
(encrypted, same master key as `accounts.json`) and, if this machine
doesn't have one yet, installs the recurring OS ticker job that will
actually fire it later. Nothing is sent by this call itself.

- **Input**: `{ draftId: string, sendAt: string }` (`sendAt` is an absolute
  ISO-8601 instant — Claude resolves any relative phrase like "tomorrow at
  9am" to this before calling; mailman does no date parsing itself)
- **Output**: `{ scheduledId: string, sendAt: string, status: "pending" }`
- **Notes**: like `confirm_send`, must be called before the source draft's
  TTL expires — once scheduled, the entry lives independently in
  `scheduled.json`, decoupled from the ephemeral draft store. One-time
  sends only; there's no recurring/repeating schedule support.

## `list_scheduled`

Lists pending (and recently resolved) scheduled sends.

- **Input**: `{ account?: string }`
- **Output**: `{ scheduled: [{ scheduledId, to, subject, sendAt, status: "pending" | "sent" | "failed", attempts }] }`
- **Notes**: also available as a CLI command (`mailman scheduled list`)
  since it's read-only.

## `cancel_scheduled`

Cancels a pending scheduled send before it fires.

- **Input**: `{ scheduledId: string }`
- **Output**: `{ cancelled: true }`, or `SCHEDULE_NOT_FOUND` if the id
  doesn't exist or already fired.

## `suggest_recipients`

Ranked recipient candidates for a partial name/email.

- **Input**: `{ query: string, account?: string }`
- **Output**: `{ suggestions: [{ email, name?, source: "recents" | "manual" | "google-contacts", useCount?, lastUsedAt? }], next_steps?: string[] }`
- **Notes**: `google-contacts` results only appear for accounts using the
  `oauth2` auth method. `app-password` accounts only ever return
  `recents`/`manual`. `next_steps` appears when the match is ambiguous
  (multiple similarly-ranked candidates) — a hint to ask the user which one
  before calling `draft_email`, rather than picking one silently.
- **Example trigger**: *"email John the report"* → Claude calls this with
  `query: "John"` before drafting, to resolve the ambiguous name to an
  address (or ask the user to pick, if multiple match).

## `list_accounts`

Lists configured sender aliases (no secrets returned).

- **Input**: `{}`
- **Output**: `{ accounts: [{ alias, email, method, isDefault, canRead, displayName?, signature? }] }`
- **Notes**: `canRead` reflects whether read access (IMAP for app-password,
  `gmail.readonly` for oauth2) was actually granted for that account — in
  practice this is expected to always be `true` today, since scope requests
  are all-or-nothing at consent and App Password accounts get IMAP
  implicitly, but the field exists explicitly for a future scenario where
  read access isn't guaranteed.

## `configure_account`

Adds or updates an account.

- **Input**: `{ alias: string, email: string, method: "app-password" | "oauth2", credentials: {...}, setDefault?: boolean, displayName?: string, signature?: string }`
- **Output**: `{ alias: string, isDefault: boolean }`
- **Notes**: the first account ever added becomes default automatically.
  Adding another account leaves the existing default alone unless
  `setDefault: true` is passed. `displayName` is the "From Name" shown to
  recipients (e.g. `"Kalpesh Gamit"` for `"Kalpesh Gamit <you@gmail.com>"`);
  `signature` is appended to every draft sent from this account. Both are
  optional and plaintext (not secrets).

## `update_account_profile`

Updates an existing account's `displayName`/`signature` without touching
its (encrypted) credentials — the "just change my From Name" case, as
opposed to re-running `configure_account` with everything again.

- **Input**: `{ alias: string, displayName?: string | null, signature?: string | null }`
- **Output**: `{ alias: string, displayName?: string, signature?: string }`
- **Notes**: `null` clears a field; omitting it leaves the current value
  unchanged. Returns `ACCOUNT_NOT_FOUND` for an unknown alias.

## `remove_account`

Deletes a configured account.

- **Input**: `{ alias: string, confirmRemoval?: boolean }`
- **Output**: `{ removed: true }`, or an error requiring `confirmRemoval:
  true` if `alias` is the last remaining account or the current default.
- **Notes**: if the removed account was the default, `settings.defaultAccount`
  is cleared — subsequent `draft_email` calls with multiple remaining
  accounts and no default will return `AMBIGUOUS_ACCOUNT` until a new
  default is set. The `confirmRemoval` gate exists so one ambiguous
  instruction can't silently leave zero configured accounts.

## `get_settings`

Returns current global settings.

- **Input**: `{}`
- **Output**: `{ defaultAccount: string | null, draftTtlMinutes: number, alwaysConfirm: boolean, defaultBodyType: "text" | "html", desktopNotifications: boolean }`

## `update_settings`

Updates one or more global settings.

- **Input**: `{ defaultAccount?: string, draftTtlMinutes?: number, alwaysConfirm?: boolean, defaultBodyType?: "text" | "html", desktopNotifications?: boolean }`
- **Output**: the full updated settings object.
- **Notes**: `defaultBodyType` is what `draft_email` falls back to when a
  call doesn't pass `bodyType` explicitly. Defaults to `"text"`.
  `desktopNotifications` toggles the native "email sent" desktop
  notification fired after each successful send (`confirm_send` and
  scheduled dispatch). Defaults to `true`.

## `add_contact` / `remove_contact`

Manually manage the local address book (`contacts.json`), independent of the
auto-populated recents from `confirm_send`.

- **Input** (`add_contact`): `{ email: string, name?: string }`
- **Input** (`remove_contact`): `{ email: string }`
- **Output**: `{ ok: true }`

## `preview_attachments`

Given the same path/glob/dir input `draft_email` would accept, resolves and
returns the file list **without** creating a draft or touching any account —
useful for a quick "what would this attach?" check.

- **Input**: `{ attachments: string[], recursive?: boolean }`
- **Output**: `{ files: [{ path, name, sizeBytes, mimeType }], totalSizeBytes: number, exceedsLimit: boolean }`

## `list_contacts`

Returns the full local address book (no query filter), merged with Google
Contacts for OAuth2 accounts — the "get my contacts" case, as opposed to
`suggest_recipients`'s fuzzy-match-on-a-query case.

- **Input**: `{ account?: string }`
- **Output**: `{ contacts: [{ email, name?, source: "recents" | "manual" | "google-contacts", useCount?, lastUsedAt? }] }`

## `list_recent_emails`

Lists the most recent emails in a folder — "last 10 emails," "last 10 sent."

- **Input**: `{ account?: string, folder?: "inbox" | "sent", limit?: number, pageToken?: string }` (`folder` defaults to `"inbox"`, `limit` defaults to `10`, capped at `50`)
- **Output**: `{ emails: [{ id, from, to, subject, snippet, date, hasAttachments, isUnread }], nextPageToken?: string }`
- **Notes**: backed by the Gmail API for `oauth2` accounts, IMAP for
  `app-password` accounts — same normalized output shape either way.
  `snippet` is capped at ~200 characters. `limit` is capped at 50 regardless
  of what's requested, to keep a single call's context cost bounded — use
  `nextPageToken` to page further rather than requesting a huge `limit`.

## `search_emails`

Searches a folder (or all mail) by query.

- **Input**: `{ account?: string, query: string, folder?: "inbox" | "sent" | "all", limit?: number, pageToken?: string }`
- **Output**: same shape as `list_recent_emails`, filtered by `query`.
- **Notes**: `oauth2` accounts get Gmail's native query syntax passed through
  verbatim (`from:`, `subject:`, `after:`, `has:attachment`, ...).
  `app-password` accounts get a simplified subset (subject/from/date-range)
  since IMAP `SEARCH` is less expressive — a real capability gap between the
  two auth methods, not a bug. Same `limit`/`nextPageToken` behavior as
  `list_recent_emails`.

## `get_status`

Returns the same structured data the `mailman status` CLI command
renders as a tree — accounts (alias, method, default, read-access),
security state (master key found/missing, encryption in place), MCP
registration, and recent activity counts.

- **Input**: `{}`
- **Output**: `{ accounts: [{ alias, method, isDefault, canRead }], security: { masterKeyFound: boolean, encrypted: boolean }, activity: { sent, read, searched, sinceHours } }`
- **Example trigger**: *"mailman, are you set up correctly?"* / *"what's your status?"*

## `read_email`

Reads the full content of one email.

- **Input**: `{ account?: string, id: string }`
- **Output**: `{ id, from, to, cc, subject, date, bodyText, bodyHtml?, truncated: boolean, attachments: [{ name, sizeBytes, mimeType }] }`
- **Notes**: attachment entries are metadata only — this tool does not
  download attachment bytes. `id` comes from a prior `list_recent_emails` or
  `search_emails` call. `bodyText`/`bodyHtml` are capped at ~20,000
  characters each; `truncated: true` marks an email that hit the cap, so
  Claude knows not to treat the returned body as complete.

## `get_mailbox_overview`

Added post-launch (not part of the original 10-phase build) after
repeatedly composing `list_recent_emails` (sent) + `list_recent_emails`
(inbox) + `read_email` per attachment by hand in conversation — this
folds that into one call.

- **Input**: `{ account?: string, limit?: number }` (`limit` applies per
  folder, defaults to 10, capped at 50 — same convention as
  `list_recent_emails`)
- **Output**: `{ stats: { sentCount, inboxCount, unreadCount, attachmentCount }, sent: [...], inbox: [...] }`
  — each list entry is an `EmailSummary` (see `list_recent_emails`), with
  an added `attachments: [{ name, sizeBytes, mimeType }]` field whenever
  `hasAttachments` is true.
- **Notes**: like every other mailman tool, this returns structured JSON
  only — no HTML, no formatting. Rendering (a plain list, a colored
  dashboard, whatever fits the moment) is Claude's job, not the tool's,
  matching the host-agnostic output format the rest of mailman follows.
  Resolving attachment metadata is best-effort per message — a `read_email`
  failure on one message falls back to its plain summary instead of
  failing the whole call.
- **Example trigger**: *"mailman, give me a mailbox overview"* / *"show me
  my recent sent and inbox mail with attachments."*
