# Changelog

All notable changes to this project will be documented in this file.
## [0.9.2] - 2026-07-03

- fix: OAuth2 redirect_uri_mismatch guidance (Desktop-app requirement) + 5-min consent timeout instead of hang

## [0.9.1] - 2026-07-03

- fix: OAuth Client ID/Secret now required (no more 'undefined' + empty-credential consent); guard optional profile fields

## [0.9.0] - 2026-07-03

- feat: init/account add offer browser sign-in (OAuth2) as a choice alongside App Password

## [0.8.1] - 2026-07-03

- fix: verify loop no longer traps users — retry/save-anyway/cancel choice, 16-char hint, Google temp-block detection

## [0.8.0] - 2026-07-03

- feat: verify credentials in configure_account before storing; live per-account login check in doctor

## [0.7.0] - 2026-07-03

- feat: verify Gmail credentials at init/account add with retry loop; npm+pnpm-aware update

## [0.6.2] - 2026-07-03

- docs: restructure README to clean Title/Features/Installation/Usage format

## [0.6.1] - 2026-07-03

- fix: confirm_send now enforces alwaysConfirm — refuses to send unless confirm:true is passed (real confirmation gate; previously the setting was ignored)

## [0.6.0] - 2026-07-03

- feat: **message templates** — new `list_templates` tool (182 templates across ~20 categories, filterable by `category`/`search`; core set by default) and an optional `template` param on `draft_email`. Most templates are a subject prefix + a structural hint Claude composes from (mailman stays dumb); `fwd`/`reply` are mechanical and build a real Gmail-style quoted block from `forwarded*` fields.
- feat: **subject improvement** — template prefixes are applied de-duplicated (never `FYI: FYI:` / `Re: Re:`).
- feat: **polished email theme** — opt-in `settings.emailTheme` (`plain`|`polished`) + per-call `theme` param wraps HTML bodies in a clean, minimal shell.
- change: **HTML is now the default body type** for new installs / configs without the field set. Existing configs that explicitly stored `text` are untouched — flip with `mailman settings set defaultBodyType html`.
- Total MCP tools: **23** (added `list_templates`).

## [0.5.6] - 2026-07-02

- compact draft preview (token savings), desktopNotifications settable via MCP tools, FEATURES.md + docs close-out

## [0.5.5] - 2026-07-02

- change: desktop notifications now on by default (disable via settings); simplified to reliable osascript path; toggle added to 'mailman examples'

## [0.5.4] - 2026-07-02

- feat: opt-in native desktop notifications on send (macOS/Linux/Windows), with a branded macOS notification icon via a generated mailman.app bundle

## [0.5.3] - 2026-07-02

- feat(cli): passive 'update available' notifier — cached, non-blocking, TTY-only notice shown before command output when a newer version is published

## [0.5.2] - 2026-07-02

- Sent messages are now branded for easy tracking: Message-ID local part is mcp-mailman.<uuid> and an X-Mailer: mcp-mailman header is set on every send (both App Password and OAuth2).

## [0.5.1] - 2026-07-02

- init/account add no longer ask App Password vs OAuth2 — they go straight into the simple email + App Password flow. OAuth2 stays available via 'mailman auth login <alias>' for Workspace/contacts cases.

## [0.5.0] - 2026-07-02

- New 'mailman account profile' command: view/set/clear your From Name and email signature from the terminal (--name, --signature with \n support, --clear-*); account list now shows the From Name; help/examples document it.

## [0.4.5] - 2026-07-02

- Scheduled-send ticker fix: launchd/cron jobs now carry a PATH that includes node's bin dir — without it every tick failed to find npx (launchd/cron don't inherit the shell PATH).

## [0.4.4] - 2026-07-02

- Tight spacing everywhere: doctor restructured under one ◆ checks section, and all remaining error/info/warning messages (usage errors, update failures, OAuth guidance) now render tight tree rows instead of padded clack log output.

## [0.4.3] - 2026-07-02

- Tightened diamond-tree spacing: rows attach directly (no more double-spacing), blank connector only before each section header — matching the reference design.

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
