# mailman — CLI Commands

These are commands **you** type directly in a terminal — setup, account
administration, and diagnostics. They're separate from the MCP tools in
[docs/TOOLS.md](TOOLS.md), which Claude calls conversationally. The split is
deliberate: anything destructive, credential-sensitive, or that requires a
browser (OAuth2 consent) belongs here, not behind something an LLM session
could be talked into triggering.

Binary name is **`mcp-mailman`**, not a bare `mailman` — GNU Mailman (the
mailing-list manager) already ships a `mailman` binary on many Linux
servers; colliding with that isn't hypothetical.

## Command list

| Command | Purpose |
|---|---|
| `mcp-mailman init` | First-run wizard: add your first account (app-password or OAuth2), auto-set as default. The recommended starting point. |
| `mcp-mailman account add` | Add another account. Prompts for alias, email, method. App Password: masked password prompt. OAuth2: opens the browser consent flow (same as `auth login`). `--default` forces it as default even if not the first account. |
| `mcp-mailman account list` | Plain table of configured accounts (alias, method, default, read-access). |
| `mcp-mailman account remove <alias>` | Remove an account. Requires `--yes` (or an interactive confirm) if it's the last remaining account or the current default — mirrors the `confirmRemoval` gate on the `remove_account` MCP tool. |
| `mcp-mailman account set-default <alias>` | Set the default account used when `draft_email` gets no explicit `account`. |
| `mcp-mailman auth login <alias>` | OAuth2 consent for an existing or new alias; stores the refresh token. Opens your local browser automatically when one is reachable (loopback redirect, fully automatic once you click Allow). Falls back to printing a URL + short code for the Device Authorization Grant flow when no local browser is available (SSH/headless/container) or `--no-browser` is passed — open that URL on any device, mailman polls and completes automatically. Neither path requires copying a code back into the terminal. |
| `mcp-mailman auth rotate-key` | Generate a new master key, re-encrypt every account's stored secrets, store the new key via keytar. CLI-only, never an MCP tool — see docs/PLAN.md's Data integrity section for why. |
| `mcp-mailman contacts list` | Print the local address book. |
| `mcp-mailman contacts add <email> [--name "..."]` | Manually add a contact. |
| `mcp-mailman contacts remove <email>` | Remove a contact. |
| `mcp-mailman settings get` | Print current global settings (`defaultAccount`, `draftTtlMinutes`, `alwaysConfirm`). |
| `mcp-mailman settings set <key> <value>` | Update one setting. |
| `mcp-mailman register` | Prints the exact `claude mcp add mailman -- npx -y mcp-mailman` line to run — doesn't execute it for you, just gives you the copy-pasteable command. |
| `mcp-mailman doctor` | Environment pre-flight checks, distinct from `status` (which reports *configured* state): is a keyring backend actually reachable right now (catches the headless-Linux-no-keyring case before `account add` fails confusingly), Node version ≥18, DNS/TCP reachability to `smtp.gmail.com:465` and `imap.gmail.com:993`. |
| `mcp-mailman status` | The `@clack/prompts` tree view — accounts, security, MCP registration, activity. Already specced in docs/PLAN.md. |
| `mcp-mailman reset` | Wipes the global config directory (`accounts.json`, `contacts.json`, `settings.json`, `activity.log`) **and** removes the keytar master-key entry, for a clean re-setup. Destructive — requires explicit `--yes`, no default-confirm bypass. |
| `mcp-mailman --version` / `--help` | Standard. |

## Deliberately not CLI commands

**Sending, reading, listing, or searching mail** — those exist only as MCP
tools (`draft_email`/`confirm_send`, `list_recent_emails`, `search_emails`,
`read_email`). A bare `mcp-mailman send ...` CLI command would either bypass
the draft → preview → confirm safety flow entirely, or need to reimplement
that same confirmation UX outside of a Claude conversation — out of scope
for v1. If a scripting/cron use case for headless sending shows up later,
that's a deliberate future decision, not an oversight.

## Command → underlying logic reuse

Several CLI commands are thin wrappers over the same functions the MCP
tools call (`account add` → the same account-creation path as
`configure_account`; `contacts list` → the same merge logic as
`list_contacts`) — no duplicated business logic between "the human path"
and "the Claude path," just two different entry points into the same
`src/` modules.
