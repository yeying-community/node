#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

LEVEL="${HEALTH_LEVEL:-readiness}"
TIMEOUT="${HEALTH_TIMEOUT:-10}"
RETRIES="${HEALTH_RETRIES:-0}"
INTERVAL="${HEALTH_INTERVAL:-2}"
FORMAT="${HEALTH_FORMAT:-text}"
BASE_URL="${HEALTH_BASE_URL:-}"
CONFIG_PATH="${HEALTH_CONFIG:-${APP_CONFIG_PATH:-$PROJECT_DIR/config.js}}"
QUIET=false
VERBOSE=false
LOGFILE=""

PROJECT_NAME="node"
PROJECT_VERSION="unknown"
ENVIRONMENT="${NODE_ENV:-production}"
STARTED_AT=""
START_MS=0
PASSED=0
WARNED=0
FAILED=0
SKIPPED=0
HAD_TIMEOUT=false
HAD_FRAMEWORK_ERROR=false
CHECK_NAMES=()
CHECK_STATUSES=()
CHECK_DURATIONS=()
CHECK_MESSAGES=()

init_log_file() {
  local logfile_name=$1
  local logfile_dir="/opt/logs"

  LOGFILE="${logfile_dir}/${logfile_name}"
  mkdir -p "$logfile_dir"
  touch "$LOGFILE"

  local filesize=0
  filesize=$(stat -c "%s" "$LOGFILE" 2>/dev/null || echo 0)
  if [[ "$filesize" -ge 1048576 ]]; then
    printf 'clear old logs at %s to avoid log file too big\n' "$(date)" > "$LOGFILE"
  fi
}

log() {
  local message
  message="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  if [[ "${FORMAT:-text}" == "json" || "${QUIET:-false}" == true ]]; then
    printf '%b\n' "$message" >> "$LOGFILE"
  else
    printf '%b\n' "$message" | tee -a "$LOGFILE"
  fi
}

log_err() {
  printf '%b\n' "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOGFILE" >&2
}

log_file() {
  printf '%b\n' "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOGFILE"
}

finish_log() {
  local rc=$?
  [[ -n "$LOGFILE" ]] && log_file "health check command exited with code $rc"
}

init_log_file "health-check-node.log"
trap finish_log EXIT

usage() {
  cat <<'EOF'
Usage: ./scripts/health-check.sh [options]

Options:
  --level <level>       liveness, readiness, dependency, or all (default: readiness)
  --timeout <seconds>   Maximum time for one check attempt (default: 10)
  --retries <count>     Retries after the first failed attempt (default: 0)
  --interval <seconds>  Delay between retries (default: 2)
  --format <format>     text or json (default: text)
  --base-url <url>      Override service URL (default: http://127.0.0.1:<app.port>)
  --config <path>       Override config file (default: APP_CONFIG_PATH or config.js)
  --quiet               Hide per-check text output; keep the final result
  --verbose             Write retry diagnostics to stderr
  --help                Show this help

Environment variables:
  HEALTH_LEVEL, HEALTH_TIMEOUT, HEALTH_RETRIES, HEALTH_INTERVAL, HEALTH_FORMAT,
  HEALTH_BASE_URL, HEALTH_CONFIG, RUN_DIR, PID_FILE, APP_PORT, APP_CONFIG_PATH
EOF
}

usage_error() {
  log_err "ERROR: $1"
  log_err "Run with --help for usage."
  exit 2
}

framework_error() {
  log_err "ERROR: $1"
  exit 3
}

require_value() {
  [[ $# -ge 2 && -n "$2" ]] || usage_error "$1 requires a value"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --level)
      require_value "$@"; LEVEL="$2"; shift 2 ;;
    --timeout)
      require_value "$@"; TIMEOUT="$2"; shift 2 ;;
    --retries)
      require_value "$@"; RETRIES="$2"; shift 2 ;;
    --interval)
      require_value "$@"; INTERVAL="$2"; shift 2 ;;
    --format)
      require_value "$@"; FORMAT="$2"; shift 2 ;;
    --base-url)
      require_value "$@"; BASE_URL="$2"; shift 2 ;;
    --config)
      require_value "$@"; CONFIG_PATH="$2"; shift 2 ;;
    --quiet)
      QUIET=true; shift ;;
    --verbose)
      VERBOSE=true; shift ;;
    --help)
      usage; exit 0 ;;
    *)
      usage_error "unknown option: $1" ;;
  esac
