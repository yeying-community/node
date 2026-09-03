#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

info() {
  printf '%s\n' "$*"
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_file() {
  local file="$1"
  [[ -f "$file" ]] || fail "required file not found: $file"
}

usage() {
  cat <<'EOF'
Usage:
  ./cmd <command> [args]

Commands:
  ./cmd service start|stop|restart|status|logs
  ./cmd start|stop|restart|status|logs
  ./cmd health [health-check options]
  ./cmd secrets init|set|remove|unlock|verify|migrate-config|migrate [args]
  ./cmd admin allow add|remove|list [did-or-wallet]

Examples:
  ./cmd admin allow add 0x1111111111111111111111111111111111111111
  ./cmd secrets set MAIL_SMTP_PASSWORD
  ./cmd service restart
  ./cmd health --level readiness --retries 3
EOF
}

service_status() {
  local run_dir="${RUN_DIR:-$ROOT_DIR/run}"
  local pid_file="${PID_FILE:-$run_dir/node.pid}"
  if [[ ! -f "$pid_file" ]]; then
    info "service stopped"
    return 1
  fi
  local pid
  pid="$(tr -d '[:space:]' < "$pid_file")"
  if [[ "$pid" =~ ^[1-9][0-9]*$ ]] && kill -0 "$pid" >/dev/null 2>&1; then
    info "service running, PID=$pid"
    return 0
  fi
  info "service stopped, stale PID file: $pid_file"
  return 1
}

service_logs() {
  local log_dir="${LOG_DIR:-$ROOT_DIR/logs}"
  local log_file="${LOG_FILE:-$log_dir/node.log}"
  local lines="${1:-80}"
  [[ "$lines" =~ ^[1-9][0-9]*$ ]] || fail "logs line count must be a positive integer"
  if [[ ! -f "$log_file" ]]; then
    fail "log file not found: $log_file"
  fi
  tail -n "$lines" "$log_file"
}

run_service() {
  local action="${1:-}"
  case "$action" in
    start|stop|restart)
      require_file "$ROOT_DIR/scripts/starter.sh"
      shift || true
      bash "$ROOT_DIR/scripts/starter.sh" "$action" "$@"
      ;;
    status)
      service_status
      ;;
    logs)
      shift || true
      service_logs "${1:-80}"
      ;;
    *)
      fail "usage: ./cmd service start|stop|restart|status|logs"
      ;;
  esac
}

run_secrets() {
  local action="${1:-}"
  shift || true
  case "$action" in
    init)
      node "$ROOT_DIR/scripts/init-secrets.cjs" "$@"
      ;;
    set)
      node "$ROOT_DIR/scripts/set-secret.cjs" "$@"
      ;;
    remove)
      node "$ROOT_DIR/scripts/remove-secret.cjs" "$@"
      ;;
    unlock)
      node "$ROOT_DIR/scripts/unlock-secrets.cjs" "$@"
      ;;
    verify)
      node "$ROOT_DIR/scripts/verify-secrets.cjs" "$@"
      ;;
    migrate-config)
      node "$ROOT_DIR/scripts/migrate-config-secrets.cjs" "$@"
      ;;
    migrate)
      node "$ROOT_DIR/scripts/migrate-secrets.cjs" "$@"
      ;;
    *)
      fail "usage: ./cmd secrets init|set|remove|unlock|verify|migrate-config|migrate [args]"
      ;;
  esac
}

run_admin() {
  local resource="${1:-}"
  shift || true
  case "$resource" in
    allow)
      node "$ROOT_DIR/scripts/admin-allow.cjs" "$@"
      ;;
    *)
      fail "usage: ./cmd admin allow add|remove|list [did-or-wallet]"
      ;;
  esac
}

main() {
  local command="${1:-}"
  if [[ -z "$command" || "$command" == "help" || "$command" == "--help" || "$command" == "-h" ]]; then
    usage
    return 0
  fi
  shift || true

  case "$command" in
    service)
      run_service "$@"
      ;;
    start|stop|restart|status|logs)
      run_service "$command" "$@"
      ;;
    health)
      require_file "$ROOT_DIR/scripts/health-check.sh"
      bash "$ROOT_DIR/scripts/health-check.sh" "$@"
      ;;
    secrets)
      run_secrets "$@"
      ;;
    admin)
      run_admin "$@"
      ;;
    *)
      usage
      fail "unknown command: $command"
      ;;
  esac
}

main "$@"
