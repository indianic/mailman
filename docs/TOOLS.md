# mailman — MCP Tools ("skills")

The tools this server exposes to a Claude session. Each tool is a plain,
stateless MCP call — the intelligence of interpreting "those docs" or
composing a subject/body lives in the calling Claude session, not here.

## `draft_email`

Resolves recipients/attachments/account and returns a preview. **Does not
send.**

- **Input**: `{ to: string | string[], cc?: string[], bcc?: string[], subject?: string, body: string, bodyType?: "text" | "html", attachments?: string[], account?: string }`
- **Output**: `{ draftId: string, expiresAt: string, preview: { from, to, cc, bcc, subject, bodyPreview, attachments: [{ name, sizeBytes, mimeType }] } }`
- **Notes**: `subject` is optional — if omitted, mailman fills a minimal
  templated default. `attachments` accepts explicit paths, a glob, or a
  directory (expanded non-recursively unless `recursive: true`).
- **Example trigger**: *"mailman, send those docs to kalpesh.gamit@indianic.com"*
  → Claude resolves "those docs" to paths, composes subject/body, calls this.

## `confirm_send`

Dispatches the exact draft produced by `draft_email`.

- **Input**: `{ draftId: string }`
- **Output**: `{ sent: true, messageId: string, sentAt: string }` or an error
  if the draft expired or was already sent.
- **Notes**: this is the only tool that actually causes mail to leave the
  machine. Never call it without the user having seen and confirmed the
  `draft_email` preview first.

## `cancel_draft`

Discards a pending draft without sending.

- **Input**: `{ draftId: string }`
- **Output**: `{ cancelled: true }`

## `suggest_recipients`

Ranked recipient candidates for a partial name/email.

- **Input**: `{ query: string, account?: string }`
- **Output**: `{ suggestions: [{ email, name?, source: "recents" | "google-contacts", useCount?, lastUsedAt? }] }`
- **Notes**: `google-contacts` results only appear for accounts using the
  `oauth2` auth method. `app-password` accounts only ever return `recents`.
- **Example trigger**: *"email John the report"* → Claude calls this with
  `query: "John"` before drafting, to resolve the ambiguous name to an
  address (or ask the user to pick, if multiple match).

## `list_accounts`

Lists configured sender aliases (no secrets returned).

- **Input**: `{}`
- **Output**: `{ accounts: [{ alias, email, method, isDefault }] }`

## `configure_account`

Adds or updates an account.

- **Input**: `{ alias: string, email: string, method: "app-password" | "oauth2", credentials: {...}, setDefault?: boolean }`
- **Output**: `{ alias: string, isDefault: boolean }`
- **Notes**: the first account ever added becomes default automatically.
  Adding another account leaves the existing default alone unless
  `setDefault: true` is passed.

## `remove_account`

Deletes a configured account.

- **Input**: `{ alias: string }`
- **Output**: `{ removed: true }`
- **Notes**: if the removed account was the default, `settings.defaultAccount`
  is cleared — subsequent `draft_email` calls with multiple remaining
  accounts and no default will return the "ambiguous account" error until a
  new default is set.

## `get_settings`

Returns current global settings.

- **Input**: `{}`
- **Output**: `{ defaultAccount: string | null, draftTtlMinutes: number, alwaysConfirm: boolean }`

## `update_settings`

Updates one or more global settings.

- **Input**: `{ defaultAccount?: string, draftTtlMinutes?: number, alwaysConfirm?: boolean }`
- **Output**: the full updated settings object.

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

- **Input**: `{ account?: string, folder?: "inbox" | "sent", limit?: number }` (`folder` defaults to `"inbox"`, `limit` defaults to `10`)
- **Output**: `{ emails: [{ id, from, to, subject, snippet, date, hasAttachments, isUnread }] }`
- **Notes**: backed by the Gmail API for `oauth2` accounts, IMAP for
  `app-password` accounts — same normalized output shape either way.

## `search_emails`

Searches a folder (or all mail) by query.

- **Input**: `{ account?: string, query: string, folder?: "inbox" | "sent" | "all", limit?: number }`
- **Output**: same shape as `list_recent_emails`, filtered by `query`.
- **Notes**: `oauth2` accounts get Gmail's native query syntax passed through
  verbatim (`from:`, `subject:`, `after:`, `has:attachment`, ...).
  `app-password` accounts get a simplified subset (subject/from/date-range)
  since IMAP `SEARCH` is less expressive — a real capability gap between the
  two auth methods, not a bug.

## `get_status`

Returns the same structured data the `mcp-mailman status` CLI command
renders as a tree — accounts (alias, method, default, read-access),
security state (master key found/missing, encryption in place), MCP
registration, and recent activity counts.

- **Input**: `{}`
- **Output**: `{ accounts: [{ alias, method, isDefault, canRead }], security: { masterKeyFound: boolean, encrypted: boolean }, activity: { sent, read, searched, sinceHours } }`
- **Example trigger**: *"mailman, are you set up correctly?"* / *"what's your status?"*

## `read_email`

Reads the full content of one email.

- **Input**: `{ account?: string, id: string }`
- **Output**: `{ id, from, to, cc, subject, date, bodyText, bodyHtml?, attachments: [{ name, sizeBytes, mimeType }] }`
- **Notes**: attachment entries are metadata only — this tool does not
  download attachment bytes. `id` comes from a prior `list_recent_emails` or
  `search_emails` call.
