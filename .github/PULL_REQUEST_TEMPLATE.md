<!--
Thanks for the PR. Keep it to one concern — a refactor bundled with a fix is
harder to review and harder to revert.
New here? Read CONTRIBUTING.md, and docs/PLAN.md for why the CLI and MCP tool
surfaces are separate. That split is the decision most PRs bump into.
-->

## What changed, and why

<!-- One or two sentences. What was wrong or missing, and what this does about it. -->

Closes #

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Docs only
- [ ] Refactor / internal (no behaviour change)
- [ ] Breaking change

## Checklist

- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] Added or updated a test in `test/` for this change
- [ ] Updated the docs that describe it — `docs/SKILLS.md` for a tool,
      `docs/CLI.md` for a command, `docs/PLAN.md` for a new error code
- [ ] No credentials, tokens, or real message content in the diff or tests

## If this touches the tool surface

<!-- Delete this section if it doesn't. -->

- [ ] It does **not** add a way to send mail without a confirmed draft
- [ ] It does **not** expose credential rotation or export as an MCP tool
- [ ] New errors are structured `{ code, message }` and the code is documented

## How you tested it

<!--
Unit tests are the baseline. Say if you verified against a real inbox, and on
which OS — real-world verification across macOS/Linux/Windows is scarce here
and genuinely valuable.
-->
