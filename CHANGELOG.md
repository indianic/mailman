# Changelog

All notable changes to this project will be documented in this file.
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