done

case "$LEVEL" in liveness|readiness|dependency|all) ;; *) usage_error "invalid level: $LEVEL" ;; esac
case "$FORMAT" in text|json) ;; *) usage_error "invalid format: $FORMAT" ;; esac
[[ "$TIMEOUT" =~ ^[1-9][0-9]*$ ]] || usage_error "timeout must be a positive integer"
[[ "$RETRIES" =~ ^[0-9]+$ ]] || usage_error "retries must be a non-negative integer"
[[ "$INTERVAL" =~ ^[0-9]+$ ]] || usage_error "interval must be a non-negative integer"
[[ -z "$BASE_URL" || "$BASE_URL" =~ ^https?://[^[:space:]]+$ ]] || usage_error "base-url must be an http(s) URL"

command -v node >/dev/null 2>&1 || framework_error "required command not found: node"
command -v curl >/dev/null 2>&1 || framework_error "required command not found: curl"

if [[ -f "$PROJECT_DIR/package.json" ]]; then
  PROJECT_NAME="$(node -e 'const p=require(process.argv[1]); process.stdout.write(String(p.name || "node"))' "$PROJECT_DIR/package.json")"
  PROJECT_VERSION="$(node -e 'const p=require(process.argv[1]); process.stdout.write(String(p.version || "unknown"))' "$PROJECT_DIR/package.json")"
fi

if [[ "$CONFIG_PATH" != /* ]]; then
  CONFIG_PATH="$PROJECT_DIR/$CONFIG_PATH"
fi

if [[ -z "$BASE_URL" ]]; then
  APP_PORT_VALUE=""
  if [[ -f "$CONFIG_PATH" ]]; then
    APP_PORT_VALUE="$(node -e 'const p=process.argv[1]; const c=require(p); process.stdout.write(String(c?.app?.port || ""))' "$CONFIG_PATH" 2>/dev/null || true)"
  fi
  APP_PORT_VALUE="${APP_PORT_VALUE:-8100}"
  [[ "$APP_PORT_VALUE" =~ ^[1-9][0-9]*$ ]] || usage_error "configured app port is invalid"
  BASE_URL="http://127.0.0.1:$APP_PORT_VALUE"
fi
BASE_URL="${BASE_URL%/}"

RUN_DIR="${RUN_DIR:-$PROJECT_DIR/run}"
PID_FILE="${PID_FILE:-$RUN_DIR/node.pid}"
STARTED_AT="$(node -e 'process.stdout.write(new Date().toISOString())')"
START_MS="$(node -e 'process.stdout.write(String(Date.now()))')"
log_file "health check started: project=$PROJECT_NAME version=$PROJECT_VERSION environment=$ENVIRONMENT level=$LEVEL format=$FORMAT timeout=${TIMEOUT}s retries=$RETRIES interval=${INTERVAL}s base_url=$BASE_URL config=$CONFIG_PATH pid_file=$PID_FILE"

now_ms() {
  node -e 'process.stdout.write(String(Date.now()))'
}

sanitize_message() {
  local value="$1"
  value="${value//$'\n'/ }"
  value="${value//$'\r'/ }"
  value="${value//$'\t'/ }"
  printf '%s' "${value:0:500}"
}

add_result() {
  local name="$1" status="$2" duration="$3" message
  message="$(sanitize_message "$4")"
  CHECK_NAMES+=("$name")
  CHECK_STATUSES+=("$status")
  CHECK_DURATIONS+=("$duration")
  CHECK_MESSAGES+=("$message")
  case "$status" in
    pass) PASSED=$((PASSED + 1)) ;;
    warn) WARNED=$((WARNED + 1)) ;;
    fail) FAILED=$((FAILED + 1)) ;;
    skip) SKIPPED=$((SKIPPED + 1)) ;;
  esac
  if [[ "$FORMAT" == text && "$QUIET" == false ]]; then
    local display_status
    display_status="$(printf '%s' "$status" | tr '[:lower:]' '[:upper:]')"
    printf '[%s] %s: %s (%s ms)\n' "$display_status" "$name" "$message" "$duration"
  fi
  log_file "check result: status=$status name=$name duration_ms=$duration message=$message"
}

retry_check() {
  local name="$1" success_message="$2" function_name="$3"
  local attempt=0 max_attempts=$((RETRIES + 1)) started ended output rc
  started="$(now_ms)"
  while (( attempt < max_attempts )); do
    attempt=$((attempt + 1))
    set +e
    output="$($function_name 2>&1)"
    rc=$?
    set -e
    if (( rc == 0 )); then
      ended="$(now_ms)"
      add_result "$name" pass "$((ended - started))" "$success_message"
      return 0
    fi
    if (( rc == 124 || rc == 28 )); then
      HAD_TIMEOUT=true
    fi
    if (( rc == 3 )); then
      HAD_FRAMEWORK_ERROR=true
    fi
    if (( attempt < max_attempts )); then
      local retry_message
      retry_message="Retrying $name ($attempt/$max_attempts): $(sanitize_message "$output")"
      log_file "$retry_message"
      [[ "$VERBOSE" == true ]] && printf '%s\n' "$retry_message" >&2
      sleep "$INTERVAL"
    fi
  done
  ended="$(now_ms)"
  [[ -n "$output" ]] || output="check failed"
  add_result "$name" fail "$((ended - started))" "$output"
  return 1
}

check_process() {
  [[ -f "$PID_FILE" ]] || { printf 'PID file not found: %s' "$PID_FILE"; return 1; }
  local pid state
  pid="$(tr -d '[:space:]' < "$PID_FILE")"
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || { printf 'PID file is invalid'; return 1; }
  kill -0 "$pid" >/dev/null 2>&1 || { printf 'service process is not running (PID %s)' "$pid"; return 1; }
  state="$(ps -o state= -p "$pid" 2>/dev/null | tr -d '[:space:]')"
  [[ "$state" != Z* ]] || { printf 'service process is a zombie (PID %s)' "$pid"; return 1; }
  return 0
}

check_http_health() {
  local body
  body="$(curl --silent --show-error --fail --max-time "$TIMEOUT" --connect-timeout "$TIMEOUT" "$BASE_URL/api/v1/public/health")" || return $?
  HEALTH_BODY="$body" node -e '
    const raw = process.env.HEALTH_BODY || "";
    let value;
    try { value = JSON.parse(raw); } catch { process.stderr.write("health endpoint returned invalid JSON"); process.exit(1); }
    const payload = value?.data ?? value;
    if (payload?.status !== "ok") { process.stderr.write("health endpoint status is not ok"); process.exit(1); }
  '
}

check_database() {
  [[ -f "$CONFIG_PATH" ]] || { printf 'config file not found: %s' "$CONFIG_PATH"; return 1; }
  (
    cd "$PROJECT_DIR"
    HEALTH_DB_CONFIG="$CONFIG_PATH" HEALTH_DB_TIMEOUT="$TIMEOUT" node <<'NODE'
const configPath = process.env.HEALTH_DB_CONFIG;
const timeoutMs = Number(process.env.HEALTH_DB_TIMEOUT) * 1000;
let DataSource;
try { ({ DataSource } = require('typeorm')); } catch { process.stderr.write('runtime dependency is missing: typeorm'); process.exit(3); }
let config;
try { const loaded = require(configPath); config = loaded.default || loaded; } catch { process.stderr.write('unable to load health-check config'); process.exit(1); }
const db = config && config.database;
if (!db || !['postgres', 'mysql'].includes(db.type)) { process.stderr.write('database config must use postgres or mysql'); process.exit(1); }
const options = { ...db, entities: [], migrations: [], synchronize: false, logging: false };
if (db.type === 'postgres') options.connectTimeoutMS = timeoutMs;
if (db.type === 'mysql') options.connectTimeout = timeoutMs;
const source = new DataSource(options);
let timeoutId;
const timeout = new Promise((_, reject) => {
  timeoutId = setTimeout(() => reject(Object.assign(new Error('database check timed out'), { timeout: true })), timeoutMs);
});
(async () => {
  try {
    await Promise.race([(async () => { await source.initialize(); await source.query('SELECT 1'); })(), timeout]);
    await source.destroy();
  } catch (error) {
    if (source.isInitialized) await source.destroy().catch(() => {});
    process.stderr.write(error && error.timeout ? 'database check timed out' : 'database read-only query failed');
    process.exit(error && error.timeout ? 124 : 1);
  } finally {
    clearTimeout(timeoutId);
  }
})().catch(() => { process.stderr.write('database check framework error'); process.exit(3); });
NODE
  )
}

run_liveness() {
  if [[ -f "$PID_FILE" ]]; then
    retry_check process "service process is running" check_process || true
  else
    add_result process skip 0 "PID file is not used by the current launch mode"
  fi
  retry_check http "health endpoint returned status ok" check_http_health || true
}

run_readiness() {
  run_liveness
}

run_dependency() {
  retry_check database "database read-only query succeeded" check_database || true
}

case "$LEVEL" in
  liveness) run_liveness ;;
  readiness) run_readiness ;;
  dependency) run_dependency ;;
  all) run_readiness; run_dependency ;;
esac

END_MS="$(now_ms)"
DURATION_MS=$((END_MS - START_MS))
if (( FAILED > 0 )); then
  OVERALL_STATUS="fail"
elif (( WARNED > 0 )); then
  OVERALL_STATUS="warn"
else
  OVERALL_STATUS="pass"
fi
log_file "health check completed: status=$OVERALL_STATUS passed=$PASSED warned=$WARNED failed=$FAILED skipped=$SKIPPED duration_ms=$DURATION_MS"

if [[ "$FORMAT" == text ]]; then
  printf 'RESULT status=%s passed=%d warned=%d failed=%d skipped=%d duration_ms=%d\n' \
    "$OVERALL_STATUS" "$PASSED" "$WARNED" "$FAILED" "$SKIPPED" "$DURATION_MS"
else
  export HC_PROJECT="$PROJECT_NAME" HC_VERSION="$PROJECT_VERSION" HC_ENVIRONMENT="$ENVIRONMENT"
  export HC_LEVEL="$LEVEL" HC_STATUS="$OVERALL_STATUS" HC_STARTED_AT="$STARTED_AT" HC_DURATION_MS="$DURATION_MS"
  export HC_PASSED="$PASSED" HC_WARNED="$WARNED" HC_FAILED="$FAILED" HC_SKIPPED="$SKIPPED"
  NODE_ARGS=()
  for ((i = 0; i < ${#CHECK_NAMES[@]}; i++)); do
    NODE_ARGS+=("${CHECK_NAMES[$i]}" "${CHECK_STATUSES[$i]}" "${CHECK_DURATIONS[$i]}" "${CHECK_MESSAGES[$i]}")
  done
  node - "${NODE_ARGS[@]}" <<'NODE'
const args = process.argv.slice(2);
const checks = [];
for (let i = 0; i < args.length; i += 4) {
  checks.push({ name: args[i], status: args[i + 1], duration_ms: Number(args[i + 2]), message: args[i + 3] });
}
const result = {
  schema_version: '1.0', type: 'health_check', project: process.env.HC_PROJECT,
  version: process.env.HC_VERSION, environment: process.env.HC_ENVIRONMENT,
  level: process.env.HC_LEVEL, status: process.env.HC_STATUS,
  started_at: process.env.HC_STARTED_AT, duration_ms: Number(process.env.HC_DURATION_MS),
  summary: { passed: Number(process.env.HC_PASSED), warned: Number(process.env.HC_WARNED), failed: Number(process.env.HC_FAILED), skipped: Number(process.env.HC_SKIPPED) },
  checks
};
process.stdout.write(JSON.stringify(result) + '\n');
NODE
fi

if (( FAILED == 0 )); then
  exit 0
fi
if [[ "$HAD_FRAMEWORK_ERROR" == true ]]; then
  exit 3
fi
if [[ "$HAD_TIMEOUT" == true ]]; then
  exit 4
fi
exit 1
