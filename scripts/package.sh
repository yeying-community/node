#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=package-common.sh
source "$SCRIPT_DIR/package-common.sh"
package_common_init node "$@"
command -v npm >/dev/null 2>&1 || package_fail 'npm is required'
(cd "$PACKAGE_ROOT_DIR" && npm install --no-audit --no-fund && npm run build)
(cd "$PACKAGE_ROOT_DIR/web" && npm install --no-audit --no-fund && npm run build)
# Install runtime modules after TypeScript compilation.
(cd "$PACKAGE_ROOT_DIR" && npm install --omit=dev --no-audit --no-fund)
package_make_root node
mkdir -p "$PACKAGE_DIR/web"
cp -R "$PACKAGE_ROOT_DIR/dist" "$PACKAGE_DIR/dist"
cp -R "$PACKAGE_ROOT_DIR/web/dist" "$PACKAGE_DIR/web/dist"
cp -R "$PACKAGE_ROOT_DIR/node_modules" "$PACKAGE_DIR/node_modules"
cp "$PACKAGE_ROOT_DIR/package.json" "$PACKAGE_DIR/"
cp "$PACKAGE_ROOT_DIR/config.js.template" "$PACKAGE_DIR/"
[[ ! -f "$PACKAGE_ROOT_DIR/README.md" ]] || cp "$PACKAGE_ROOT_DIR/README.md" "$PACKAGE_DIR/"
[[ ! -f "$PACKAGE_ROOT_DIR/cmd" ]] || install -m 0755 "$PACKAGE_ROOT_DIR/cmd" "$PACKAGE_DIR/cmd"
package_copy_scripts "$PACKAGE_DIR/scripts"
package_strip_build_files "$PACKAGE_DIR"
package_finish_artifact service-with-assets
package_finish
