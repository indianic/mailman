#!/usr/bin/env bash
#
# Regenerate the package-only tree and push it to GitHub (indianic/mailman),
# then (optionally) create a stable-v* tag to trigger the GitHub Release.
#
# GitLab (origin) remains the full source of truth — site/, docker/ and
# scripts/ are internal-only and are stripped from the GitHub mirror. This
# script never disturbs your working tree: it builds the filtered commit in a
# throwaway git worktree.
#
# Usage:
#   ./scripts/sync-github.sh                 # mirror main -> github:main only
#   ./scripts/sync-github.sh stable-v1.0.0   # mirror + push that stable tag (triggers the Release workflow)
#   SRC_BRANCH=main ./scripts/sync-github.sh stable-v1.2.0
#
set -euo pipefail

TAG="${1:-}"
SRC_BRANCH="${SRC_BRANCH:-main}"
GITHUB_REMOTE="${GITHUB_REMOTE:-github}"
GITHUB_URL="${GITHUB_URL:-https://github.com/indianic/mailman.git}"
# site/docker/scripts are internal-only and always excluded.
EXCLUDE=(site docker scripts)
# .github/workflows is excluded BY DEFAULT because pushing workflow files needs
# a token with the `workflow` scope. When you have such a token, run with
# INCLUDE_WORKFLOWS=1 to ship the workflows (e.g. the npm-publish Action).
if [ -z "${INCLUDE_WORKFLOWS:-}" ]; then
  EXCLUDE+=(.github/workflows)
fi
if [ -n "${EXTRA_EXCLUDE:-}" ]; then
  # shellcheck disable=SC2206
  EXCLUDE+=($EXTRA_EXCLUDE)
fi

# Ensure the github remote exists.
if ! git remote get-url "$GITHUB_REMOTE" >/dev/null 2>&1; then
  git remote add "$GITHUB_REMOTE" "$GITHUB_URL"
fi

# Build the filtered commit in an isolated worktree so the caller's checkout
# and working tree are never touched.
WT="$(mktemp -d)"
cleanup() { git worktree remove --force "$WT" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# When GH_TOKEN is provided, authenticate with it DIRECTLY (bypassing git's
# credential helpers) — otherwise a cached/keyring credential can shadow the
# token and cause a spurious 403. The token is used only for these pushes; it's
# never written to git config.
PUSH_TARGET="$GITHUB_REMOTE"
GIT_PUSH=(git)
if [ -n "${GH_TOKEN:-}" ]; then
  PUSH_TARGET="https://x-access-token:${GH_TOKEN}@github.com/indianic/mailman.git"
  GIT_PUSH=(git -c credential.helper= -c "http.https://github.com/.extraheader=")
fi

git worktree add --quiet --detach "$WT" "$SRC_BRANCH"
(
  cd "$WT"
  git rm -r --quiet "${EXCLUDE[@]}" 2>/dev/null || true
  git commit -q -m "build: package-only tree for GitHub (exclude ${EXCLUDE[*]})"
  "${GIT_PUSH[@]}" push -f "$PUSH_TARGET" HEAD:refs/heads/main
  if [ -n "$TAG" ]; then
    git tag -f "$TAG"
    "${GIT_PUSH[@]}" push -f "$PUSH_TARGET" "$TAG"
  fi
)

echo "Synced package-only tree to $GITHUB_REMOTE:main${TAG:+ and pushed tag $TAG}"
