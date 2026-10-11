#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 3 ]]; then
    printf 'Usage: %s <prepare|copy-config|post-copy|finalize> <current-dir> <target-dir>\n' "$0" >&2
    exit 1
fi

phase=$1
current_dir=$2
target_dir=$3

resolve_secrets_file() {
    local config_path=$1
    local root_dir=$2

    node - "$config_path" "$root_dir" <<'NODE'
const path = require('path')
const config = require(path.resolve(process.argv[2]))
const secrets = config.secrets || {}
const rootDir = path.resolve(process.argv[3])
process.stdout.write(`${path.resolve(rootDir, secrets.file || 'run/secrets.enc.json')}\n`)
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
    current_secrets_file=$(resolve_secrets_file "${current_dir}/config.js" "$current_dir")
    target_secrets_file=$(resolve_secrets_file "${target_dir}/config.js" "$target_dir")

    if [[ "$current_secrets_file" != "$target_secrets_file" && -f "$current_secrets_file" ]]; then
        mkdir -p "$(dirname "$target_secrets_file")"
        cp -pf "$current_secrets_file" "$target_secrets_file"
    fi
    exit 0
fi

exit 0
