#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const openapiPath = path.join(__dirname, '..', 'openapi.json');
const doc = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));
const paths = Object.keys(doc.paths || {});

const adminModules = ['provider', 'spider', 'recycle', 'invitation', 'user', 'audit'];
const internalModules = ['config', 'minio', 'mail', 'certificate', 'event', 'block'];
const publicPaths = ['/api/v1/public/auth', '/api/v1/public/healthCheck'];

let failed = false;

function expectPrefix(module, prefix) {
  const hits = paths.filter((p) => p.startsWith(`/api/v1/${module}/`));
  if (hits.length) {
    console.error(`[FAIL] Found legacy prefix for ${module}: ${hits.join(', ')}`);
    failed = true;
  }
  const expected = paths.filter((p) => p.startsWith(`${prefix}${module}/`));
  if (!expected.length && module !== 'audit') {
    console.error(`[WARN] No endpoints found for ${module} under ${prefix}`);
  }
}

adminModules.forEach((module) => {
  if (module === 'audit') {
    const adminAudit = paths.filter((p) => p.startsWith('/api/v1/admin/audit/'));
    if (!adminAudit.length) {
      console.error('[FAIL] Missing admin audit endpoints');
      failed = true;
    }
    return;
  }
  expectPrefix(module, '/api/v1/admin/');
});

internalModules.forEach((module) => expectPrefix(module, '/api/v1/internal/'));

const publicIssues = paths.filter((p) => p.startsWith('/api/v1/public/') && !publicPaths.some((prefix) => p.startsWith(prefix)));
if (publicIssues.length) {
  console.error(`[FAIL] Unexpected public endpoints: ${publicIssues.join(', ')}`);
  failed = true;
}

if (!failed) {
  console.log('API prefix check OK');
}

process.exit(failed ? 1 : 0);
