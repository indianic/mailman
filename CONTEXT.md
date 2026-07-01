# mailman — Context

Start here. This is the condensed orientation doc — everything below is
explained in full depth in `docs/`; this file exists so a human or an AI
session picking up this repo cold doesn't have to read all four docs before
understanding what mailman is and why it's built the way it is.

## What it is

`mcp-mailman` is a standalone MCP server (its own npm package, its own repo
— not part of any other project) that lets any Claude CLI session send and
read email through Gmail. Registered globally, so it works the same way
from any project directory on macOS, Linux, or Windows — not something you
set up per-repo.

## Status

**Planning complete. No implementation yet.** Everything in `src/` described
in the docs is still to be written — Phase 1 (App Password send path +
draft/confirm flow) is the next concrete step. See
[docs/CHECKLIST.md](docs/CHECKLIST.md) for the full 9-phase (0–8) build
order.

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
  never LLM-callable. See [docs/TOOLS.md](docs/TOOLS.md) vs
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
- **Every MCP response is JSON in a text block**, matching the convention
  already used by this developer's other MCP server
  (`sshmanager/mcp-server/src/types.ts`) — host-agnostic, works the same
  whether the caller is Claude Code, Cursor, or Windsurf.
- **Both Gmail auth methods are supported per-account** (App Password or
  OAuth2), behind one `MailProvider` interface so tools never branch on
  which method an account uses.
- **`auth login` has a headless fallback.** Local-browser loopback redirect
  by default; falls back to the OAuth Device Authorization Grant (print a
  URL + code, poll in the background) when no local browser is reachable —
  SSH sessions, containers, headless boxes. No manual code paste-back
  either way (Google removed that flow in 2022).

## Full docs

- [README.md](README.md) — pitch, install, usage examples
- [docs/PLAN.md](docs/PLAN.md) — the full architecture (this file's source material)
- [docs/TOOLS.md](docs/TOOLS.md) — every MCP tool, called by Claude
- [docs/CLI.md](docs/CLI.md) — every terminal command, run by you
- [docs/CHECKLIST.md](docs/CHECKLIST.md) — the phased build order
