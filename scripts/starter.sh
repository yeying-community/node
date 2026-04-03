#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-start}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${RUN_DIR:-$ROOT_DIR/run}"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/logs}"
PID_FILE="${PID_FILE:-$RUN_DIR/yeying-node.pid}"
LOG_FILE="${LOG_FILE:-$LOG_DIR/yeying-node.log}"
CONFIG_PATH="${APP_CONFIG_PATH:-$ROOT_DIR/config.js}"
WEB_DIST_PATH="${WEB_DIST_DIR:-$ROOT_DIR/web/dist}"
NODE_ENV_VALUE="${NODE_ENV:-production}"
START_WAIT_SECONDS="${START_WAIT_SECONDS:-3}"

info() {
  printf '%s\n' "$*"
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || fail "缺少命令: $cmd"
}

ensure_runtime_dirs() {
  mkdir -p "$RUN_DIR" "$LOG_DIR" "$ROOT_DIR/data"
}

ensure_config() {
  if [[ -f "$CONFIG_PATH" ]]; then
    return
  fi

  if [[ -n "${APP_CONFIG_PATH:-}" ]]; then
    fail "APP_CONFIG_PATH 指向的配置文件不存在: $CONFIG_PATH"
  fi

  local template_file="$ROOT_DIR/config.js.template"
  [[ -f "$template_file" ]] || fail "未找到配置模板: $template_file"
  cp "$template_file" "$CONFIG_PATH"
  info "已自动生成配置文件: $CONFIG_PATH"
}

ensure_build_artifacts() {
  [[ -f "$ROOT_DIR/dist/server.js" ]] || fail "未找到后端构建产物: $ROOT_DIR/dist/server.js"
}

runtime_dependencies_ready() {
  (
    cd "$ROOT_DIR"
    node -e "require.resolve('express'); require.resolve('typeorm'); require.resolve('cors')"
  ) >/dev/null 2>&1
}

install_runtime_dependencies() {
  require_command npm

  info "安装运行依赖..."
  if [[ -f "$ROOT_DIR/package-lock.json" ]]; then
    if ! (
      cd "$ROOT_DIR"
      npm ci --omit=dev --no-audit --no-fund
    ); then
      info "npm ci 失败，回退到 npm install --omit=dev"
      (
        cd "$ROOT_DIR"
        npm install --omit=dev --no-audit --no-fund
      )
    fi
  else
    (
      cd "$ROOT_DIR"
      npm install --omit=dev --no-audit --no-fund
    )
  fi
}

read_pid() {
  [[ -f "$PID_FILE" ]] || return 1
  tr -d '[:space:]' < "$PID_FILE"
}

is_running() {
  local pid
  pid="$(read_pid)" || return 1
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" >/dev/null 2>&1
}

start_app() {
  require_command node
  ensure_runtime_dirs
  ensure_config
  ensure_build_artifacts

  if ! runtime_dependencies_ready; then
    install_runtime_dependencies
  fi

  if is_running; then
    info "服务已在运行，PID=$(read_pid)"
    return 0
  fi

  rm -f "$PID_FILE"

  (
    cd "$ROOT_DIR"
    nohup env \
      NODE_ENV="$NODE_ENV_VALUE" \
      APP_CONFIG_PATH="$CONFIG_PATH" \
      WEB_DIST_DIR="$WEB_DIST_PATH" \
      node dist/server.js >>"$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
  )

  sleep "$START_WAIT_SECONDS"

  if ! is_running; then
    info "启动失败，最近日志如下："
    tail -n 50 "$LOG_FILE" 2>/dev/null || true
    rm -f "$PID_FILE"
    exit 1
  fi

  info "服务启动成功，PID=$(read_pid)"
  info "日志文件: $LOG_FILE"
}

stop_app() {
  ensure_runtime_dirs

  if ! is_running; then
    rm -f "$PID_FILE"
    info "服务未运行"
    return 0
  fi

  local pid
  pid="$(read_pid)"
  kill "$pid" >/dev/null 2>&1 || true

  local waited=0
  while kill -0 "$pid" >/dev/null 2>&1; do
    if (( waited >= 15 )); then
      kill -9 "$pid" >/dev/null 2>&1 || true
      break
    fi
    sleep 1
    waited=$((waited + 1))
  done

  rm -f "$PID_FILE"
  info "服务已停止"
}

restart_app() {
  stop_app
  start_app
}

case "$ACTION" in
  start)
    start_app
    ;;
  stop)
    stop_app
    ;;
  restart)
    restart_app
    ;;
  *)
    fail "不支持的参数: $ACTION。可用参数: start | stop | restart"
    ;;
esac
