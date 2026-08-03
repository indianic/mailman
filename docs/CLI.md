# mailman — CLI Commands

These are commands **you** type directly in a terminal — setup, account
administration, and diagnostics. They're separate from the MCP tools in
[docs/SKILLS.md](SKILLS.md), which Claude calls conversationally. The split is
deliberate: anything destructive, credential-sensitive, or that requires a
browser (OAuth2 consent) belongs here, not behind something an LLM session
could be talked into triggering.

The primary command is **`mailman`**. `mcp-mailman` is kept as an alias
(both resolve to the same binary) for the one case where `mailman` would
collide: GNU Mailman, the mailing-list manager, already ships a `mailman`
binary on some Linux servers. On such a box, either that server's
`/usr/bin/mailman` or this one wins depending on PATH order — use
`mcp-mailman` there to be unambiguous. Everywhere else, `mailman` is the
name to use.

Bare `mailman` with no arguments behaves differently by context: launched
over pipes (how every MCP host runs it), it starts the stdio MCP server;
typed by a person at a TTY, it shows the command list instead — a bare
JSON-RPC server silently waiting on stdin is never what a human wanted.
Unknown commands suggest the nearest real one (`upgarde` → did you mean
`upgrade`?).

## Command list

| Command | Purpose |
|---|---|
| `mailman init` | First-run wizard: opens with a connect-method choice — **App Password** (default: paste a 16-char code) or **Sign in with browser (OAuth2)** (passwordless; for passkey / App-Password-disabled accounts) — adds your first account, auto-set as default, prompts for an optional "From Name"/signature, then **auto-writes the `mailman` MCP config into whichever AI tools you pick** (Claude Code, Cursor, Gemini CLI, Windsurf, Codex) at a chosen scope. Idempotent. The recommended starting point. |
| `mailman account add` | Add another account. Same connect-method choice as `init` (App Password default, or browser OAuth2), then alias/email/profile prompts. `auth login <alias>` is the standalone OAuth2 entry point. `--default` forces it as default even if not the first account. |
| `mailman account list` | Plain table of configured accounts (alias, method, default, read-access). |
| `mailman account remove <alias>` | Remove an account. Requires `--yes` (or an interactive confirm) if it's the last remaining account or the current default — mirrors the `confirmRemoval` gate on the `remove_account` MCP tool. |
| `mailman account set-default <alias>` | Set the default account used when `draft_email` gets no explicit `account`. |
| `mailman account password [alias]` | Update an existing account's Gmail App Password without re-running the whole `account add` flow. Alias optional — omit it to pick from the same diamond-trail list `account remove` uses, which is the recommended path since it needs no typing or quoting. The new password is **verified against Gmail before anything is stored**, so a mistyped or revoked code is rejected here rather than failing silently on the next send. App Password accounts only; OAuth2 accounts re-consent via `auth login` instead. |
| `mailman account profile [alias] [--name "..."] [--signature "..."] [--clear-name] [--clear-signature]` | Show (no flags) or change the "From Name" recipients see and the signature appended to every draft — the terminal path to the same fields the `update_account_profile` MCP tool edits. Alias optional (resolves explicit → only account → default). `\n` in `--signature` becomes a real newline. Credentials untouched. |
| `mailman auth login <alias>` | OAuth2 consent for an existing or new alias; stores the refresh token, then prompts for an optional "From Name"/signature. Opens your local browser automatically when one is reachable (loopback redirect, fully automatic once you click Allow). When no local browser is available (SSH/headless/container) or `--no-browser` is passed, prints the consent URL plus an `ssh -L` port-forward command — run it from your local machine, open the URL in your local browser, approve, and the same listener captures the redirect through the tunnel. There is no Device Authorization Grant fallback: Google's device flow doesn't support Gmail/Contacts scopes at all, on any client type, so it can't be used here. |
| `mailman auth rotate-key` | Generate a new master key, re-encrypt **both** files the old key covered — every account's stored secrets in `accounts.json` and every scheduled send's message content in `scheduled.json` — then store the new key via keytar. Refuses up front if any account doesn't decrypt under the current key (that config dir and key are already out of sync, and a half-rotation would make it worse); an already-orphaned *scheduled* entry is reported and skipped rather than blocking rotation forever. Writes `scheduled.json` before `accounts.json` before the key swap, so the only crash window costs the send queue rather than the credentials. CLI-only, never an MCP tool — see docs/PLAN.md's Data integrity section for why. |
| `mailman auth migrate-keystore --to <backend>` | Move the master key to another keystore (`os-keychain` \| `passphrase` \| `env` \| `file`) — the only sanctioned way to change where it lives once credentials exist, because doing it implicitly would orphan them. Two shapes, picked automatically: a target that can *hold* a key (`os-keychain`, `file`) receives the existing one and **nothing is re-encrypted**; a target that supplies its own (`passphrase` derives it, `env` is handed it) causes every stored credential to be rewritten under it. The key is read back out of the target and compared **before** the source copy is removed. Warns if `MAILMAN_KEYSTORE` is pinned to something else in your environment, since that overrides the recorded backend on every later command and makes a successful migration look like a silent failure. Needs `--yes` when not run from a terminal (migrating a headless server is a first-class use). |
| `mailman contacts list` | Print the local address book. |
| `mailman contacts add <email> [--name "..."]` | Manually add a contact. |
| `mailman contacts remove <email>` | Remove a contact. |
| `mailman settings get` | Print current global settings (`defaultAccount`, `draftTtlMinutes`, `alwaysConfirm`, `defaultBodyType`, `desktopNotifications`). |
| `mailman settings set <key> <value>` | Update one setting. `defaultBodyType` accepts `text` or `html` — what `draft_email` falls back to when a call omits `bodyType`. `desktopNotifications` accepts `true`/`false` (default `true`) — when on, a native OS notification (macOS Notification Center / Linux `notify-send` / Windows toast) fires after each successful send, including scheduled sends. |
| `mailman register` | Register mailman with your AI editors. `register --tools <a,b,…\|all> [--scope global\|project]` writes/merges each tool's MCP config directly (Claude Code, Cursor, Gemini CLI, Windsurf, Codex — the same engine `init` uses; idempotent). `register -i` runs the interactive picker. Bare `register` just prints the copy-pasteable `claude mcp add mailman -- npx -y @integratex/mailman` line without writing anything. User-level-only tools (Gemini/Windsurf/Codex) always write their user config regardless of `--scope`. |
| `mailman doctor` | Environment pre-flight **plus a live login for every configured account**, distinct from `status` (which reports *configured* state): keyring backend reachable right now (catches the headless-Linux-no-keyring case before `account add` fails confusingly), Node version ≥18, a fully **verified TLS handshake** to `smtp.gmail.com:465` and `imap.gmail.com:993` (both ports are implicit TLS, so the bare TCP connect this used to do reported "reachable" even where an intercepting proxy or antivirus SSL scanner made every real connection fail — on a trust failure the check names the root CA the chain ends at and prints the `--use-system-ca` / `NODE_EXTRA_CA_CERTS` fix), and — for each account — a real Gmail login (SMTP+IMAP for App Password, token exchange for OAuth2) so a password that was revoked/changed after setup shows up here rather than on the next silent send. Pass `--offline` to skip the account logins for a fast, network-free environment check. A **`dependencies`** section runs first, covering the prerequisites this machine must already have: `npm` (which `mailman update` shells out to) and, **on Linux only**, `libsecret` — keytar's native backend, and the one external library mailman genuinely needs (macOS and Windows ship their own credential store, so nothing is checked or suggested there). Pass **`--fix`** to print the exact install command for anything missing, per platform. It distinguishes two failure modes that look identical from the outside and have different fixes, routing off what the probe actually reported rather than what `ldconfig` guessed: `libsecret` absent (the native module cannot even load) versus present-but-no-running-Secret-Service-daemon — verified against both container states. The `libsecret` row reports the **library only**; it used to claim "present (keytar can reach the Secret Service)", which is false on a headless box. Whether the store is reachable is the separate **`OS credential store`** row, the only check that touches the daemon — and it is reported as a *failure* only when `os-keychain` is the keystore actually in use, so a server running the `passphrase` keystore is green rather than red about a store it does not use. A **`Keystore backend`** row names the active backend and where that choice came from, and reports `file` as **degraded** rather than healthy. The **`Scheduled-send ticker`** row fails when the crontab line has no `DBUS_SESSION_BUS_ADDRESS` while `os-keychain` is active (cron has no session bus, so those sends would fail silently at 3am), and when the `passphrase` keystore is active with no way for cron to obtain the passphrase. On headless Linux `--fix` no longer says "log into a desktop session" — there is no session to log into — it points at `auth migrate-keystore --to passphrase|env`, keeping the desktop hint for desktop machines. Commands are **printed, never executed**: installing a system library needs root, and a CLI that silently `sudo`s to fix its own prerequisite is doing something you did not ask for. Also reports **which `mailman` the shell actually runs**: if another package name owns that command (`@indianic/mailman`, `mcp-mailman`) or a non-npm binary shadows it (GNU Mailman's `/usr/bin/mailman`), the check fails and prints the uninstall-then-install fix. That's the `npm error code EEXIST … File exists: /opt/homebrew/bin/mailman` case — npm resolves bin links before running any of the incoming package's lifecycle scripts (verified on npm 11), so mailman cannot explain the collision during the failed install itself; `npx -y @integratex/mailman doctor --offline` reaches this check without needing the global install to have succeeded. |
| `mailman scheduled list` | Read-only mirror of the `list_scheduled` MCP tool — pending/sent/failed scheduled sends. |
| `mailman send-scheduled --due` | The scheduled-send ticker's actual dispatch target — invoked by the OS scheduler (launchd/cron/Task Scheduler), never run manually or by an LLM. Reads `scheduled.json`, sends everything due through the same path `confirm_send` uses, marks each `sent`/`failed`. |
| `mailman session list [--project X] [--since 7d] [--search q] [--branch b] [--limit N] [--all] [--refresh] [--json]` | Find past AI coding sessions from this host's own transcripts (`~/.claude/projects/**/*.jsonl`, overridable via `MAILMAN_SESSIONS_DIR`). With no `--project` it leads with the per-project roll-up, then the session rows — "project wise, then session wise". Metadata only (id, title, project, branch, dates, record count); never transcript content. Backed by an mtime/size-keyed cache in the config dir, so only changed transcripts are re-read: measured on a real store of 2,258 sessions / 946 MB, the first build takes ~4.4s and every later run ~0.2s. `--refresh` forces a full re-scan. |
| `mailman session report [<session-id>…] [filters] [--out file] [--json]` | Pick sessions and build a digest worth emailing. With no ids in a terminal it runs the two-step picker — clack `select` for the project (same shape as `account remove`'s), then clack `multiselect` for the sessions (same shape as `register -i`'s). Non-interactive with filters, it takes the filtered set so it composes in scripts. **The output is mechanical** — title, files touched, commits, tool counts — because the CLI has no model; the prose summary is the `list_sessions` + `read_session_digest` MCP path, and the command says so in its closing section. Does not send. |
| `mailman status` | The `@clack/prompts` tree view — accounts, security, MCP registration, activity, pending-scheduled count. Already specced in docs/PLAN.md. |
| `mailman update` (alias: `upgrade`) | Self-update: checks the npm registry for a newer version and updates the global install in place (no-op with a clear message when already current). Separately, *any* interactive command prints a passive "update available" notice above its own output when a newer version has been published — checked at most once a day from a cached result, in a detached background process, so it never slows a command down (suppressed on pipes/CI and via `NO_UPDATE_NOTIFIER`). |
| `mailman reset` | Wipes the global config directory (`accounts.json`, `contacts.json`, `settings.json`, `keystore.json`, `activity.log`) **and** removes the active keystore's key material, for a clean re-setup. Removal goes through the backend, not straight to keytar: the `file` keystore deliberately keeps its key *outside* the config dir, so wiping the directory alone would leave 32 bytes of live secret orphaned in `~/.local/state`. Reads `keystore.json` before the wipe (it says where the key is, and it is inside the directory being deleted), and a broken or unknown `MAILMAN_KEYSTORE` no longer blocks the reset — reset is the documented way out of that state. Destructive — requires explicit `--yes`, no default-confirm bypass. |
| `mailman help [command]` | The command list (same as `--help`), or one command's summary — exists as a real subcommand because people type `mailman help`, not just `--help`. |
| `mailman examples` | Usage examples: the one-time terminal setup, the From Name/signature and desktop-notification toggles, plus what to actually say inside your AI tool. Rendered in the same diamond tree as every other command. |
| `mailman --version` / `--help` | Standard. |

## Deliberately not CLI commands

**Sending, reading, listing, or searching mail** — those exist only as MCP
tools (`draft_email`/`confirm_send`, `list_recent_emails`, `search_emails`,
`read_email`). A bare `mailman send ...` CLI command would either bypass
the draft → preview → confirm safety flow entirely, or need to reimplement
that same confirmation UX outside of a Claude conversation — out of scope
for v1. If a scripting/cron use case for headless sending shows up later,
that's a deliberate future decision, not an oversight.

**Scheduling or canceling a scheduled send** — same reasoning:
`schedule_send`/`cancel_scheduled` are MCP-tool-only, since scheduling a
send is still "sending mail," just deferred. `mailman send-scheduled`
is the one scheduling-related CLI command that exists, and it's not a
counter-example — it's the ticker's dispatch target, invoked by the OS
scheduler, not something a human or an LLM ever runs directly.

## Command → underlying logic reuse

Several CLI commands are thin wrappers over the same functions the MCP
tools call (`account add` → the same account-creation path as
`configure_account`; `contacts list` → the same merge logic as
`list_contacts`) — no duplicated business logic between "the human path"
and "the Claude path," just two different entry points into the same
`src/` modules.
