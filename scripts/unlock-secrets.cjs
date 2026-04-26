#!/usr/bin/env node
const path = require('path');
const { loadVault, decryptSecrets, readPassword } = require('./secret-vault.cjs');

function printUsage() {
  process.stdout.write(
    [
      'Usage:',
      '  node scripts/unlock-secrets.cjs [--file run/secrets.enc.json] [--print-env]',
      '',
      'Description:',
      '  解密本地密钥文件，并输出 KEY=VALUE 列表（默认行为）。',
      '',
      'Password Input:',
      '  默认交互输入；也可通过环境变量 NODE_SECRETS_PASSWORD 提供。',
      '',
    ].join('\n')
  );
}

function parseArgs(argv) {
  const options = {
    file: path.join('run', 'secrets.enc.json'),
    printEnv: true,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      options.help = true;
      continue;
    }
    if (token === '--print-env') {
      options.printEnv = true;
      continue;
    }
    if (token === '--file' || token === '-f') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('Missing value for --file');
      }
      options.file = next;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return options;
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

  const password = await readPassword({ promptText: '请输入密钥文件密码' });
  if (!password) {
    throw new Error('密码不能为空');
  }
  const vault = loadVault(options.file);
  const secrets = decryptSecrets(vault, password);
  if (!options.printEnv) {
    return;
  }
  Object.keys(secrets)
    .sort()
    .forEach((key) => {
      const value = String(secrets[key] ?? '');
      process.stdout.write(`${key}=${value}\n`);
    });
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
});

