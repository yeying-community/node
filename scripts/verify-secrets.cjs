#!/usr/bin/env node
const path = require('path');
const { loadVault, decryptSecrets, readPassword } = require('./secret-vault.cjs');

function parseArgs(argv) {
  const options = { file: '', config: 'config.js', help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') options.help = true;
    else if (token === '--file' || token === '-f') options.file = argv[++index] || '';
    else if (token === '--config' || token === '-c') options.config = argv[++index] || '';
    else throw new Error(`Unknown argument: ${token}`);
  }
  return options;
}

function requiredKeys(config) {
  const keys = ['DATABASE_USERNAME', 'DATABASE_PASSWORD', 'ISSUER_PRIVATE_KEY'];
  const issuer = config.issuer?.ucan || {};
  if (issuer.enabled && ['issue', 'hybrid'].includes(issuer.mode)) {
    keys.push('ISSUER_PRIVATE_KEY');
  }
  if (config.auth) {
    keys.push('NODE_KEY_DERIVATION_SECRET');
  }
  return keys;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write('Usage: node scripts/verify-secrets.cjs [--config config.js] [--file run/secrets.enc.json]\n');
    return;
  }
  const configPath = path.resolve(options.config);
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const config = require(configPath);
  const vaultPath = path.resolve(options.file || config?.secrets?.file || 'run/secrets.enc.json');
  const password = await readPassword({ promptText: '请输入密钥文件密码' });
  const secrets = decryptSecrets(loadVault(vaultPath), password);
  const missing = requiredKeys(config).filter((name) => {
    const alternatives = name.split('|');
    return !alternatives.some((key) => String(secrets[key] || '').trim());
  });
  if (missing.length > 0) throw new Error(`Missing required secret keys: ${missing.join(', ')}`);
  process.stdout.write(`Secrets verification passed: ${vaultPath}\n`);
  process.stdout.write(`Required keys verified: ${requiredKeys(config).join(', ')}\n`);
}

run().catch((error) => {
  process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
