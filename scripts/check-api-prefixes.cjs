#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT_DIR = process.cwd();
const ROUTES_DIR = path.join(ROOT_DIR, 'src', 'routes');
const EXPECTED_PREFIX = '/api/v1/';
const HTTP_METHOD_PATTERN = /(?:^|\s)app\.(get|post|put|patch|delete|all)\s*\(\s*([^,\n]+)/g;
const CONST_STRING_PATTERN = /const\s+([A-Za-z0-9_]+)\s*=\s*['"]([^'"]+)['"]/g;

function collectRouteFiles(dir) {
  const result = [];
  if (!fs.existsSync(dir)) return result;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && fullPath.endsWith('.ts')) {
        result.push(fullPath);
      }
    }
  }
  return result.sort();
}

function collectLocalStringConstants(content) {
  const map = new Map();
  let match;
  while ((match = CONST_STRING_PATTERN.exec(content)) !== null) {
    map.set(match[1], match[2]);
  }
  return map;
}

function resolvePathExpression(expr, constants) {
  const raw = String(expr || '').trim();
  if (!raw) return null;

  const quoted = raw.match(/^['"]([^'"]+)['"]$/);
  if (quoted) return quoted[1];

  const tplRef = raw.match(/^`?\$\{([A-Za-z0-9_]+)\}([^`]*)`?$/);
  if (tplRef) {
    const base = constants.get(tplRef[1]);
    if (!base) return null;
    return `${base}${tplRef[2] || ''}`;
  }

  return null;
}

function main() {
  const files = collectRouteFiles(ROUTES_DIR);
  const violations = [];

  files.forEach((filePath) => {
    const content = fs.readFileSync(filePath, 'utf8');
    const constants = collectLocalStringConstants(content);
    let match;
    while ((match = HTTP_METHOD_PATTERN.exec(content)) !== null) {
      const method = match[1].toUpperCase();
      const expr = match[2];
      const resolvedPath = resolvePathExpression(expr, constants);
      if (!resolvedPath) {
        continue;
      }
      if (!resolvedPath.startsWith(EXPECTED_PREFIX)) {
        violations.push({
          filePath,
          method,
          path: resolvedPath,
        });
      }
    }
  });

  if (violations.length > 0) {
    console.error('Found route path(s) without required /api/v1/ prefix:');
    violations.forEach((item) => {
      const rel = path.relative(ROOT_DIR, item.filePath);
      console.error(`- ${rel}: ${item.method} ${item.path}`);
    });
    process.exit(1);
    return;
  }

  console.log('API prefix check passed.');
}

main();
