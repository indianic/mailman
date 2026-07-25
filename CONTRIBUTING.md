# Contributing to mailman

Thanks for taking the time. mailman is a small, focused MCP server, and that's
deliberate — the bar for a change is "does this make sending or reading mail
from an AI session better," not "is this more features."

You do **not** need to write code to help. A clear bug report with the output
of `mailman doctor` is genuinely one of the most useful things you can send.

- 🐞 [Report a bug](https://github.com/indianic/mailman/issues/new?template=bug_report.yml)
- 💡 [Request a feature](https://github.com/indianic/mailman/issues/new?template=feature_request.yml)
- 💬 [Ask a question / discuss an idea](https://github.com/indianic/mailman/discussions)

---

## Reporting an issue

Open an issue and include, at minimum:

1. **What you asked your AI**, and what happened instead.
2. **The output of `mailman doctor`** — it reports your OS, Node version,
   keychain reachability, Gmail SMTP/IMAP reachability, and a live login check
   per account. It's usually enough to diagnose the problem on its own.
3. **Which AI tool** you're using (Claude Code, Cursor, Gemini CLI, Windsurf,
   Codex, or a manually-configured host) and its version.
4. **The error code** if you saw one — mailman returns structured errors like
   `AMBIGUOUS_ACCOUNT`, `DRAFT_EXPIRED`, `VERIFICATION_FAILED`. The code
   matters more than the message text.

> ⚠️ **Never paste credentials.** `mailman doctor` is safe to share — it prints
> no secrets. But redact email addresses and message subjects if they're
> sensitive, and never include an App Password, OAuth2 client secret, or
> refresh token in an issue. If a bug can only be shown with real credentials,
> say so in the issue and we'll find another way.

### Security issues

If you've found something with security impact — credential exposure, a way to
send mail without confirmation, a path traversal in attachment resolution —
**do not open a public issue.** Email
[kalpesh.gamit@indianic.com](mailto:kalpesh.gamit@indianic.com) instead, and
we'll coordinate a fix and disclosure.

---

## Local setup

Requires **Node.js ≥ 18** (CI runs 20). On Linux you also need libsecret's
headers so `keytar`'s native module can build:

```bash
sudo apt-get install -y libsecret-1-dev   # Debian/Ubuntu
```

Then:

```bash
git clone https://github.com/indianic/mailman.git
cd mailman
npm install
```

## The development loop

Four scripts, and CI runs all of them plus a build:

```bash
npm run dev         # run the MCP server from source (tsx)
npm run lint        # eslint
npm run typecheck   # tsc --noEmit, strict
npm test            # node --test via tsx, over test/*.test.ts
npm run build       # tsc → dist/
```

Run `npm run lint && npm run typecheck && npm test` before you push. That's
exactly what CI checks, so a green local run means a green PR.

### Trying your change in a real AI session

`npm run dev` starts the server against your source, but your editor launches
mailman via `npx`. To point an editor at your working copy instead:

```bash
npm run build
npm link                 # makes your local build the global `mailman`
mailman register -i      # re-register so editors pick it up
```

Restart the AI tool afterwards — MCP servers are spawned per session, so a
running session keeps the old binary.

---

## Making a change

1. **Fork** the repo and branch from `main`. Name the branch for the change:
   `fix/imap-quoted-printable`, `feat/outlook-transport`.
2. **Keep it focused.** One concern per PR. A drive-by refactor bundled with a
   bug fix makes the fix harder to review and harder to revert.
3. **Add or update a test.** `test/` mirrors `src/` — a change to
   `src/mail/templates.ts` belongs with `test/templates.test.ts`. Tests are
   plain `node --test`, no framework to learn.
4. **Update the docs that describe what you changed** (see the map below).
   A new MCP tool that isn't in `docs/SKILLS.md` is only half-done.
5. **Open a pull request** against `main` and fill in the template. Say what
   changed and why; link the issue it closes.

CI must be green before review. If it fails on something unrelated to your
change, say so in the PR — don't fight it alone.

### Read this first

**[`docs/PLAN.md`](docs/PLAN.md)** explains the architecture, and in particular
*why the CLI and the MCP tool surface are separate*. That split is the decision
most PRs bump into, so it's worth ten minutes before you write code:

- **MCP tools** (`src/tools/`) — what an AI calls. Everyday mail: draft, send,
  read, search, schedule.
- **CLI commands** (`src/cli/`) — what a human types. Setup, credentials,
  diagnostics, anything destructive.

Anything credential-sensitive, destructive, or requiring a browser stays on the
CLI side, deliberately out of reach of a model that could be talked into
calling it. **A PR that adds an MCP tool for sending mail without a confirmed
draft, or for rotating/exporting keys, will be declined** — that's the product,
not an oversight.

### Where things live

| Path | What it is |
|---|---|
| `src/tools/` | One file per MCP tool |
| `src/cli/` | One file per CLI command; shared output vocabulary in `tree.ts` |
| `src/mail/` | Transport (SMTP/IMAP, Gmail API), composition, templates |
| `src/auth/` | App Password + OAuth2 flows |
| `src/config/` | Encrypted storage, per-OS config paths |
| `test/` | `node --test` suites, mirroring `src/` |
| `docs/SKILLS.md` | Every MCP tool: input, output, error codes |
| `docs/CLI.md` | Every CLI command and flag |
| `docs/FEATURES.md` | Plain-English + technical feature tour |
| `docs/PLAN.md` | Architecture and design rationale |
| `docs/CROSS-OS.md` | Per-OS support matrix |

### Conventions worth knowing

- **TypeScript, strict.** No `any` escapes; `npm run typecheck` is not optional.
- **Tools return plain JSON.** Never host-specific formatting — rendering is
  the AI's job, so any MCP host can display it its own way.
- **Errors are structured** `{ code, message }`, so a model can branch on
  `code`. Add a new code to the table in `docs/PLAN.md` when you introduce one.
- **CLI output goes through `src/cli/tree.ts`** (`section`/`check`/`detail`/
  `fail`/`info`/`attention`) — not `console.table()`, not `JSON.stringify()`,
  not bare `process.stdout.write()`. Three commands are deliberately exempt;
  `docs/SKILLS.md` explains which and why.
- **Never log message bodies or credentials.** `activity.log` records tool
  names and non-sensitive metadata only.

---

## Good first contributions

- A new **message template** or template category in `src/mail/templates.ts` —
  it's plain data, and `test/templates.test.ts` shows the shape.
- **Another AI tool** in the register command — add an entry to `EDITORS` in
  `src/cli/editor-config.ts` and a case to `test/editor-config.test.ts`.
- A **`docs/CROSS-OS.md` note** for a distro or Windows version you've actually
  tested on. Real-world verification is genuinely scarce here.
- **Docs fixes.** If something read as confusing to you, it will to the next
  person.

## Releasing

Maintainers only. `.github/workflows/npm-publish.yml` handles publication;
version bumps follow semver and land in `CHANGELOG.md`.

## Licence

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE) that covers the project.
