#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const {
  loadVault,
  decryptSecrets,
  encryptSecrets,
  replaceVault,
  readPassword,
} = require('./secret-vault.cjs');

const SECRET_NAME = 'ADMIN_DIDS';

function printUsage() {
  process.stdout.write(
    [
      'Usage:',
      '  node scripts/admin-allow.cjs add <did-or-wallet> [--config config.js] [--file run/secrets.enc.json]',
      '  node scripts/admin-allow.cjs remove <did-or-wallet> [--config config.js] [--file run/secrets.enc.json]',
      '  node scripts/admin-allow.cjs list [--config config.js] [--file run/secrets.enc.json]',
      '',
      'Description:',
      '  Manage the encrypted ADMIN_DIDS bootstrap allowlist.',
      '  This script reads and rewrites secrets.enc.json after password verification.',
      '  Running Node services load ADMIN_DIDS at startup and must be restarted after add/remove.',
      '',
    ].join('\n')
  );
}

function parseArgs(argv) {
  const options = { file: '', config: 'config.js', action: 'add', principal: '', help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') options.help = true;
    else if (token === '--file' || token === '-f') options.file = argv[++index] || '';
    else if (token === '--config' || token === '-c') options.config = argv[++index] || '';
    else if (['add', 'remove', 'list'].includes(token) && !options.principal) options.action = token;
    else if (!options.principal) options.principal = token;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return options;
}

function normalizePrincipal(value) {
  const normalized = String(value || '').trim();
  if (/^0x[0-9a-fA-F]{40}$/i.test(normalized)) {
    return normalized.toLowerCase();
  }
  return normalized;
}

function parsePrincipals(value) {
  const seen = new Set();
  const items = [];
  String(value || '')
    .split(/[\n,]/)
    .map((item) => normalizePrincipal(item))
    .filter(Boolean)
    .forEach((item) => {
      if (!seen.has(item)) {
        seen.add(item);
        items.push(item);
      }
    });
  return items;
}

function loadConfig(configFile) {
  const configPath = path.resolve(configFile || 'config.js');
  if (!fs.existsSync(configPath)) {
    return {};
  }
  // eslint-disable-next-line import/no-dynamic-require, global-require
  return require(configPath);
}

function resolveVaultPath(options) {
  if (options.file) {
    return path.resolve(options.file);
  }
  const config = loadConfig(options.config);
  return path.resolve(config?.secrets?.file || path.join('run', 'secrets.enc.json'));
}

async function readSecrets(file) {
  const password = await readPassword({ promptText: '请输入密钥文件密码' });
  if (!password) throw new Error('密码不能为空');
  const vault = loadVault(file);
  return { password, secrets: decryptSecrets(vault, password) };
}

async function run() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`ERROR: ${error.message}\n`);
    printUsage();
    process.exit(1);
    return;
  }

  if (options.help) {
    printUsage();
    return;
  }
  if (!['add', 'remove', 'list'].includes(options.action)) {
    throw new Error(`Unsupported action: ${options.action}`);
  }
  if (options.action !== 'list' && !normalizePrincipal(options.principal)) {
    throw new Error('Admin DID or wallet address is required');
  }

  const vaultPath = resolveVaultPath(options);
  const { password, secrets } = await readSecrets(vaultPath);
  const current = parsePrincipals(secrets[SECRET_NAME]);
  const principal = normalizePrincipal(options.principal);

  if (options.action === 'list') {
    process.stdout.write(`Vault file: ${vaultPath}\n`);
    process.stdout.write(`Configured admin principals (${current.length}):\n`);
    current.forEach((item) => process.stdout.write(`  - ${item}\n`));
    return;
  }

  let next = current;
  if (options.action === 'add') {
    next = current.includes(principal) ? current : [...current, principal];
  } else if (options.action === 'remove') {
    next = current.filter((item) => item !== principal);
  }

  secrets[SECRET_NAME] = next.join('\n');
  replaceVault(vaultPath, encryptSecrets(secrets, password));
  process.stdout.write(`${options.action === 'add' ? 'Added' : 'Removed'} admin principal: ${principal}\n`);
  process.stdout.write(`Configured admin principals: ${next.length}\n`);
  process.stdout.write('Restart the running Node service for ADMIN_DIDS changes to take effect.\n');
}

run().catch((error) => {
  process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
