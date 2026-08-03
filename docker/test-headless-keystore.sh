#!/usr/bin/env bash
###############################################################################
# Host orchestrator for the headless-keystore verification.
#
#   ./docker/test-headless-keystore.sh [--keep-images] [--platform <p>] [--node <major>] [none|libsecret|full ...]
#
# Reproduces all three states from the bug report on real Ubuntu 24.04 and runs
# docker/run-keystore-checks.sh in each:
#
#   none       no libsecret — keytar's native module cannot even load
#   libsecret  the library, but nothing serving the Secret Service on the bus
#   full       libsecret + gnome-keyring + dbus — a working desktop equivalent
#   musl       Alpine, no libsecret at all — docs/CROSS-OS.md's "known risk"
#
# Distinct from docker/test-linux.sh, which asserts the PRE-1.3.0 contract
# ("headless → must fail clean"). That is no longer the contract.
#
# --platform runs under emulation (e.g. linux/amd64 from Apple Silicon). Worth
# doing before a release: keytar ships per-arch N-API prebuilds, so arm64 and x64
# do not exercise the same native binary, and "no prebuild for this target" is a
# failure that only shows up on the arch that lacks it.
#
# Writes a timestamped report to docker/reports/ and always tears down.
###############################################################################
set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DOCKER_DIR="$PROJECT_DIR/docker"
KEEP_IMAGES=false
PLATFORM=""
NODE_MAJOR="20"

MODES=()
WANT_PLATFORM=false
WANT_NODE=false
for arg in "$@"; do
  if [ "$WANT_PLATFORM" = true ]; then PLATFORM="$arg"; WANT_PLATFORM=false; continue; fi
  if [ "$WANT_NODE" = true ]; then NODE_MAJOR="$arg"; WANT_NODE=false; continue; fi
  case "$arg" in
    --keep-images) KEEP_IMAGES=true ;;
    --platform) WANT_PLATFORM=true ;;
    --platform=*) PLATFORM="${arg#--platform=}" ;;
    --node) WANT_NODE=true ;;
    --node=*) NODE_MAJOR="${arg#--node=}" ;;
    none|libsecret|full|musl) MODES+=("$arg") ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done
[ "$WANT_PLATFORM" = true ] && { echo "--platform needs a value, e.g. --platform linux/amd64" >&2; exit 2; }
[ "$WANT_NODE" = true ] && { echo "--node needs a value, e.g. --node 18" >&2; exit 2; }

# Distinct image tags per platform so an emulated run cannot silently reuse a
# native image from the build cache — which would make the whole exercise a no-op.
TAG_SUFFIX="-node$NODE_MAJOR"
PLATFORM_ARGS=()
if [ -n "$PLATFORM" ]; then
  TAG_SUFFIX="$TAG_SUFFIX-$(printf '%s' "$PLATFORM" | tr '/' '-')"
  PLATFORM_ARGS=(--platform "$PLATFORM")
