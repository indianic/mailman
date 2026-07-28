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

### Why the mirror is tagged, not the local commit

`sync-github.sh` rebuilds a package-only tree in a throwaway worktree and tags
**that** filtered commit. Tagging the local commit would publish `INTERNAL.md`,
`scripts/` and `docker/` to a public repo. `./scripts/release` always goes
through it, so this is handled — it only matters if you tag by hand.

The internal `@indianic/mailman` build is published separately with
`./scripts/release-indianic`; `./scripts/release` covers the public package only.
