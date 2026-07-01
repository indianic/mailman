# mailman — Context

Start here. This is the condensed orientation doc — everything below is
explained in full depth in `docs/`; this file exists so a human or an AI
session picking up this repo cold doesn't have to read all four docs before
understanding what mailman is and why it's built the way it is.

## What it is

`mcp-mailman` is a standalone MCP server (its own npm package, its own repo
— not part of any other project) that lets any Claude CLI session send,
read, search, and schedule email through Gmail, with recipient suggestions
and multi-account support. Registered globally, so it works the same way
from any project directory on macOS, Linux, or Windows — not something you
set up per-repo.

## Status

**All 10 phases (0–9) complete and committed**, plus one post-launch
addition. See [docs/CHECKLIST.md](docs/CHECKLIST.md) for the full
phase-by-phase build order and exactly what's been verified vs. what's
still pending.

- **Verified for real**: registered globally via `claude mcp add`, a real
  Gmail App Password account configured, an actual send + read confirmed
  against a live inbox. That real test caught and fixed a bug
  fake-credential smoke tests couldn't (IMAP wasn't decoding
  quoted-printable body content — fixed in commit `5bb70a4`).
- **Post-launch additions**: `get_mailbox_overview` — a single-call
  sent+inbox snapshot with attachment metadata resolved, added after
  repeatedly composing several tool calls by hand in conversation.
  Per-account `displayName`/`signature` (surfaced via `configure_account`,
  `update_account_profile`, and `list_accounts`) and a global
  `defaultBodyType` setting — `draft_email` now sends a proper
  `"Name <email>"` From header and appends the account's signature, and
  falls back to `defaultBodyType` when a call omits `bodyType`.
- **Still pending, deliberately not done automatically**: OAuth2
  real-delivery verification (needs a real Google Cloud OAuth client),
  cross-OS smoke testing (no Linux/Windows machine was available),
  `npm publish` (a real, public, hard-to-reverse action), and actually
  registering the scheduled-send OS ticker on a real machine (mutates
  real system state outside this repo — `schedule_send` installs it the
  first time it's actually used).

## Repo facts

| | |
|---|---|
| Location | `/Users/kalpesh/Sites/IndiaNIC/Products/mailman/` (sibling to `sshmanager`, not nested in it) |
| Branch | `dev-kalpesh` (all work happens here; `master` is the empty initial branch) |
| Remote | none configured — commits are local-only until explicitly told to push |
| Package name | `mcp-mailman` (npm, unpublished) |
| Bin name | `mcp-mailman` — deliberately *not* a bare `mailman`, since GNU Mailman already owns that binary name on many Linux servers |

## The decisions that shape everything else

- **MCP tools vs. CLI commands are a hard split.** Anything Claude can call
  conversationally (send, read, search, suggest contacts) is an MCP tool.
  Anything destructive, credential-sensitive, or browser-dependent (account
  setup, OAuth2 login, key rotation, reset) is a terminal-only CLI command,
  never LLM-callable. See [docs/SKILLS.md](docs/SKILLS.md) vs
  [docs/CLI.md](docs/CLI.md).
- **Nothing sends without a human seeing a preview first.** Every send is
  `draft_email` (builds a preview, does not send) → `confirm_send` (the only
  tool that actually dispatches mail). `confirm_send` is idempotent so a
  retried call can't double-send.
- **Config is global, never project-relative.** One config directory per OS
  user (`~/Library/Application Support/mcp-mailman/` etc.), resolved via
  `os.homedir()`, never `cwd`. Configure once per machine, works from every
  project.
- **Credentials are machine-bound, not just encrypted.** The AES key lives
  in the OS keychain (via `keytar`), never in the config directory itself —
  copying `accounts.json` to another machine gets an attacker useless
  ciphertext.
- **`settings.json`'s `defaultAccount` is the single source of truth** for
  which account is default — accounts never carry their own `isDefault`
  flag. An earlier version drifted from this (a redundant per-account flag)
  before it was caught and fixed.
- **Every MCP response is JSON in a text block**, matching the convention
  already used by this developer's other MCP server
  (`sshmanager/mcp-server/src/types.ts`) — host-agnostic, works the same
  whether the caller is Claude Code, Cursor, or Windsurf.
- **Both Gmail auth methods are supported per-account** (App Password or
  OAuth2), behind one `MailProvider` interface so tools never branch on
  which method an account uses.
- **`auth login` is loopback-redirect only — there is no device-flow
  fallback.** Google's Device Authorization Grant doesn't support
  Gmail/Contacts scopes on any client type, so it was checked against
  Google's live docs and ruled out before being built. When no local
  browser is reachable (SSH, headless, container), `auth login` prints the
  consent URL plus an `ssh -L` port-forward command instead — same
  loopback listener, just opened from wherever the real browser lives.
- **Scheduled sends don't rely on the MCP process staying alive.** The MCP
  server is an ephemeral stdio process, not a daemon, so "send this
  tomorrow" is persisted to disk (`scheduled.json`, encrypted like
  `accounts.json`) and fired by one OS-level scheduler job per machine
  (launchd/cron/Task Scheduler), not a JS timer that dies with the Claude
  Code session. One-time schedules only — no recurring sends.

## Full docs

- [README.md](README.md) — pitch, install, usage examples
- [docs/PLAN.md](docs/PLAN.md) — the full architecture (this file's source material)
- [docs/SKILLS.md](docs/SKILLS.md) — every MCP tool, called by Claude
- [docs/CLI.md](docs/CLI.md) — every terminal command, run by you
- [docs/CHECKLIST.md](docs/CHECKLIST.md) — the phased build order
