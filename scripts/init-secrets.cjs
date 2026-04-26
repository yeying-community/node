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
      '  默认会生成：JWT_SECRET / UCAN_ISSUER_PRIVATE_KEY / UCAN_ISSUER_DID / TOTP_AUTH_TOTP_MASTER_KEY。',
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
  process.stdout.write('  - ucanIssuer.enabled = true\n');
  process.stdout.write('  - ucanIssuer.mode = hybrid (or issue)\n');
  process.stdout.write('  - totpAuth.enabled = true\n');
  process.stdout.write('\nStart with password prompt:\n');
  process.stdout.write(`  SECRETS_FILE=${filePath} bash scripts/starter.sh restart\n`);
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
});

