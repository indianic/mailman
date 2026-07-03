# @indianic/mailman

MailMan CLI — send and read Gmail just by asking your AI assistant, built for IndiaNIC infrastructure.

## Features

- Send **and read** Gmail from your AI in plain English — "send those docs to Kalpesh," "show my last 10 emails"
- **Draft → preview → confirm** safety — nothing sends until you approve (`confirm_send` won't dispatch without an explicit confirmation)
- **182 message templates** + `list_templates` (FYI, follow-up, meeting, forward/reply and more — a subject prefix + a hint your AI composes from)
- Attachments (files, folders, `*.pdf` globs), **scheduled sends** via an OS timer, inbox list / read / search, contacts + recipient suggestions
- Multi-account, machine-bound encrypted credentials (OS keychain), desktop notifications on send
- Installs into **Claude Code, Cursor, Gemini CLI, Windsurf, Codex** (`mailman register`) — cross-platform Win/Mac/Linux
- 23 MCP tools, exposed to your AI over MCP

## Installation

Point the `@indianic` scope at the private registry, then install globally with **npm** or **pnpm**:

```
# npm
npm config set @indianic:registry https://npm.indianic.in
npm install -g @indianic/mailman

# pnpm
pnpm config set @indianic:registry https://npm.indianic.in
pnpm add -g @indianic/mailman
```

(The scope config lands in your `~/.npmrc` — which npm, pnpm, and yarn all read — so no `--registry` flag is needed and public dependencies still resolve from the public registry. `mailman update` later upgrades in place with whichever manager you used.)

## Usage

```
# First-run setup — adds a Gmail account (email + App Password) and
# registers your AI tools (Claude Code, Cursor, Gemini CLI, Windsurf, Codex)
mailman init

# Register with AI editors later
mailman register --tools claude,cursor
mailman register -i

# Diagnostics & current state
mailman doctor
mailman status

# Accounts, contacts, settings
mailman account add
mailman settings set defaultBodyType html
mailman settings set desktopNotifications false

# Scheduled sends
mailman scheduled list

# Self-update
mailman update

# Help & version
mailman help
mailman --version
```

Once installed and registered, you talk to your AI — not the CLI — for everyday email:

```
You: mailman, send those docs to kalpesh.gamit@indianic.com
AI:  [drafts subject/body, resolves attachments] Ready to send — confirm?
You: yes
AI:  Sent.

You: mailman, list my last 10 emails
You: search for invoices from last month
You: send this tomorrow at 9am instead of now   # goes out even if the tool is closed
```

> **Package vs. command names.** The npm package is **`@indianic/mailman`**; it installs a CLI you run as **`mailman`**. A second alias, **`mcp-mailman`**, points at the same binary — use it only on a host that also has GNU Mailman's `/usr/bin/mailman`.

## How it works

A native stdio **MCP server**: your editor launches it via `npx -y @indianic/mailman` and Claude calls its tools from natural language. It reaches Gmail two ways — **SMTP/IMAP** for App Password accounts, or the **Gmail REST API** for OAuth2 accounts. Pure Node.js, so behavior is identical on macOS, Linux, and Windows. Configured once, globally — available from any project.

Manual MCP config (what `init`/`register` write for you — note it carries **no secrets**, credentials live in the OS keychain):

```json
{
  "mcpServers": {
    "mailman": { "command": "npx", "args": ["-y", "@indianic/mailman"] }
  }
}
```

- **Claude Code** — `claude mcp add mailman -- npx -y @indianic/mailman`
- **Cursor / Windsurf / Gemini CLI / Codex** — add the block to that tool's MCP config file.

## Docs

- [docs/FEATURES.md](docs/FEATURES.md) — plain-English + technical feature tour
- [docs/PLAN.md](docs/PLAN.md) — architecture: auth, storage, tools, flows
- [docs/SKILLS.md](docs/SKILLS.md) — the MCP tools this server exposes
- [docs/CLI.md](docs/CLI.md) — every terminal command (setup, accounts, diagnostics)
- [docs/CROSS-OS.md](docs/CROSS-OS.md) — per-OS support matrix

## OAuth2 setup (optional — the expert path)

`mailman init` / `account add` are App Password–only on purpose (nothing beyond 2-Step Verification and a 16-char password). OAuth2 lives behind its own command — `mailman auth login <alias>` — for the cases that need it: a Workspace admin who disabled app passwords, or Google Contacts–backed suggestions. It uses **your own** Google Cloud OAuth client (Desktop app, Gmail API enabled); a browser opens for consent and the refresh token is stored encrypted. On a headless box, `auth login` prints the consent URL + an `ssh -L` tunnel command instead of launching a browser.

Scopes requested: `gmail.send`, `gmail.readonly`, `contacts.readonly`. (`gmail.readonly` is read access to your whole mailbox — App Password accounts get equivalent read access implicitly via IMAP.)

## Security

Credentials are **machine-bound**, not just encrypted: the encryption key lives in your OS's native store (macOS Keychain, Windows Credential Manager, Linux Secret Service via `keytar`), never in the config dir. Copying `accounts.json` to another machine yields useless ciphertext — `mailman` there refuses to decrypt rather than degrade. Every tool call is appended to a local `activity.log` (tool name + non-sensitive metadata only — never bodies/credentials).

> Linux headless needs a running Secret Service provider (gnome-keyring, kwallet). No keyring → setup fails with instructions rather than storing plaintext. See [docs/CROSS-OS.md](docs/CROSS-OS.md).

## Config location

All state (accounts, contacts/recents, settings) lives in one global, per-OS-user directory — never inside a project:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/mcp-mailman/` |
| Linux | `~/.config/mcp-mailman/` |
| Windows | `%APPDATA%\mcp-mailman\` |

## Desktop notifications

After each successful send (interactive **and** scheduled), mailman fires a native desktop notification — macOS Notification Center (`osascript`), Linux `notify-send`, Windows toast. **On by default**; best-effort (never blocks/fails a send). Toggle:

```
mailman settings set desktopNotifications false
mailman settings set desktopNotifications true
```

## Staying up to date

Interactive `mailman` commands show a one-line "update available" notice when a newer version is published (cached daily). Upgrade in place — it uses the package manager that installed it (npm or pnpm):

```
mailman update    # or: mailman upgrade
```

Restart your AI tools afterward so their MCP server picks up the new version.

## License

MIT
