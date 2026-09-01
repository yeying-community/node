#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { readPassword } = require('./secret-vault.cjs');

const PASSWORD_PROMPT_TIMEOUT_MS = 30_000;

function parseArgs(argv) {
  const options = { file: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--file' || token === '-f') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('Missing value for --file');
      }
      options.file = String(next).trim();
      index += 1;
      continue;
    }
    if (token === '--help' || token === '-h') {
      process.stdout.write(
        [
          'Usage:',
          '  node scripts/dev-secure.cjs [--file run/secrets.enc.json]',
          '',
          'Description:',
          '  输入密钥文件口令后启动 npm run dev（进程内解密）。',
          '  密文文件和一次性密码文件均由 config.js 的 secrets 配置决定。',
          '',
        ].join('\n')
      );
      process.exit(0);
      return options;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  return options;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const configPath = path.resolve(process.cwd(), process.env.APP_CONFIG_PATH || 'config.js');
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const config = require(configPath);
  const configuredVault = String(config?.secrets?.file || 'run/secrets.enc.json');
  const passwordFile = path.resolve(String(config?.secrets?.passwordFile || 'run/.secrets-password'));
  if (options.file && path.resolve(options.file) !== path.resolve(configuredVault)) {
    throw new Error('--file must match config.js secrets.file');
  }
  if (!fs.existsSync(passwordFile)) {
    const password = await readPassword({ promptText: '请输入密钥文件密码', timeoutMs: PASSWORD_PROMPT_TIMEOUT_MS });
    if (!password) {
      throw new Error('密码不能为空');
    }
    fs.mkdirSync(path.dirname(passwordFile), { recursive: true });
    fs.writeFileSync(passwordFile, password, { mode: 0o600 });
    fs.chmodSync(passwordFile, 0o600);
  }
  const env = { ...process.env };

  const child = spawn('npm', ['run', 'dev'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32',
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
});
