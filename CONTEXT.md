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

It exposes **25 MCP tools** and ships as `@integratex/mailman` on the public
npm registry (currently **1.2.1**). The tool list lives in
[docs/SKILLS.md](docs/SKILLS.md); the human CLI is in
[docs/CLI.md](docs/CLI.md).

## Status

**All 10 phases (0–9) complete and committed**, plus the post-launch
additions listed below. See [docs/CHECKLIST.md](docs/CHECKLIST.md) for the
full phase-by-phase build order and exactly what's been verified vs. what's
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
- **Session reports (1.2.0)**: `list_sessions` and `read_session_digest`
  read the *host's own* transcripts (`~/.claude/projects/**/*.jsonl`) so a
  session — or a week of them — can be turned into an email. Neither tool
  summarizes: they index and extract, the calling Claude session composes,
  and it sends through the usual `draft_email` → preview → `confirm_send`
  flow. The extractor drops every tool RESULT, which is both the bulk of a
  transcript's bytes and where pasted secrets land, then redacts known token
  shapes. Also `mailman session list` / `session report` on the CLI, which
  print a *mechanical* digest (files, commits, counts) because the CLI has
  no model — see [docs/CLI.md](docs/CLI.md).
- **Tool-schema hardening (1.2.1)**: all 25 schemas now declare
  `additionalProperties: false` and an explicit `required` array, and every
  parameter carries a description. Both fields are required by
  `ToolDefinition`, so the compiler — not a reviewer — rejects a new tool
  that omits them.
- **`mailman doctor` dependencies + `--fix` (1.2.1)**: doctor reported that
  the keyring was unreachable but never *why*, and on Linux there are two
  causes needing different fixes. It now checks `npm` and, on Linux only,
  `libsecret`; `--fix` prints the exact platform command, distinguishing a
  missing library from a missing Secret Service daemon.
- **Since resolved**: `npm publish` has happened — `@integratex/mailman` is
  on the public registry, currently 1.2.1, with matching GitHub releases.
  The scheduled-send ticker is installed on the development machine
  (`mailman doctor` reports `installed (launchd)`). Linux is covered by
  `docker/test-linux.sh`, which runs the checklist twice — once with
  gnome-keyring up and once headless — see [docs/CROSS-OS.md](docs/CROSS-OS.md).
- **Still pending, deliberately not done automatically**: OAuth2
  real-delivery verification (needs a real Google Cloud OAuth client) and
  **Windows** verification. Windows containers require a Windows host, so no
  amount of Docker on macOS or Linux substitutes for it — that needs either
  real hardware or a `windows-latest` CI runner.

## Repo facts

| | |
|---|---|
| Location | `/Users/kalpesh/Sites/IndiaNIC/Products/mailman/` (sibling to `mailman-site`, which is its own repo) |
| Branch | `main` |
| Remotes | `origin` → GitLab (`gitai.indianic.com:server7_development/mailman`) · `github` → the public mirror (`github.com/indianic/mailman`), pushed by `scripts/sync-github.sh` with `site/`, `docker/`, `scripts/` and `INTERNAL.md` stripped |
| Package name | `@indianic/mailman` in the committed `package.json` (the internal identity, published to `npm.indianic.in`). CI **rewrites it to `@integratex/mailman` before `npm publish`** for the public build — the code reads its own name at runtime, so the rename has to happen before the tarball is packed |
| Bin name | `mailman` (primary), with `mcp-mailman` kept as an alias to the same binary — the alias exists for hosts where GNU Mailman already owns `/usr/bin/mailman` and the bare name would collide |

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
- [docs/CROSS-OS.md](docs/CROSS-OS.md) — what is verified on which OS, and what is only implemented

## How this is verified

`npm test` is the committed suite — 237 cases, offline, fast.

Three further tiers exist on the maintainer's machine only and are **not in this
repository**; they are described in `INTERNAL.md`, which is stripped from the
public mirror along with them.
