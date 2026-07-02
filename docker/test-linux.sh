#!/usr/bin/env bash
###############################################################################
# Host orchestrator for the Ubuntu/Linux cross-OS smoke test (task #94).
#
#   ./docker/test-linux.sh
#
# What it does, then cleans up after itself:
#   1. `npm pack` → a hermetic tarball (no npm.indianic.in token in any layer)
#   2. docker build the Ubuntu image
#   3. run the checklist twice: `desktop` (gnome-keyring up via dbus-run-session)
#      and `headless` (no keyring → must fail clean)
#   4. write a timestamped report to docker/reports/
#   5. ALWAYS tear down: remove the image + the packed tarball, prune the
#      build cache this run created (respecting `--keep-image` to skip rmi)
###############################################################################
set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DOCKER_DIR="$PROJECT_DIR/docker"
IMAGE_TAG="mcp-mailman-linux-test:tmp"
KEEP_IMAGE=false
[ "${1:-}" = "--keep-image" ] && KEEP_IMAGE=true

cd "$PROJECT_DIR"
VERSION="$(node -e "console.log(require('./package.json').version)")"
STAMP="$(date +%Y%m%d-%H%M%S)"
REPORT="$DOCKER_DIR/reports/linux-$VERSION-$STAMP.txt"

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
log() { echo -e "${BLUE}==> $1${NC}"; }

cleanup() {
  log "Cleanup..."
  rm -f "$DOCKER_DIR/mailman.tgz" 2>/dev/null && echo "  removed packed tarball"
  if [ "$KEEP_IMAGE" = false ]; then
    docker rmi "$IMAGE_TAG" >/dev/null 2>&1 && echo "  removed image $IMAGE_TAG"
    # Deliberately NOT pruning the build cache: the apt/node base layers are
    # reusable across runs (only the changing tarball layer rebuilds), so
    # keeping them makes the next run fast. Reclaim manually with
    # `docker builder prune` if you need the space back.
  else
    echo "  kept image $IMAGE_TAG (--keep-image)"
  fi
}
trap cleanup EXIT

# 1) hermetic tarball
log "npm pack (hermetic — installs mailman from this tarball, not the registry)"
npm run build >/dev/null 2>&1 || { echo "build failed"; exit 1; }
TARBALL="$(npm pack --silent 2>/dev/null | tail -1)"
mv "$TARBALL" "$DOCKER_DIR/mailman.tgz"
echo "  packed $TARBALL → docker/mailman.tgz"

# 2) build
log "docker build ($IMAGE_TAG)"
docker build -f "$DOCKER_DIR/Dockerfile.ubuntu" -t "$IMAGE_TAG" "$DOCKER_DIR" >/tmp/mailman-docker-build.log 2>&1 \
  || { echo "docker build failed — tail:"; tail -30 /tmp/mailman-docker-build.log; exit 1; }
echo "  built"

# 3) run both modes
{
  echo "mailman Linux cross-OS smoke report"
  echo "package: @indianic/mailman@$VERSION"
  echo "date:    $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "host:    $(uname -sm) · docker $(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')"
  echo "image:   ubuntu:24.04 + node 20"
  echo "========================================================================"
} > "$REPORT"

DESKTOP_RC=0; HEADLESS_RC=0

log "run: desktop (gnome-keyring via dbus-run-session)"
# dbus-run-session brings up a session bus; gnome-keyring unlocks with an empty
# password and registers as the Secret Service, then the checklist runs.
# --entrypoint bash is REQUIRED: the image's ENTRYPOINT is
# `bash /work/run-checklist.sh`, so a plain `docker run IMAGE bash -c …` would
# append "bash -c …" as the script's ARGS ($1="bash") instead of running our
# command — overriding the entrypoint is the only way to wrap it in dbus.
docker run --rm --entrypoint bash "$IMAGE_TAG" -c \
  'dbus-run-session -- bash -c "printf \"\n\" | gnome-keyring-daemon --unlock --components=secrets >/dev/null 2>&1 & sleep 2; bash /work/run-checklist.sh desktop"' \
  2>&1 | tee -a "$REPORT"
DESKTOP_RC=${PIPESTATUS[0]}

echo "" | tee -a "$REPORT"
log "run: headless (no keyring — must fail clean)"
# Simple form works here: the entrypoint is `bash /work/run-checklist.sh`, so
# passing just `headless` makes it $1 — exactly what we want, no override.
docker run --rm "$IMAGE_TAG" headless 2>&1 | tee -a "$REPORT"
HEADLESS_RC=${PIPESTATUS[0]}

# 4) verdict
{
  echo "========================================================================"
  if [ "$DESKTOP_RC" -eq 0 ] && [ "$HEADLESS_RC" -eq 0 ]; then
    echo "RESULT: PASS — desktop + headless paths both green on Ubuntu 24.04 (node 20, arm64)"
  else
    echo "RESULT: FAIL — desktop rc=$DESKTOP_RC, headless rc=$HEADLESS_RC (see PASS/FAIL lines above)"
  fi
} | tee -a "$REPORT"

echo ""
if [ "$DESKTOP_RC" -eq 0 ] && [ "$HEADLESS_RC" -eq 0 ]; then
  echo -e "${GREEN}Report: $REPORT${NC}"
else
  echo -e "${RED}Report: $REPORT${NC}"
fi
exit $(( DESKTOP_RC + HEADLESS_RC ))
