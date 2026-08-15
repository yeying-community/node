#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const {
  loadVault,
  decryptSecrets,
  encryptSecrets,
  replaceVault,
  readPassword,
} = require('./secret-vault.cjs');

const MIGRATIONS = [
  ['DATABASE_USERNAME', ['database', 'username']],
  ['DATABASE_PASSWORD', ['database', 'password']],
  ['REDIS_USERNAME', ['redis', 'username']],
  ['REDIS_PASSWORD', ['redis', 'password']],
  ['MAIL_SMTP_USER', ['mail', 'auth', 'user']],
  ['MAIL_SMTP_PASSWORD', ['mail', 'auth', 'pass']],
];

function parseArgs(argv) {
  const options = { config: 'config.js', file: '', help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') options.help = true;
    else if (token === '--config' || token === '-c') options.config = argv[++index] || '';
    else if (token === '--file' || token === '-f') options.file = argv[++index] || '';
    else throw new Error(`Unknown argument: ${token}`);
  }
  return options;
}

function getValue(input, keys) {
  return keys.reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), input);
}

function removeConfigProperties(configPath, paths) {
  let source = fs.readFileSync(configPath, 'utf8');
  for (const keys of paths) {
    const property = keys[keys.length - 1];
    const pattern = new RegExp(`^[\\t ]*${property}\\s*:\\s*[^,\\n]+,?\\s*(?://[^\\n]*)?\\n`, 'm');
    if (!pattern.test(source)) throw new Error(`Cannot safely remove ${keys.join('.')} from ${configPath}`);
    source = source.replace(pattern, '');
  }
  const temporaryPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, source, { mode: fs.statSync(configPath).mode & 0o777 });
  fs.renameSync(temporaryPath, configPath);
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write('Usage: node scripts/migrate-config-secrets.cjs [--config config.js] [--file run/secrets.enc.json]\n');
    return;
  }
  const configPath = path.resolve(options.config);
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const config = require(configPath);
  const vaultPath = path.resolve(options.file || config?.secrets?.file || 'run/secrets.enc.json');
  const pending = MIGRATIONS.filter(([, keys]) => String(getValue(config, keys) || '').trim());
  if (pending.length === 0) {
    process.stdout.write('No plaintext secrets found in config.js.\n');
    return;
  }
  const password = await readPassword({ promptText: '请输入密钥文件密码' });
  const secrets = decryptSecrets(loadVault(vaultPath), password);
  for (const [name, keys] of pending) secrets[name] = String(getValue(config, keys)).trim();
  replaceVault(vaultPath, encryptSecrets(secrets, password));
  removeConfigProperties(configPath, pending.map(([, keys]) => keys));
  process.stdout.write(`Migrated and removed ${pending.length} config secrets: ${pending.map(([name]) => name).join(', ')}\n`);
}

run().catch((error) => {
  process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
