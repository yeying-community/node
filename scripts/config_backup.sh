#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(realpath "$SCRIPT_DIR/..")"
RELEASE_DIR_NAME="$(basename "$ROOT_DIR")"
MODULE_NAME="$RELEASE_DIR_NAME"
BACKUP_DIR="/opt/backup"
TMP_DIR="/tmp/${RELEASE_DIR_NAME}-conf"
LOGFILE=""

if [[ "$RELEASE_DIR_NAME" =~ ^(.+)-v[0-9][^-]*-[[:alnum:]]{7}$ ]]; then
  MODULE_NAME="${BASH_REMATCH[1]}"
fi

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
  echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOGFILE"
}

log_err() {
  echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOGFILE" >&2
}

fail() {
  log_err "$*"
  cleanup
  exit 1
}

cleanup() {
  if [[ -n "${TMP_DIR:-}" && "$TMP_DIR" == /tmp/* && -d "$TMP_DIR" ]]; then
    rm -rf "$TMP_DIR"
  fi
}

require_command() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || fail "missing command: $cmd"
}

load_backup_conf() {
  local conf_file="$SCRIPT_DIR/backup.conf"
  [[ -f "$conf_file" ]] || fail "backup config not found: $conf_file"

  # shellcheck disable=SC1090
  source "$conf_file"

  BACKUP_CONF_FLAG="${BACKUP_CONF_FLAG:-True}"
  BACKUP_CONF_PREFIX="${BACKUP_CONF_PREFIX:-}"
  BACKUP_CONF_SUFFIX="${BACKUP_CONF_SUFFIX:-.conf.tar.gz.gpg}"

  case "$BACKUP_CONF_FLAG" in
    True|False) ;;
    *) fail "invalid BACKUP_CONF_FLAG: $BACKUP_CONF_FLAG, expected True or False" ;;
  esac
}

backup_config() {
  load_backup_conf

  if [[ "$BACKUP_CONF_FLAG" == "False" ]]; then
    log "config backup disabled by BACKUP_CONF_FLAG"
    return 0
  fi

  require_command gpg
  require_command tar

  local passphrase_file="$SCRIPT_DIR/.passphrase-file"
  local config_file="$ROOT_DIR/config.js"
  local run_dir="$ROOT_DIR/run"
  local backup_file="${BACKUP_CONF_PREFIX}${RELEASE_DIR_NAME}${BACKUP_CONF_SUFFIX}"
  local backup_path="${BACKUP_DIR}/${backup_file}"

  [[ -f "$passphrase_file" ]] || fail "passphrase file not found: $passphrase_file"
  [[ -f "$config_file" ]] || fail "config file not found: $config_file"
  [[ -d "$run_dir" ]] || fail "run directory not found: $run_dir"

  mkdir -p "$BACKUP_DIR" || fail "failed to create backup directory: $BACKUP_DIR"

  if [[ -f "$backup_path" ]]; then
    log "backup file already exists: $backup_path"
    return 255
  fi

  cleanup
  mkdir -p "$TMP_DIR" || fail "failed to create temp directory: $TMP_DIR"
  cp "$config_file" "$TMP_DIR/config.js" || fail "failed to copy config file: $config_file"
  cp -R "$run_dir" "$TMP_DIR/run" || fail "failed to copy run directory: $run_dir"

  log "start config backup: $ROOT_DIR -> $backup_path"
  if gpg --batch --yes --symmetric --cipher-algo AES256 \
    --passphrase-file "$passphrase_file" \
    -o "$backup_path" \
    < <(tar czf - -C "/tmp" "${RELEASE_DIR_NAME}-conf"); then
    cleanup
    log "config backup success: $backup_path"
    return 0
  fi

  rm -f "$backup_path"
  fail "config backup failed: $backup_path"
}

main() {
  init_log_file "config-backup-${MODULE_NAME}.log"
  trap cleanup EXIT INT TERM
  backup_config
}

main "$@"
