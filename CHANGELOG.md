# Changelog

All notable changes to this project will be documented in this file.
## [0.4.2] - 2026-07-02

- help, examples, and error messages now render in the same diamond-tree design as every other command (only --version and bare register stay plain, for scripts and copy-paste).

## [0.4.1] - 2026-07-02

- Interactive commands (init, account add, auth login, rotate-key, register -i) now print a clear 'needs a real terminal' message when run without a TTY (AI-tool shells, pipes, CI) instead of crashing with ERR_TTY_INIT_FAILED.

## [0.4.0] - 2026-07-02

- New 'mailman update' self-update command (alias: upgrade); typo suggestions on unknown commands; bare 'mailman' at a terminal now shows help instead of silently starting the stdio server.

## [0.3.3] - 2026-07-02

- New 'mailman help [command]' and 'mailman examples' subcommands — people type these as commands, not flags.

## [0.3.2] - 2026-07-02

- MCP initialize handshake now reports the real package version (was hardcoded 0.1.0).

## [0.3.1] - 2026-07-02

- Friendly 'requires Node >= 18' message on old Node instead of a cryptic ERR_UNSUPPORTED_ESM_URL_SCHEME crash (surfaced by a real 'mailman init' run on an old shell node).

## [0.3.0] - 2026-07-02

- Primary CLI command is now 'mailman' (e.g. 'mailman init', 'mailman register --tools claude,cursor'); 'mcp-mailman' kept as an alias for hosts where GNU Mailman owns /usr/bin/mailman. All help/usage/docs updated.

## [0.2.0] - 2026-07-02

- init now auto-writes MCP config into your AI tools (Claude Code, Cursor, Gemini CLI, Windsurf, Codex) with a multi-select + scope prompt, ContextBrain-style; new register --tools/-i for scripted or interactive re-registration.

## [0.1.2] - 2026-07-02

- Fix all package references to @indianic/mailman (the old mcp-mailman name 404s) — critically the scheduled-send ticker's npx command, which would have silently failed every scheduled send. README setup overhauled with quick-start wizard, private-registry install, and per-editor MCP config sections.

## [0.1.1] - 2026-07-02

- Add author field (kalpesh); harden release script by removing a risky install-based verification step that had corrupted package.json with a circular self-dependency.

## [0.1.0] - 2026-07-02

- Renamed to @indianic/mailman for the IndiaNIC private registry — scoped so ~/.npmrc's routing resolves it automatically without forcing the private registry across mailman's public dependencies.

## [0.1.0] - 2026-07-02

- First IndiaNIC private-registry release — Gmail send/read MCP server (App Password + OAuth2), draft/confirm safety, scheduled sends, per-account signatures/display names, and a unified terminal-tree CLI output convention.
