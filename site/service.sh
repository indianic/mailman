#!/usr/bin/env bash
#
# service.sh — manage the mailman landing-site server (Express + built client).
#
# Usage:
#   ./service.sh start     build client (if needed) and start the server
#   ./service.sh stop      stop the running server
#   ./service.sh restart   stop then start
#   ./service.sh status    show whether it's running (+ PID, port, health)
#   ./service.sh logs      follow the server log (Ctrl-C to exit)
#   ./service.sh build     rebuild the client only
#
set -euo pipefail

# --- resolve paths (works from any cwd) --------------------------------
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$DIR/server"
CLIENT_DIR="$DIR/client"
PID_FILE="$DIR/.server.pid"
LOG_FILE="$DIR/server.log"

# Read HOST/PORT from server/.env if present, else defaults. Fixed values —
# the server always binds to the same address, never a random port.
read_env() { grep -E "^$1=" "$SERVER_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2 || true; }
HOST="$(read_env HOST)"; HOST="${HOST:-localhost}"
PORT="$(read_env PORT)"; PORT="${PORT:-4000}"

# --- pretty output -----------------------------------------------------
info()  { printf '\033[0;36m▸\033[0m %s\n' "$*"; }
ok()    { printf '\033[0;32m✓\033[0m %s\n' "$*"; }
warn()  { printf '\033[0;33m!\033[0m %s\n' "$*"; }
err()   { printf '\033[0;31m✗\033[0m %s\n' "$*" >&2; }

# --- helpers -----------------------------------------------------------
is_running() {
  [ -f "$PID_FILE" ] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

build_client() {
  info "Building client…"
  ( cd "$CLIENT_DIR" && npm run build >/dev/null )
  ok "Client built → client/dist"
}

# Wait (up to ~5s) for the port to be released. Uses lsof when available.
wait_port_free() {
  command -v lsof >/dev/null 2>&1 || { sleep 1; return 0; }
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    lsof -ti ":$PORT" >/dev/null 2>&1 || return 0
    sleep 0.5
  done
  return 1
}

# --- commands ----------------------------------------------------------
start() {
  if is_running; then
    warn "Already running (PID $(cat "$PID_FILE")) on port $PORT."
    return 0
  fi
  # Ensure a client build exists; build if missing.
  if [ ! -f "$CLIENT_DIR/dist/index.html" ]; then
    build_client
  fi
  info "Starting server on port ${PORT}…"
  # `exec` replaces the backgrounded subshell with node, so $! is node's own
  # PID (not a wrapper's) — otherwise stop() would kill the wrapper and orphan
  # the real listener, leaving the port held.
  ( cd "$SERVER_DIR" && exec node index.js ) >>"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  sleep 1
  if is_running; then
    ok "Started (PID $(cat "$PID_FILE")) → http://${HOST}:${PORT}"
    info "Logs: ./service.sh logs"
  else
    err "Failed to start. Recent log:"
    tail -n 20 "$LOG_FILE" 2>/dev/null || true
    rm -f "$PID_FILE"
    return 1
  fi
}

stop() {
  if ! is_running; then
    warn "Not running."
    rm -f "$PID_FILE"
    return 0
  fi
  local pid
  pid="$(cat "$PID_FILE")"
  info "Stopping server (PID $pid)…"
  kill "$pid" 2>/dev/null || true
  # Wait up to 5s for a graceful exit, then force.
  for _ in 1 2 3 4 5; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$pid" 2>/dev/null; then
    warn "Did not exit gracefully — forcing."
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
  # Don't return until the OS has actually released the port, so an
  # immediate restart doesn't hit EADDRINUSE. If something still holds it,
  # kill that too as a safety net.
  if ! wait_port_free; then
    warn "Port $PORT still busy — killing whatever holds it."
    lsof -ti ":$PORT" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
    wait_port_free || true
  fi
  ok "Stopped."
}

restart() {
  stop
  start
}

status() {
  if is_running; then
    ok "Running (PID $(cat "$PID_FILE")) on http://${HOST}:${PORT}"
    if command -v curl >/dev/null 2>&1; then
      local health
      health="$(curl -s "http://${HOST}:${PORT}/api/health" 2>/dev/null || true)"
      [ -n "$health" ] && info "Health: $health" || warn "Health check: no response."
    fi
  else
    warn "Not running."
    return 1
  fi
}

logs() {
  if [ ! -f "$LOG_FILE" ]; then
    warn "No log file yet ($LOG_FILE). Start the server first."
    return 1
  fi
  info "Following $LOG_FILE (Ctrl-C to exit)…"
  tail -n 40 -f "$LOG_FILE"
}

# --- dispatch ----------------------------------------------------------
case "${1:-}" in
  start)   start ;;
  stop)    stop ;;
  restart) restart ;;
  status)  status ;;
  logs)    logs ;;
  build)   build_client ;;
  *)
    echo "Usage: ./service.sh {start|stop|restart|status|logs|build}"
    exit 1
    ;;
esac
