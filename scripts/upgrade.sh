#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 3 ]]; then
    printf 'Usage: %s <prepare|copy-config|post-copy|finalize> <current-dir> <target-dir>\n' "$0" >&2
    exit 1
fi

phase=$1
current_dir=$2
target_dir=$3

resolve_secrets_paths() {
    local config_path=$1
    local root_dir=$2

    node - "$config_path" "$root_dir" <<'NODE'
const path = require('path')
const config = require(path.resolve(process.argv[2]))
const secrets = config.secrets || {}
const rootDir = path.resolve(process.argv[3])
process.stdout.write(`${path.resolve(rootDir, secrets.file || 'run/secrets.enc.json')}\n${path.resolve(rootDir, secrets.passwordFile || 'run/.secrets-password')}\n`)
NODE
}

patch_starter_password_file_reuse() {
    local starter_file=$1

    node - "$starter_file" <<'NODE'
const fs = require('fs')
const starterFile = process.argv[2]
const source = fs.readFileSync(starterFile, 'utf8')
const replacement = `  if [[ -f "$SECRETS_PASSWORD_FILE" ]]; then
    return 0
  fi`
const patterns = [
  `  if [[ -f "$SECRETS_PASSWORD_FILE" ]]; then
    if is_production_environment; then
      TEMP_SECRETS_PASSWORD_FILE="$SECRETS_PASSWORD_FILE"
    fi
    return 0
  fi`,
  `  if [[ -f "$SECRETS_PASSWORD_FILE" ]]; then
    if ! is_production_environment; then
      return 0
    fi
  fi`,
]

if (source.includes(replacement)) {
  process.exit(0)
}

for (const pattern of patterns) {
  if (source.includes(pattern)) {
    fs.writeFileSync(starterFile, source.replace(pattern, replacement))
    process.exit(0)
  }
}

console.error('starter.sh password-file block was not recognized')
process.exit(1)
NODE
}

if [[ "$phase" == "prepare" || "$phase" == "finalize" ]]; then
    exit 0
fi

if [[ "$phase" != "copy-config" && "$phase" != "post-copy" ]]; then
    printf 'Unsupported upgrade phase: %s\n' "$phase" >&2
    exit 1
fi

if [[ "$phase" == "copy-config" ]]; then
    [[ -f "${current_dir}/config.js" ]] || {
        printf 'Config file not found: %s/config.js\n' "$current_dir" >&2
        exit 1
    }
    [[ -d "$target_dir" ]] || {
        printf 'Target directory not found: %s\n' "$target_dir" >&2
        exit 1
    }
    cp -f "${current_dir}/config.js" "${target_dir}/config.js"
    current_secrets_paths=$(resolve_secrets_paths "${current_dir}/config.js" "$current_dir")
    current_secrets_file=$(printf '%s\n' "$current_secrets_paths" | sed -n '1p')
    current_secrets_password_file=$(printf '%s\n' "$current_secrets_paths" | sed -n '2p')
    target_secrets_paths=$(resolve_secrets_paths "${target_dir}/config.js" "$target_dir")
    target_secrets_file=$(printf '%s\n' "$target_secrets_paths" | sed -n '1p')
    target_secrets_password_file=$(printf '%s\n' "$target_secrets_paths" | sed -n '2p')

    if [[ "$current_secrets_file" != "$target_secrets_file" && -f "$current_secrets_file" ]]; then
        mkdir -p "$(dirname "$target_secrets_file")"
        cp -pf "$current_secrets_file" "$target_secrets_file"
    fi
    if [[ "$current_secrets_password_file" != "$target_secrets_password_file" && -f "$current_secrets_password_file" ]]; then
        mkdir -p "$(dirname "$target_secrets_password_file")"
        cp -pf "$current_secrets_password_file" "$target_secrets_password_file"
    fi
    if [[ -f "$target_secrets_file" && -f "$target_secrets_password_file" ]]; then
        patch_starter_password_file_reuse "${target_dir}/scripts/starter.sh"
    fi
    exit 0
fi

exit 0
