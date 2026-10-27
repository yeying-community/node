#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const MANAGED_START = '// BEGIN YEYING AUDIT CONFIG (managed by ./cmd audit)';
const MANAGED_END = '// END YEYING AUDIT CONFIG';
const WALLET_PATTERN = /^0x[0-9a-fA-F]{40}$/;

function printUsage() {
  process.stdout.write(
    [
      'Usage:',
      '  node scripts/audit-config.cjs show [--config config.js]',
      '  node scripts/audit-config.cjs set --approvers <wallet[,wallet...]> --required-approvals <count> [--config config.js]',
      '  node scripts/audit-config.cjs approver add <wallet> [--config config.js]',
      '  node scripts/audit-config.cjs approver remove <wallet> [--config config.js]',
      '  node scripts/audit-config.cjs threshold set <count> [--config config.js]',
      '',
      'Description:',
      '  Safely show or update the runtime audit approval policy.',
      '  JavaScript configs keep their existing contents and receive a managed override block.',
      '  Running Node services cache config at startup and must be restarted after updates.',
      '',
    ].join('\n')
  );
}

function parseArgs(argv) {
  const positional = [];
  const options = {
    config: process.env.APP_CONFIG_PATH || 'config.js',
    approvers: undefined,
    requiredApprovals: undefined,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      options.help = true;
    } else if (token === '--config' || token === '-c') {
      options.config = argv[++index] || '';
    } else if (token === '--approvers') {
      options.approvers = argv[++index];
    } else if (token === '--required-approvals' || token === '--threshold') {
      options.requiredApprovals = argv[++index];
    } else if (token.startsWith('-')) {
      throw new Error(`Unknown option: ${token}`);
    } else {
      positional.push(token);
    }
  }

  if (!options.config) throw new Error('Config file path is required');
  return { positional, options };
}

function normalizeWallet(value) {
  const wallet = String(value || '').trim();
  if (!WALLET_PATTERN.test(wallet)) {
    throw new Error(`Invalid audit approver wallet: ${wallet || '<empty>'}`);
  }
  return wallet.toLowerCase();
}

function parseApprovers(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[\n,]/);
  const seen = new Set();
  const approvers = [];
  raw
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .forEach((item) => {
      const wallet = normalizeWallet(item);
      if (!seen.has(wallet)) {
        seen.add(wallet);
        approvers.push(wallet);
      }
    });
  return approvers;
}

function parseRequiredApprovals(value) {
  const raw = String(value ?? '').trim();
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error('requiredApprovals must be a positive integer');
  }
  const count = Number(raw);
  if (!Number.isSafeInteger(count)) {
    throw new Error('requiredApprovals is too large');
  }
  return count;
}

function validatePolicy(policy) {
  const approvers = parseApprovers(policy.approvers || []);
  const requiredApprovals = parseRequiredApprovals(policy.requiredApprovals ?? 1);
  if (approvers.length > 0 && requiredApprovals > approvers.length) {
    throw new Error(
      `requiredApprovals (${requiredApprovals}) cannot exceed approver count (${approvers.length})`
    );
  }
  if (approvers.length === 0 && requiredApprovals !== 1) {
    throw new Error('requiredApprovals must be 1 when no audit approvers are configured');
  }
  return { approvers, requiredApprovals };
}

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const resolved = require.resolve(configPath);
  delete require.cache[resolved];
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const loaded = require(resolved);
  const config = loaded && loaded.default ? loaded.default : loaded;
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`Config must export an object: ${configPath}`);
  }
  return config;
}

function readPolicy(configPath) {
  const config = loadConfig(configPath);
  const audit = config.audit || {};
  return validatePolicy({
    approvers: Array.isArray(audit.approvers) ? audit.approvers : [],
    requiredApprovals: audit.requiredApprovals ?? 1,
  });
}

function renderManagedBlock(policy) {
  const serialized = JSON.stringify(policy, null, 2);
  return `${MANAGED_START}\n;(module.exports && module.exports.default ? module.exports.default : module.exports).audit = ${serialized};\n${MANAGED_END}`;
}

function replaceManagedBlock(source, block) {
  const start = source.indexOf(MANAGED_START);
  const end = source.indexOf(MANAGED_END);
  if (start === -1 && end === -1) {
    return `${source.replace(/\s*$/, '')}\n\n${block}\n`;
  }
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Config contains an incomplete managed audit block; repair it before retrying');
  }
  const afterEnd = end + MANAGED_END.length;
  if (source.indexOf(MANAGED_START, start + MANAGED_START.length) !== -1) {
    throw new Error('Config contains multiple managed audit blocks; repair it before retrying');
  }
  return `${source.slice(0, start)}${block}${source.slice(afterEnd)}`;
}

