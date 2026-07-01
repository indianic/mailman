# mailman (`mcp-mailman`)

An MCP server that lets any Claude CLI session send **and read** email — with
attachments, a preview/confirmation step before anything actually goes out,
multi-account support, recipient auto-suggestion, and inbox
listing/search/read. Pure Node.js, so it runs the same way on macOS, Linux,
and Windows. Configured once, globally, and available from any project you
run Claude in — not tied to a single repo.

It is an **MCP server**, not a typed CLI — Claude calls its tools from
natural language ("mailman, send this," "list my last 10 emails"), the same
way in any project, since it's registered globally rather than per-project.

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
- **Cross-OS smoke test** (Linux/Windows) — only macOS was available.
- **`npm publish`** — a real, public, hard-to-reverse action.
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

## Install

```bash
# one-time setup — add your first account (App Password or OAuth2)
npx mcp-mailman init

# register with Claude CLI (global, not project-scoped)
claude mcp add mailman -- npx -y mcp-mailman
```

`mcp-mailman register` prints that second line again any time you need
it. `mcp-mailman doctor` checks Node version, OS keyring reachability,
SMTP/IMAP network reachability, and scheduled-send ticker status — run it
first if something's not working. See [docs/CLI.md](docs/CLI.md) for
every terminal command (accounts, contacts, settings, scheduled sends).

## OAuth2 setup (optional — App Password is faster)

App Password (`mcp-mailman init`, choosing App Password) needs nothing
beyond 2-Step Verification and a generated 16-character password — start
there unless you specifically need OAuth2 (a Workspace admin disabling
app passwords, or you want Google Contacts–backed recipient suggestions).

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
5. Run `mcp-mailman auth login <alias>` (or `account add`, choosing
   OAuth2) and paste in the Client ID/Secret when prompted. A browser
   opens automatically to Google's consent screen — approve, and mailman
   captures the redirect and stores the refresh token (encrypted) for you.

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
> plaintext storage.

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
