# mailman — `@indianic/mailman`

An MCP server that lets any Claude CLI session send **and read** email — with
attachments, a preview/confirmation step before anything actually goes out,
multi-account support, recipient auto-suggestion, and inbox
listing/search/read. Pure Node.js, so it runs the same way on macOS, Linux,
and Windows. Configured once, globally, and available from any project you
run Claude in — not tied to a single repo.

It's a native stdio MCP server: your editor launches it via `npx`, and it
talks to Gmail directly — over SMTP/IMAP for App Password accounts, or the
Gmail REST API for OAuth2 accounts. Claude calls its tools from natural
language ("mailman, send this," "list my last 10 emails"); there's nothing
project-specific to wire up per repo.

> **Package vs. command names.** The npm package is **`@indianic/mailman`**
> (that's what you `npx` / `npm install` / register with Claude). It installs
> a CLI you run as **`mailman`** (`mailman init`, `mailman doctor`, …). A
> second alias, **`mcp-mailman`**, points at the same binary — use it only on
> a host that also has GNU Mailman's `/usr/bin/mailman`, where the bare
> `mailman` name would otherwise collide.

## Examples

```
You: mailman, send those docs to kalpesh.gamit@indianic.com
Claude: [drafts subject/body from context, resolves attachments]
        Ready to send to kalpesh.gamit@indianic.com?
          Subject: Documents from our session
          Attachments: plan.pdf (240 KB), checklist.md (12 KB)
        Confirm?
You: yes
Claude: Sent.
```

```
You: mailman, list my last 10 emails
Claude: [1] ... [10] ...

You: search for invoices from last month
Claude: [matching results]

You: get my contacts
Claude: [address book, merged with Google Contacts for OAuth2 accounts]
```

```
You: mailman, send this tomorrow at 9am instead of now
Claude: [drafts as usual] Ready to send to ... at 2026-07-02 09:00 — confirm?
You: yes
Claude: Scheduled. It'll go out even if this Claude session is closed by then.
```

## Status

All 10 phases (0–9) implemented — see [docs/PLAN.md](docs/PLAN.md) for the
architecture and [docs/CHECKLIST.md](docs/CHECKLIST.md) for the phase-by-
phase build order and what's been manually verified vs. still pending.

**Verified for real**, registered globally via `claude mcp add` on this
machine, with a real Gmail App Password account: send, `list_recent_emails`,
`read_email`, and `search_emails` all confirmed against a live inbox. This
real test caught and fixed a bug fake-credential smoke tests couldn't
have (IMAP wasn't decoding quoted-printable body content).

Still deliberately left for you rather than done automatically:

- **OAuth2 real-delivery verification** — smoke-tested against Google's
  real endpoints with fake credentials (clean `AUTH_EXPIRED`), but needs
  your own Google Cloud OAuth client to confirm an actual send/read.
- **Cross-OS smoke test** (Linux/Windows) — only macOS was available;
  the per-OS keychain support matrix and verification checklist are in
  [docs/CROSS-OS.md](docs/CROSS-OS.md).
- **Public `npm publish`** — mailman is published to the IndiaNIC private
  registry as `@indianic/mailman`, but a public `registry.npmjs.org`
  release is still pending (needs an interactive 2FA/OTP step).
- **The scheduled-send OS ticker** (`launchd`/`crontab`/Task Scheduler) —
  registering it mutates real system state outside this repo and persists
  across reboots, so it's not installed automatically; `schedule_send`
  installs it the first time you actually use it.

## Docs

- [CONTEXT.md](CONTEXT.md) — start here: condensed overview, status, key decisions
- [docs/PLAN.md](docs/PLAN.md) — full architecture: auth, storage, tools, flows
- [docs/SKILLS.md](docs/SKILLS.md) — the MCP tools this server exposes ("skills"), called by Claude
- [docs/CLI.md](docs/CLI.md) — the terminal commands you run yourself (setup, accounts, diagnostics)
- [docs/CHECKLIST.md](docs/CHECKLIST.md) — phased implementation checklist

## Quick setup (interactive wizard)

One command does the whole thing — adds your first Gmail account (just
your email + an App Password, no OAuth clients or secrets), encrypts the
credentials into your OS keychain, sets it as default, **and writes the
MCP config into whichever AI tools you pick** (Claude Code, Cursor,
Gemini CLI, Windsurf, Codex):

```bash
npx @indianic/mailman init
```

The wizard asks for the account details, then a multi-select of which
tools to register mailman with and a config scope (global or this-project).
It writes/merges each tool's MCP config for you — idempotent, so re-running
just updates the entry in place. Restart the tool afterward and say
*"mailman, list my last 10 emails."*

Already have an account and just want to (re)register more tools:

```bash
mailman register --tools claude,cursor        # non-interactive
mailman register -i                            # interactive picker
mailman register                               # just print the `claude mcp add …` line
```

`mailman doctor` checks Node version, OS keyring reachability,
SMTP/IMAP network reachability, and scheduled-send ticker status — run it
first if something's off. Every terminal command (accounts, contacts,
settings, scheduled sends) is in [docs/CLI.md](docs/CLI.md).

## Install from `npm.indianic.in`

Published to the IndiaNIC private registry. The `@indianic` scope is routed
there by your `~/.npmrc`, so no `--registry` flag is needed and mailman's
own public dependencies still resolve from the public npm registry:

```bash
# one-shot, no local install (what `claude mcp add` uses)
npx -y @indianic/mailman

# or install the CLI globally
npm install -g @indianic/mailman
```

If your `~/.npmrc` doesn't already scope `@indianic`, add:

```
@indianic:registry=https://npm.indianic.in/
```

## Configure in your AI editor (manual)

`init` / `register` write these files for you, but if you'd rather do it by
hand, the launch block is the same everywhere — and notably carries **no
secrets**, because your Gmail credentials live encrypted in the OS keychain,
not in editor config:

```json
{
  "mcpServers": {
    "mailman": {
      "command": "npx",
      "args": ["-y", "@indianic/mailman"]
    }
  }
}
```

- **Claude Code** — `claude mcp add mailman -- npx -y @indianic/mailman`, or drop the block into `~/.claude.json` (global) / project `.mcp.json`.
- **Cursor** — add the block to `~/.cursor/mcp.json` (or project `./.cursor/mcp.json`).
- **Windsurf / Gemini CLI / Codex** — add the same block to that tool's MCP config file.

Accounts are configured once via `mailman init` (above) and shared across
every editor, since they live in one global config dir, not per-tool.

## OAuth2 setup (optional — the expert path)

`mailman init` / `account add` are App Password–only on purpose: nothing
beyond 2-Step Verification and a generated 16-character password, no
method question to answer. OAuth2 exists behind its own command —
`mailman auth login <alias>` — for the two cases that genuinely need it:
a Workspace admin disabling app passwords, or Google Contacts–backed
recipient suggestions.

OAuth2 needs your own Google Cloud OAuth client — mailman doesn't ship a
shared one, so each user's `auth login` uses credentials they create
themselves:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/),
   create or select a project.
