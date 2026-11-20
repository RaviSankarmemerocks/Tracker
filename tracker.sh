#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8765}"
PID_FILE="$DIR/.tracker.pid"
URL="http://localhost:${PORT}/index.html"

is_running() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE")"
    if kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    rm -f "$PID_FILE"
  fi

  if command -v lsof >/dev/null 2>&1; then
    lsof -ti ":$PORT" >/dev/null 2>&1
    return $?
  fi

  return 1
}

port_pids() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti ":$PORT" 2>/dev/null || true
    return
  fi

  pgrep -f "python3.*server.py ${PORT}" 2>/dev/null || true
}

start_app() {
  if is_running; then
    echo "DSA Tracker is already running on port ${PORT}."
    echo "Open: ${URL}"
    return 0
  fi

  cd "$DIR"
  nohup python3 "$DIR/server.py" "$PORT" > "$DIR/.tracker.log" 2>&1 &
  echo $! > "$PID_FILE"

  sleep 0.3
  if ! is_running; then
    echo "Failed to start DSA Tracker. Check ${DIR}/.tracker.log"
    rm -f "$PID_FILE"
    return 1
  fi

  echo "Started DSA Tracker on port ${PORT} (PID $(cat "$PID_FILE"))."
  echo "Open: ${URL}"
}

stop_app() {
  local stopped=0

  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      stopped=1
    fi
    rm -f "$PID_FILE"
  fi

  local pids
  pids="$(port_pids)"
  if [[ -n "$pids" ]]; then
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    stopped=1
  fi

  if [[ "$stopped" -eq 1 ]]; then
    echo "Stopped DSA Tracker on port ${PORT}."
  else
    echo "DSA Tracker is not running on port ${PORT}."
  fi
}

status_app() {
  if is_running; then
    local pid="unknown"
    [[ -f "$PID_FILE" ]] && pid="$(cat "$PID_FILE")"
    echo "Running on port ${PORT} (PID ${pid})"
    echo "Open: ${URL}"
  else
    echo "Not running."
  fi
}

restart_app() {
  stop_app
  start_app
}

usage() {
  cat <<EOF
Usage: $(basename "$0") {start|stop|restart|status}

  start    Start the tracker on port ${PORT}
  stop     Stop the tracker
  restart  Restart the tracker
  status   Show whether the tracker is running

Environment:
  PORT     Server port (default: ${PORT})
EOF
}

case "${1:-}" in
  start) start_app ;;
  stop|kill) stop_app ;;
  restart) restart_app ;;
  status) status_app ;;
  *)
    usage
    exit 1
    ;;
esac
