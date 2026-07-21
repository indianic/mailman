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