2. **APIs & Services → Library**: enable the **Gmail API**.
3. **APIs & Services → OAuth consent screen**: User type **External**,
   publishing status **Testing** (add your own Gmail address as a test
   user). This is sufficient for personal use — Google's app-verification
   review is only required to go past Testing mode, which you don't need.
4. **APIs & Services → Credentials → Create Credentials → OAuth client
   ID**: application type **Desktop app**. Copy the generated **Client
   ID** and **Client Secret**.
5. Run `mailman auth login <alias>` and paste in the Client ID/Secret
   when prompted. A browser opens automatically to Google's consent
   screen — approve, and mailman captures the redirect and stores the
   refresh token (encrypted) for you.

**Scope disclosure**: the consent screen requests `gmail.send`,
`gmail.readonly`, and `contacts.readonly`. `gmail.readonly` is a
materially broader grant than send-only — it's read access to your whole
mailbox (list/search/read), not just permission to send. App Password
accounts get equivalent read access implicitly too (the same app password
that authorizes SMTP also authorizes IMAP on that Gmail account) — it's
the same capability either way, just worth being explicit about for
OAuth2's separate consent step.

**No local browser reachable** (SSH session, headless box, container)?
`auth login` detects this (or pass `--no-browser` to force it) and prints
the consent URL plus an `ssh -L <port>:localhost:<port> <user>@<host>`
command instead of trying to launch a browser — run that from your
*local* machine, open the printed URL in your local browser, approve, and
the same listener on the remote machine captures the redirect through the
tunnel. There's no separate device-code flow: Google's Device
Authorization Grant doesn't support Gmail or Contacts scopes on any
client type, so it can't be used here — this port-forward is the
loopback flow completing from wherever your actual browser lives, not a
different OAuth mechanism.

## Security

Credentials are **machine-bound**, not just encrypted. The actual encryption
key lives in your OS's native credential store (macOS Keychain, Windows
Credential Manager, Linux Secret Service via `keytar`) — never in the config
directory itself. Copying `accounts.json` to another machine gets an
attacker ciphertext with no usable key anywhere near it; `mailman` on that
other machine will refuse to decrypt and ask you to reconfigure instead of
degrading to a weaker mode.

> Linux headless caveat: this requires a running Secret Service provider
> (gnome-keyring, kwallet, etc.). On a headless box with no keyring daemon,
> setup will fail with instructions rather than silently falling back to
> plaintext storage. Full per-OS support matrix (macOS Keychain, Windows
> Credential Manager, Linux Secret Service, WSL) and the verification
> checklist: [docs/CROSS-OS.md](docs/CROSS-OS.md).

Every tool call is also appended to a local `activity.log` (tool name,
account, non-sensitive metadata only — never bodies/credentials) for audit
purposes.

## Config location

All state (accounts, contacts/recents, settings) lives in one global,
per-OS-user directory — never inside a project folder or `cwd`:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/mcp-mailman/` |
| Linux | `~/.config/mcp-mailman/` |
| Windows | `%APPDATA%\mcp-mailman\` |

## License

MIT
