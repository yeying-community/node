#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function usage() {
  process.stdout.write([
    'Usage:',
    '  node scripts/create-appstore-smoke-release.cjs --image <repo@sha256:digest> [options]',
    '',
    'Options:',
    '  --app-id <id>              Default: smoke',
    '  --version <semver>         Default: 0.1.0',
    '  --publisher-key-id <id>    Default: smoke-publisher',
    '  --publisher-owner <addr>   Wallet address to paste beside the public key',
    '  --host-port <port>         Default: 25080',
    '  --container-port <port>    Default: 8080',
    '  --health-path <path>       Default: /',
    '  --out <file>               Default: tmp/appstore-smoke-release.json',
    '',
    'The output file is the JSON body for POST /api/v1/publisher/releases/submit.',
  ].join('\n') + '\n');
}

function parseArgs(argv) {
  const options = {
    appId: 'smoke',
    version: '0.1.0',
    publisherKeyId: 'smoke-publisher',
    publisherOwner: '',
    image: '',
    hostPort: 25080,
    containerPort: 8080,
    healthPath: '/',
    out: path.join('tmp', 'appstore-smoke-release.json'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      usage();
      process.exit(0);
    }
    const next = argv[index + 1];
    if (!next) throw new Error(`Missing value for ${token}`);
    index += 1;
    switch (token) {
      case '--app-id': options.appId = next; break;
      case '--version': options.version = next; break;
      case '--publisher-key-id': options.publisherKeyId = next; break;
      case '--publisher-owner': options.publisherOwner = next; break;
      case '--image': options.image = next; break;
      case '--host-port': options.hostPort = Number(next); break;
      case '--container-port': options.containerPort = Number(next); break;
      case '--health-path': options.healthPath = next; break;
      case '--out': options.out = next; break;
      default: throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(options.appId)) throw new Error('Invalid --app-id');
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(options.version)) throw new Error('Invalid --version');
  if (!/^[^\s]+@sha256:[a-f0-9]{64}$/.test(options.image)) throw new Error('--image must be an immutable digest reference');
  if (!Number.isInteger(options.hostPort) || options.hostPort < 1024 || options.hostPort > 65535) throw new Error('Invalid --host-port');
  if (!Number.isInteger(options.containerPort) || options.containerPort < 1 || options.containerPort > 65535) throw new Error('Invalid --container-port');
  if (!options.healthPath.startsWith('/')) throw new Error('--health-path must start with /');
  return options;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(source) {
  return crypto.createHash('sha256').update(source).digest('hex');
}

function buildBundle(options, privateKey) {
  const displayName = `YeYing Smoke ${options.appId}`;
  const files = {
    'application.json': JSON.stringify({
      api_version: 'yeying.app/v1',
      kind: 'Application',
      metadata: {
        id: options.appId,
        name: { 'zh-CN': `Smoke ${options.appId}`, 'en-US': displayName },
        description: { 'zh-CN': 'AppStore 联调测试应用', 'en-US': 'AppStore integration smoke test application' },
        license: 'MIT',
        homepage: 'https://github.com/yeying-community/node',
      },
      spec: {
        version: options.version,
        host: { project: '>=0.0.1', protocol: '^1.0.0' },
        entries: [{
          id: 'main',
          location: 'application',
          label: { 'zh-CN': `Smoke ${options.appId}`, 'en-US': displayName },
          path: `/apps/${options.appId}/`,
          render: 'iframe',
          visibility: 'all',
        }],
      },
    }, null, 2),
    'runtime.json': JSON.stringify({
      api_version: 'yeying.app/v1',
      kind: 'Runtime',
      app_id: options.appId,
      version: options.version,
      image: options.image,
      service: {
        name: options.appId,
        container_port: options.containerPort,
        host_port: options.hostPort,
        route_prefix: `/apps/${options.appId}/`,
      },
      healthcheck: { protocol: 'http', path: options.healthPath, timeout_seconds: 60 },
      environment: [
        { name: 'YEYING_APP_URL', from_env: 'APP_URL', required: true },
      ],
    }, null, 2),
    'config.schema.json': JSON.stringify({ type: 'object', properties: {}, additionalProperties: false }, null, 2),
    'permissions.json': JSON.stringify({ host_api: [], events: [], application_api: [] }, null, 2),
    'compose.yaml': [
      'services:',
      `  ${options.appId}:`,
      `    image: ${options.image}`,
      '    env_file:',
      '      - runtime.env',
      '    ports:',
      `      - "127.0.0.1:${options.hostPort}:${options.containerPort}"`,
      '    restart: unless-stopped',
      '',
    ].join('\n'),
  };
  const checksums = Object.fromEntries(Object.entries(files).map(([name, content]) => [name, sha256(content)]));
  files['checksums.json'] = JSON.stringify(checksums, null, 2);
  const signedDigest = `sha256:${sha256(stableStringify(checksums))}`;
  files['signature.json'] = JSON.stringify({
    algorithm: 'ed25519',
    key_id: options.publisherKeyId,
    signed_digest: signedDigest,
    value: crypto.sign(null, Buffer.from(signedDigest), privateKey).toString('base64'),
  }, null, 2);
  return { files, signedDigest };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const keys = crypto.generateKeyPairSync('ed25519');
  const { files, signedDigest } = buildBundle(options, keys.privateKey);
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const body = { publisher_key_id: options.publisherKeyId, files };
  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  fs.writeFileSync(options.out, JSON.stringify(body, null, 2));
  process.stdout.write(`Wrote ${options.out}\n`);
  process.stdout.write(`Release digest candidate: ${signedDigest}\n`);
  process.stdout.write('Register this publisher key in config.js:\n');
  process.stdout.write(`${JSON.stringify(options.publisherKeyId)}: { owner: ${JSON.stringify(options.publisherOwner || '<publisher-wallet-address>')}, publicKey: ${JSON.stringify(publicKey)} }\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
