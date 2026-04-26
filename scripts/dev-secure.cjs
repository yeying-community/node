#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');
const { readPassword } = require('./secret-vault.cjs');

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
          '  默认密文路径优先级：--file > SECRETS_FILE > config.js secrets.file > run/secrets.enc.json',
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
  const password = await readPassword({ promptText: '请输入密钥文件密码' });
  if (!password) {
    throw new Error('密码不能为空');
  }

  const env = { ...process.env, NODE_SECRETS_PASSWORD: password };
  if (options.file) {
    env.SECRETS_FILE = path.resolve(options.file);
  }

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