function atomicWrite(filePath, contents, mode) {
  const directory = path.dirname(filePath);
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.audit-${process.pid}-${Date.now()}.tmp`
  );
  try {
    fs.writeFileSync(temporary, contents, { encoding: 'utf8', mode });
    fs.renameSync(temporary, filePath);
    fs.chmodSync(filePath, mode);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function writePolicy(configPath, policy) {
  const normalized = validatePolicy(policy);
  const stat = fs.statSync(configPath);
  const mode = stat.mode & 0o777;
  const extension = path.extname(configPath).toLowerCase();
  const original = fs.readFileSync(configPath, 'utf8');
  let updated;

  if (extension === '.json') {
    const config = loadConfig(configPath);
    config.audit = normalized;
    updated = `${JSON.stringify(config, null, 2)}\n`;
  } else if (extension === '.js' || extension === '.cjs' || extension === '') {
    updated = replaceManagedBlock(original, renderManagedBlock(normalized));
  } else {
    throw new Error(`Unsupported config file extension: ${extension}`);
  }

  atomicWrite(configPath, updated, mode);
  try {
    const effective = readPolicy(configPath);
    if (JSON.stringify(effective) !== JSON.stringify(normalized)) {
      throw new Error('Audit config verification failed after update');
    }
    return effective;
  } catch (error) {
    atomicWrite(configPath, original, mode);
    throw error;
  }
}

function printPolicy(configPath, policy) {
  process.stdout.write(`Config file: ${configPath}\n`);
  process.stdout.write(`Required approvals: ${policy.requiredApprovals}\n`);
  process.stdout.write(`Configured audit approvers (${policy.approvers.length}):\n`);
  if (policy.approvers.length === 0) {
    process.stdout.write('  (none)\n');
  } else {
    policy.approvers.forEach((item) => process.stdout.write(`  - ${item}\n`));
  }
}

function updatedMessage(configPath, policy) {
  process.stdout.write('Audit policy updated.\n');
  printPolicy(configPath, policy);
  process.stdout.write('The policy applies to newly created audits; existing audits keep their saved policy.\n');
  process.stdout.write('Restart the running Node service for audit config changes to take effect.\n');
}

function run() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const requestedConfigPath = path.resolve(options.config);
  if (!fs.existsSync(requestedConfigPath)) {
    throw new Error(`Config file not found: ${requestedConfigPath}`);
  }
  // Update the target of a deployment symlink instead of replacing the symlink itself.
  const configPath = fs.realpathSync(requestedConfigPath);
  const command = positional[0] || 'show';

  if (command === 'show') {
    if (positional.length !== 1) throw new Error('usage: audit show [--config config.js]');
    printPolicy(configPath, readPolicy(configPath));
    return;
  }

  if (command === 'set') {
    if (positional.length !== 1) {
      throw new Error('usage: audit set --approvers <wallet[,wallet...]> --required-approvals <count>');
    }
    if (options.approvers === undefined || options.requiredApprovals === undefined) {
      throw new Error('set requires --approvers and --required-approvals');
    }
    const updated = writePolicy(configPath, {
      approvers: parseApprovers(options.approvers),
      requiredApprovals: parseRequiredApprovals(options.requiredApprovals),
    });
    updatedMessage(configPath, updated);
    return;
  }

  if (command === 'approver') {
    const action = positional[1];
    const wallet = positional[2];
    if (!['add', 'remove'].includes(action) || positional.length !== 3) {
      throw new Error('usage: audit approver add|remove <wallet>');
    }
    const current = readPolicy(configPath);
    const normalized = normalizeWallet(wallet);
    const approvers = action === 'add'
      ? Array.from(new Set([...current.approvers, normalized]))
      : current.approvers.filter((item) => item !== normalized);
    const updated = writePolicy(configPath, {
      approvers,
      requiredApprovals: current.requiredApprovals,
    });
    updatedMessage(configPath, updated);
    return;
  }

  if (command === 'threshold') {
    if (positional[1] !== 'set' || positional.length !== 3) {
      throw new Error('usage: audit threshold set <count>');
    }
    const current = readPolicy(configPath);
    const updated = writePolicy(configPath, {
      approvers: current.approvers,
      requiredApprovals: parseRequiredApprovals(positional[2]),
    });
    updatedMessage(configPath, updated);
    return;
  }

  throw new Error(`Unknown audit command: ${command}`);
}

try {
  run();
} catch (error) {
  process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
