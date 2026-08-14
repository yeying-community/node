#!/usr/bin/env node
const path = require('path');
const {
  encryptSecrets,
  saveVault,
  readPassword,
  generateDefaultSecrets,
} = require('./secret-vault.cjs');

function printUsage() {
  process.stdout.write(
    [
      'Usage:',
      '  node scripts/init-secrets.cjs [--file run/secrets.enc.json] [--force]',
      '',
      'Description:',
      '  生成生产密钥并加密保存到本地文件（默认 run/secrets.enc.json）。',
      '  默认会生成应用密钥；数据库、Redis、SMTP等外部凭据请使用 secrets:set 写入。',
      '',
      'Password Input:',
      '  默认交互输入；生产环境建议使用 secrets.passwordFile。',
      '',
    ].join('\n')
  );
}

function parseArgs(argv) {
  const options = {
    file: path.join('run', 'secrets.enc.json'),
    force: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      options.help = true;
      continue;
    }
    if (token === '--force') {
      options.force = true;
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

  const password = await readPassword({ promptText: '请输入加密密码' });
  if (!password) {
    throw new Error('密码不能为空');
  }
  const confirm = await readPassword({ promptText: '请再次输入加密密码' });
  if (password !== confirm) {
    throw new Error('两次密码输入不一致');
  }

  const secrets = generateDefaultSecrets();
  const vault = encryptSecrets(secrets, password);
  const filePath = saveVault(options.file, vault, options.force);

  process.stdout.write(`Encrypted secret vault created: ${filePath}\n`);
  process.stdout.write('Generated keys (value hidden):\n');
  Object.keys(secrets)
    .sort()
    .forEach((key) => {
      process.stdout.write(`  - ${key}\n`);
    });
  process.stdout.write('\nRecommended config alignment (non-secret):\n');
  process.stdout.write('  - issuer.ucan.enabled = true\n');
  process.stdout.write('  - issuer.ucan.mode = hybrid (or issue)\n');
  process.stdout.write('  - totpAuth.enabled = true\n');
  process.stdout.write('\nSet config.js secrets.file to this path, then start:\n');
  process.stdout.write('  bash scripts/starter.sh restart\n');
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
});
