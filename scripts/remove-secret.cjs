#!/usr/bin/env node
const path = require('path');
const {
  loadVault,
  decryptSecrets,
  encryptSecrets,
  replaceVault,
  readPassword,
} = require('./secret-vault.cjs');

function parseArgs(argv) {
  const options = { file: path.join('run', 'secrets.enc.json'), name: '', help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') options.help = true;
    else if (token === '--file' || token === '-f') options.file = argv[++index] || '';
    else if (!options.name) options.name = token;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return options;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.name) {
    process.stdout.write('Usage: node scripts/remove-secret.cjs KEY [--file run/secrets.enc.json]\n');
    return;
  }
  const name = String(options.name).trim();
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error('Secret key must use uppercase letters, digits, and underscores');
  const password = await readPassword();
  const vault = loadVault(options.file);
  const secrets = decryptSecrets(vault, password);
  if (!Object.prototype.hasOwnProperty.call(secrets, name)) {
    process.stdout.write(`Secret not found: ${name}\n`);
    return;
  }
  const confirmation = await readPassword({ promptText: `请输入 ${name} 以确认删除` });
  if (confirmation !== name) throw new Error('确认值不匹配，未删除密钥');
  delete secrets[name];
  replaceVault(options.file, encryptSecrets(secrets, password));
  process.stdout.write(`Removed secret: ${name}\n`);
}

run().catch((error) => {
  process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
