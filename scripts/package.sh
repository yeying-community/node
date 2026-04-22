#!/usr/bin/env bash
set -euo pipefail

TAG_INPUT="${1:-}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/output"
WORK_DIR=""
WORKTREE_DIR=""

info() {
  printf '%s\n' "$*" >&2
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$WORKTREE_DIR" && -d "$WORKTREE_DIR" ]]; then
    git -C "$ROOT_DIR" worktree remove --force "$WORKTREE_DIR" >/dev/null 2>&1 || true
  fi
  if [[ -n "$WORK_DIR" && -d "$WORK_DIR" ]]; then
    rm -rf "$WORK_DIR"
  fi
}

trap cleanup EXIT

require_command() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || fail "缺少命令: $cmd"
}

validate_tag_format() {
  local tag="$1"
  [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

git_ref_exists() {
  local ref="$1"
  git -C "$ROOT_DIR" rev-parse --verify --quiet "$ref" >/dev/null
}

list_release_tags() {
  git -C "$ROOT_DIR" tag --list 'v*' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' || true
}

latest_release_tag() {
  list_release_tags | sort -V | tail -n 1
}

tag_commit() {
  local tag="$1"
  git -C "$ROOT_DIR" rev-list -n 1 "$tag"
}

increment_patch_tag() {
  local latest="$1"
  if [[ -z "$latest" ]]; then
    printf 'v0.0.1\n'
    return 0
  fi

  local version="${latest#v}"
  local major minor patch
  IFS='.' read -r major minor patch <<<"$version"
  printf 'v%s.%s.%s\n' "$major" "$minor" "$((patch + 1))"
}

sync_git_refs() {
  if ! git -C "$ROOT_DIR" remote get-url origin >/dev/null 2>&1; then
    return 0
  fi

  git -C "$ROOT_DIR" fetch origin --tags main >/dev/null 2>&1 || \
    info "警告: 拉取 origin/main 或 tags 失败，将继续使用本地 Git 引用。"
}

ensure_build_dependencies() {
  local dir="$1"
  if [[ -f "$dir/package-lock.json" ]]; then
    if ! (
      cd "$dir"
      npm ci --no-audit --no-fund
    ); then
      info "npm ci 失败，回退到 npm install: $dir"
      (
        cd "$dir"
        npm install --no-audit --no-fund
      )
    fi
  else
    (
      cd "$dir"
      npm install --no-audit --no-fund
    )
  fi
}

copy_release_files() {
  local release_root="$1"

  mkdir -p \
    "$release_root/scripts" \
    "$release_root/web" \
    "$release_root/docs" \
    "$release_root/data" \
    "$release_root/run" \
    "$release_root/logs"

  cp -R "$WORKTREE_DIR/dist" "$release_root/dist"
  cp -R "$WORKTREE_DIR/web/dist" "$release_root/web/dist"
  cp "$WORKTREE_DIR/package.json" "$release_root/package.json"
  cp "$WORKTREE_DIR/package-lock.json" "$release_root/package-lock.json"
  cp "$WORKTREE_DIR/config.js.template" "$release_root/config.js.template"
  cp "$WORKTREE_DIR/README.md" "$release_root/README.md"
  cp "$WORKTREE_DIR/scripts/starter.sh" "$release_root/scripts/starter.sh"
  cp "$WORKTREE_DIR/docs/运行配置.md" "$release_root/docs/运行配置.md"
  chmod +x "$release_root/scripts/starter.sh"
}

create_tarball() {
  local project_name="$1"
  local tag_name="$2"
  local short_hash="$3"

  mkdir -p "$OUTPUT_DIR"
  local package_dir="${project_name}-${tag_name}-${short_hash}"
  local release_root="$WORK_DIR/$package_dir"
  copy_release_files "$release_root"

  local tarball="$OUTPUT_DIR/${package_dir}.tar.gz"
  rm -f "$tarball"
  tar -czf "$tarball" -C "$WORK_DIR" "$package_dir"
  info "安装包已生成: $tarball"
}

resolve_project_name() {
  (
    cd "${WORKTREE_DIR:-$ROOT_DIR}"
    node -p "const pkg=require('./package.json'); String(pkg.name || 'node-app').trim()"
  ) | tr ' /' '--'
}

create_and_push_tag() {
  local new_tag="$1"
  local commit="$2"

  git -C "$ROOT_DIR" tag -a "$new_tag" -m "release $new_tag" "$commit"
  if ! git -C "$ROOT_DIR" push origin "refs/tags/$new_tag"; then
    git -C "$ROOT_DIR" tag -d "$new_tag" >/dev/null 2>&1 || true
    fail "推送 tag 失败: $new_tag"
  fi
}

resolve_target_tag() {
  if [[ -n "$TAG_INPUT" ]]; then
    validate_tag_format "$TAG_INPUT" || fail "TAG 格式不合法，必须为 v<major>.<minor>.<patch>"
    git_ref_exists "refs/tags/$TAG_INPUT" || fail "TAG 不存在，不执行打包: $TAG_INPUT"
    printf '%s\n' "$TAG_INPUT"
    return 0
  fi

  sync_git_refs

  local current_branch latest_tag latest_tag_commit current_main_commit next_tag
  current_branch="$(git -C "$ROOT_DIR" branch --show-current)"
  [[ "$current_branch" == "main" ]] || fail "无 TAG 模式必须在 main 分支执行"

  latest_tag="$(latest_release_tag)"
  current_main_commit="$(git -C "$ROOT_DIR" rev-parse HEAD)"

  if [[ -n "$latest_tag" ]]; then
    latest_tag_commit="$(tag_commit "$latest_tag")"
    if [[ "$latest_tag_commit" = "$current_main_commit" ]]; then
      info "main 最新提交已经存在发布 TAG($latest_tag)，不再重复打包。"
      exit 0
    fi
  fi

  next_tag="$(increment_patch_tag "$latest_tag")"
  info "创建新 TAG: $next_tag"
  create_and_push_tag "$next_tag" "$current_main_commit"
  printf '%s\n' "$next_tag"
}

prepare_worktree() {
  local target_tag="$1"
  WORK_DIR="$(mktemp -d)"
  WORKTREE_DIR="$WORK_DIR/source"
  git -C "$ROOT_DIR" worktree add --detach "$WORKTREE_DIR" "refs/tags/$target_tag" >/dev/null
}

build_release() {
  (
    cd "$WORKTREE_DIR"
    npm run build
  )
  (
    cd "$WORKTREE_DIR/web"
    npm run build
  )
}

main() {
  require_command git
  require_command tar
  require_command node
  require_command npm

  local target_tag project_name short_hash
  target_tag="$(resolve_target_tag)"
  info "开始基于 $target_tag 打包..."

  prepare_worktree "$target_tag"
  ensure_build_dependencies "$WORKTREE_DIR"
  ensure_build_dependencies "$WORKTREE_DIR/web"
  build_release

  project_name="$(resolve_project_name)"
  short_hash="$(git -C "$WORKTREE_DIR" rev-parse --short=7 HEAD)"
  create_tarball "$project_name" "$target_tag" "$short_hash"
}

main "$@"
