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

## Status

Phases 0–4 complete (project setup, core send + draft/confirm, attachment
resolution, security hardening, OAuth2 auth) — see [docs/PLAN.md](docs/PLAN.md)
for the architecture and [docs/CHECKLIST.md](docs/CHECKLIST.md) for the build
order. Phase 5 (multi-account + settings) is next.

## Docs

- [CONTEXT.md](CONTEXT.md) — start here: condensed overview, status, key decisions
- [docs/PLAN.md](docs/PLAN.md) — full architecture: auth, storage, tools, flows
- [docs/SKILLS.md](docs/SKILLS.md) — the MCP tools this server exposes ("skills"), called by Claude
- [docs/CLI.md](docs/CLI.md) — the terminal commands you run yourself (setup, accounts, diagnostics)
- [docs/CHECKLIST.md](docs/CHECKLIST.md) — phased implementation checklist

## Install (once implemented)

```bash
# one-time setup — add your first account (App Password or OAuth2)
npx mcp-mailman init

# register with Claude CLI (global, not project-scoped)
claude mcp add mailman -- npx -y mcp-mailman
```

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