fi
[ ${#MODES[@]} -eq 0 ] && MODES=(none libsecret full musl)

cd "$PROJECT_DIR"
VERSION="$(node -e "console.log(require('./package.json').version)")"
STAMP="$(date +%Y%m%d-%H%M%S)"
REPORT="$DOCKER_DIR/reports/headless-keystore-$VERSION$TAG_SUFFIX-$STAMP.txt"

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
log() { echo -e "${BLUE}==> $1${NC}"; }

cleanup() {
  log "Cleanup..."
  rm -f "$DOCKER_DIR/mailman.tgz" 2>/dev/null && echo "  removed packed tarball"
  if [ "$KEEP_IMAGES" = false ]; then
    for mode in "${MODES[@]}"; do
      docker rmi "mailman-keystore-$mode$TAG_SUFFIX:tmp" >/dev/null 2>&1 && echo "  removed image mailman-keystore-$mode$TAG_SUFFIX:tmp"
    done
  else
    echo "  kept images (--keep-images)"
  fi
}
trap cleanup EXIT

log "npm pack (hermetic — mailman is installed from this tarball, not a registry)"
npm run build >/dev/null 2>&1 || { echo "build failed"; exit 1; }
TARBALL="$(npm pack --silent 2>/dev/null | tail -1)"
mv "$TARBALL" "$DOCKER_DIR/mailman.tgz"
echo "  packed $TARBALL → docker/mailman.tgz"

mkdir -p "$DOCKER_DIR/reports"
{
  echo "mailman headless-keystore verification"
  echo "package: @indianic/mailman@$VERSION"
  echo "date:    $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "host:    $(uname -sm) · docker $(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')"
  echo "image:   ubuntu:24.04 + node $NODE_MAJOR (musl mode uses node:20-alpine)${PLATFORM:+ · platform $PLATFORM (emulated)}"
  echo "modes:   ${MODES[*]}"
  echo "======================================================================="
} > "$REPORT"

TOTAL_RC=0
for mode in "${MODES[@]}"; do
  IMAGE="mailman-keystore-$mode$TAG_SUFFIX:tmp"

  log "docker build ($mode)"
  # musl gets its own base image; NODE_MAJOR/KEYRING_LEVEL do not apply there.
  BUILD_ARGS=(--build-arg "KEYRING_LEVEL=$mode" --build-arg "NODE_MAJOR=$NODE_MAJOR")
  DOCKERFILE="$DOCKER_DIR/Dockerfile.headless"
  if [ "$mode" = "musl" ]; then
    BUILD_ARGS=()
    DOCKERFILE="$DOCKER_DIR/Dockerfile.alpine"
  fi
  docker build "${PLATFORM_ARGS[@]+"${PLATFORM_ARGS[@]}"}" "${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"}" \
    -f "$DOCKERFILE" \
    -t "$IMAGE" "$DOCKER_DIR" > "/tmp/mailman-keystore-build-$mode.log" 2>&1 \
    || { echo "docker build failed — tail:"; tail -30 "/tmp/mailman-keystore-build-$mode.log"; TOTAL_RC=1; continue; }
  echo "  built $IMAGE"

  log "run: $mode"
  if [ "$mode" = "full" ]; then
    # A session bus plus an unlocked gnome-keyring registered as the Secret
    # Service — the closest a container gets to a logged-in desktop.
    # --entrypoint bash is required to wrap the script in dbus-run-session;
    # otherwise the args would be appended to the entrypoint instead.
    docker run --rm "${PLATFORM_ARGS[@]+"${PLATFORM_ARGS[@]}"}" --entrypoint bash "$IMAGE" -c \
      'dbus-run-session -- bash -c "printf \"\n\" | gnome-keyring-daemon --unlock --components=secrets >/dev/null 2>&1 & sleep 2; bash /work/run-keystore-checks.sh full"' \
      2>&1 | tee -a "$REPORT"
  else
    docker run --rm "${PLATFORM_ARGS[@]+"${PLATFORM_ARGS[@]}"}" "$IMAGE" "$mode" 2>&1 | tee -a "$REPORT"
  fi
  RC=${PIPESTATUS[0]}
  [ "$RC" -ne 0 ] && TOTAL_RC=1
  echo "" | tee -a "$REPORT"
done

{
  echo "======================================================================="
  if [ "$TOTAL_RC" -eq 0 ]; then
    echo "RESULT: PASS — every mode green on Ubuntu 24.04 (node $NODE_MAJOR, ${PLATFORM:-native $(uname -m)})"
  else
    echo "RESULT: FAIL — see the FAIL lines above"
  fi
} | tee -a "$REPORT"

echo ""
if [ "$TOTAL_RC" -eq 0 ]; then
  echo -e "${GREEN}Report: $REPORT${NC}"
else
  echo -e "${RED}Report: $REPORT${NC}"
fi
exit "$TOTAL_RC"
