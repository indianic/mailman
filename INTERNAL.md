# Internal install (IndiaNIC private registry)

> ⚠️ **IndiaNIC-internal only — this file is excluded from the GitHub mirror.**
> The public README documents the npmjs build **`@integratex/mailman`**; all
> public-facing docs must reference that package. The private-registry build
> below (`@indianic/mailman` on `npm.indianic.in`) is for internal
> infrastructure only.

Point the `@indianic` scope at the private registry, then install globally with
**npm** or **pnpm**:

```
# npm
npm config set @indianic:registry https://npm.indianic.in
npm install -g @indianic/mailman

# pnpm
pnpm config set @indianic:registry https://npm.indianic.in
pnpm add -g @indianic/mailman
```

(The scope config lands in your `~/.npmrc` — which npm, pnpm, and yarn all
read — so no `--registry` flag is needed and public dependencies still resolve
from the public registry. `mailman update` later upgrades in place with
whichever manager you used.)

## Two distributions, one codebase

| | Package | Registry | Audience |
|---|---|---|---|
| Public | `@integratex/mailman` | [npmjs.com](https://www.npmjs.com/package/@integratex/mailman) | everyone (GitHub visitors) |
| Internal | `@indianic/mailman` | `npm.indianic.in` | IndiaNIC infrastructure |

MCP registration on internal machines uses the internal package:

```
claude mcp add mailman -- npx -y @indianic/mailman
```

## The local-only verification tiers

`npm test` is the committed suite. Three further tiers live on the maintainer's
machine and are **deliberately not in the repository** — they are excluded via
`.git/info/exclude` rather than `.gitignore`, because editing the tracked
`.gitignore` would itself be a change to commit, which defeats "local only".
Nothing in `package.json` or CI references them either, so the commands below
are the entry points.

That also means they never reach the public GitHub mirror — not because
`scripts/sync-github.sh` strips them (it strips `site/`, `docker/`, `scripts/`
and this file), but because they were never tracked to begin with.

| Tier | Command | Question it answers | Needs |
|---|---|---|---|
| `eval/` | `npx tsx --test eval/*.eval.ts` | Is the surface we hand a model or a person still correct, safe and self-consistent — and are our stated claims still true? | Nothing — offline, <1s, **111 static rubrics** |
| `smoke/` | `npx tsx --test smoke/*.test.ts` | Does the actual published tarball install and work on a real OS? | Docker + network |
| watchable | `./smoke/check-terminal.sh` | The same question as `smoke/`, but in a window you can watch — and with a real TTY, so colour and the diamond tree are what a user actually sees | macOS + a live install |

```bash
npx tsx --test eval/*.eval.ts              # the fast rubrics
npx tsx --test smoke/linux-container.test.ts   # npm pack → clean Linux box
./smoke/check-terminal.sh --build          # watch the CLI run, against dist/
./smoke/check-terminal.sh --docker         # all 31 commands, in the container
node smoke/record-cast.mjs --redact        # a shareable PTY recording + player
```

**Before sharing anything these produce**, pass `--redact`. A recording of a
live install is a recording of a real mailbox: `account list` prints every
configured address and `contacts list` prints the whole address book. The
masking is length-preserving so the column alignment the artefact exists to show
is not itself altered, and both the recorder and the image renderer verify their
own output afterwards and refuse to claim success if anything survived.

`eval/README.md` lists the suites; `eval/PLAN.md` explains what the tier is
organised around and what is deliberately left out of it.

## Releasing

Bump, then ship — two commands:

```
npm version patch          # also creates the matching git tag
./scripts/release          # npmjs + GitHub mirror + GitHub Release
```

`./scripts/release --dry-run` rehearses the whole thing without publishing,
pushing or creating anything. `--skip-npm` / `--skip-github` narrow it.

Every step detects whether it is already done and skips it, so **re-running
after a failure resumes** rather than starting over. This matters: an npm
version can never be republished, so a failure at the mirror step must not
force a retry of the publish.

Preflight refuses a dirty tree, and refuses a `vX.Y.Z` tag that isn't at HEAD —
otherwise the Release page would point at code that isn't what users installed.
Note that a tag has to be moved (`git tag -f vX.Y.Z`) if you commit anything
after the version bump, including changes to `scripts/` itself.

### Credentials

Neither lives on this machine by default, and both fail misleadingly:

| | Symptom | Fix |
|---|---|---|
| npmjs | expired `~/.npmrc` token reports as `E404 Not Found - PUT`, not a 401 | the script runs `npm login` for you (needs a terminal + browser) |
| GitHub | `403` that looks like a missing scope | it's an *access* problem — `kalpeshgamit` has `push: false` on the org repo. Use a token from an account with write access; no scope fixes it |

Pass the GitHub token as `GH_TOKEN=<token> ./scripts/release`, or let the script
prompt (input is never echoed and never written to disk).

### Releasing without prompts — `scripts/release-auto`

`./scripts/release` stops twice on a normal machine: `npm publish` under 2FA fails
with `EOTP` and a browser URL, and GitHub has no token. `release-auto` wraps it and
supplies both from a file, then hands off — every preflight, skip-if-done and
ordering guarantee in `release` still applies.

```bash
mkdir -p ~/.config/mailman-release
$EDITOR ~/.config/mailman-release/env      # NPM_TOKEN=... and GH_TOKEN=...
chmod 600 ~/.config/mailman-release/env
./scripts/release-auto                     # or --dry-run to just prove the tokens work
```

Read from `$MAILMAN_RELEASE_ENV`, then `~/.config/mailman-release/env`, then
`<repo>/.release-env` (gitignored). Outside the repo is the default on purpose —
a file in the working tree is one `git add -f` or one copied directory away from
somewhere you did not intend.

**`NPM_TOKEN` must be an *Automation* token.** It is the only npm token type that
bypasses 2FA for publishing; a Publish or read-only token still demands an OTP.
The npm credential is injected through a 0600 temp npmrc (a copy of `~/.npmrc`
plus the token) that is deleted on every exit path — nothing is ever written to
`~/.npmrc`, the repo, or anything that outlives the run. `release-auto` therefore
must not `exec` the release script: `exec` replaces the process and the cleanup
trap never fires, which left a live token in `/tmp` after every run until it was
caught.

Both tokens are verified before anything is packed — a bad npm token otherwise
surfaces as `E404 Not Found - PUT`, and a wrong-account GitHub token as a `403`
that reads like a missing scope.

> Automation tokens are on borrowed time — that is the deprecation notice `npm
> login` prints. The durable replacement is Trusted Publishing (OIDC) from a
> workflow: no token at all, nothing to leak or expire. Note that
> `sync-github.sh` excludes `.github/workflows` by default, so the mirror
> currently runs no Actions at all; OIDC would need that changed too.

### Why the mirror is tagged, not the local commit

`sync-github.sh` rebuilds a package-only tree in a throwaway worktree and tags
**that** filtered commit. Tagging the local commit would publish `INTERNAL.md`,
`scripts/` and `docker/` to a public repo. `./scripts/release` always goes
through it, so this is handled — it only matters if you tag by hand.

The internal `@indianic/mailman` build is published separately with
`./scripts/release-indianic`; `./scripts/release` covers the public package only.
