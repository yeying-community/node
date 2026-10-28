#!/usr/bin/env node
require('reflect-metadata');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { DataSource } = require('typeorm');
const { loadVault, decryptSecrets, readPassword } = require('./secret-vault.cjs');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function printUsage() {
  process.stdout.write([
    'Usage:',
    '  ./cmd identity email reset <email>',
    '  ./cmd identity email reset <email> --execute --confirm-email <email>',
    '',
    'Description:',
    '  Preview or reset identity registration data associated with one exact email address.',
    '  Preview is the default. Execution requires a stopped Node service and exact confirmation.',
    '  Business objects and security audit logs are retained.',
    '',
  ].join('\n'));
}

function normalizeEmail(value) {
  const email = String(value || '').trim().normalize('NFC').toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 320) {
    throw new Error(`Invalid email address: ${email || '<empty>'}`);
  }
  return email;
}

function parseArgs(argv) {
  const options = {
    email: '', confirmEmail: '', execute: false,
    config: process.env.APP_CONFIG_PATH || 'config.js', file: '',
    root: process.cwd(), pidFile: '', json: false, help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') options.help = true;
    else if (token === '--execute') options.execute = true;
    else if (token === '--json') options.json = true;
    else if (token === '--confirm-email') options.confirmEmail = argv[++index] || '';
    else if (token === '--config' || token === '-c') options.config = argv[++index] || '';
    else if (token === '--file' || token === '-f') options.file = argv[++index] || '';
    else if (token === '--root') options.root = argv[++index] || '';
    else if (token === '--pid-file') options.pidFile = argv[++index] || '';
    else if (token.startsWith('-')) throw new Error(`Unknown option: ${token}`);
    else if (!options.email) options.email = token;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return options;
}

function validateExecution(options) {
  const email = normalizeEmail(options.email);
  if (options.execute) {
    const confirmation = normalizeEmail(options.confirmEmail);
    if (confirmation !== email) throw new Error('--confirm-email must exactly match the target email');
  } else if (options.confirmEmail) {
    throw new Error('--confirm-email is only valid together with --execute');
  }
  return email;
}

function isPortListening(port, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = (error, listening) => {
      socket.destroy();
      if (error) reject(error);
      else resolve(listening);
    };
    socket.setTimeout(timeoutMs, () => finish(new Error(`Could not verify whether Node is stopped on port ${port}`)));
    socket.once('connect', () => finish(null, true));
    socket.once('error', (error) => {
      if (error.code === 'ECONNREFUSED') finish(null, false);
      else finish(error);
    });
  });
}

async function assertServiceStopped(pidFile, port, probePort = isPortListening) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('Cannot verify Node is stopped: configured app.port is invalid');
  }
  if (pidFile && fs.existsSync(pidFile)) {
    const rawPid = fs.readFileSync(pidFile, 'utf8').trim();
    if (!/^[1-9][0-9]*$/.test(rawPid)) {
      throw new Error(`Cannot verify Node is stopped: invalid PID file ${pidFile}`);
    }
    const pid = Number(rawPid);
    if (!Number.isSafeInteger(pid)) throw new Error(`Cannot verify Node is stopped: invalid PID file ${pidFile}`);
    try {
      process.kill(pid, 0);
      throw new Error(`Node service is still running (PID=${pid}). Stop every Node instance before executing the reset.`);
    } catch (error) {
      if (error && error.code === 'ESRCH') {
        // A stale PID file is not proof that the configured service port is free.
      } else {
        throw error;
      }
    }
  }
  if (await probePort(port)) {
    throw new Error(`A service is still listening on Node app.port ${port}. Stop every Node instance before executing the reset.`);
  }
}

function unique(values) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function predicates(...items) {
  return items.filter(Boolean)
    .map((item) => ({ column: item.column, values: unique(item.values) }))
    .filter((item) => item.values.length > 0);
}

function valuesFrom(rows, key) {
  return unique(rows.map((row) => row[key]));
}

class SqlStore {
  constructor(queryRunner, databaseType, schema) {
    this.queryRunner = queryRunner;
    this.databaseType = databaseType;
    this.schema = schema;
    this.exists = new Map();
  }

  identifier(value) {
    const name = String(value || '');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`);
    return this.databaseType === 'postgres' ? `"${name}"` : `\`${name}\``;
  }

  table(table) {
    return this.databaseType === 'postgres'
      ? `${this.identifier(this.schema)}.${this.identifier(table)}`
      : this.identifier(table);
  }

  placeholder(index) { return this.databaseType === 'postgres' ? `$${index}` : '?'; }

  async tableExists(table) {
    if (this.exists.has(table)) return this.exists.get(table);
    const rows = this.databaseType === 'postgres'
      ? await this.queryRunner.query('SELECT 1 AS present FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2 LIMIT 1', [this.schema, table])
      : await this.queryRunner.query('SELECT 1 AS present FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1', [table]);
    const present = Array.isArray(rows) && rows.length > 0;
    this.exists.set(table, present);
    return present;
  }

  whereAny(items) {
    const active = (items || []).filter((item) => item.values.length > 0);
    if (active.length === 0) return null;
    const parameters = [];
    const expressions = active.map((item) => {
      const placeholders = item.values.map((value) => {
        parameters.push(value);
        return this.placeholder(parameters.length);
      });
      return `${this.identifier(item.column)} IN (${placeholders.join(', ')})`;
    });
    return { sql: `(${expressions.join(' OR ')})`, parameters };
  }

  async select(table, columns, items) {
    if (!(await this.tableExists(table))) return [];
    const where = this.whereAny(items);
    if (!where) return [];
    const selection = columns.map((column) => this.identifier(column)).join(', ');
    return await this.queryRunner.query(`SELECT ${selection} FROM ${this.table(table)} WHERE ${where.sql}`, where.parameters);
  }

  async count(table, items) {
    if (!(await this.tableExists(table))) return 0;
    const where = this.whereAny(items);
    if (!where) return 0;
    const rows = await this.queryRunner.query(`SELECT COUNT(*) AS count FROM ${this.table(table)} WHERE ${where.sql}`, where.parameters);
    return Number(rows?.[0]?.count || 0);
  }

  async delete(table, items) {
    const count = await this.count(table, items);
    if (count === 0) return 0;
    const where = this.whereAny(items);
    await this.queryRunner.query(`DELETE FROM ${this.table(table)} WHERE ${where.sql}`, where.parameters);
    return count;
  }

  async update(table, values, items) {
    const count = await this.count(table, items);
    if (count === 0) return 0;
    const entries = Object.entries(values);
    const parameters = entries.map(([, value]) => value);
    const assignments = entries.map(([column], index) => `${this.identifier(column)} = ${this.placeholder(index + 1)}`);
    const where = this.whereAny(items);
    const shiftedWhere = this.databaseType === 'postgres'
      ? where.sql.replace(/\$(\d+)/g, (_, value) => `$${Number(value) + parameters.length}`)
      : where.sql;
    await this.queryRunner.query(`UPDATE ${this.table(table)} SET ${assignments.join(', ')} WHERE ${shiftedWhere}`, [...parameters, ...where.parameters]);
    return count;
  }

  async insertIfAbsent(table, keyColumn, row) {
    if (!(await this.tableExists(table))) return 0;
    const key = String(row[keyColumn] || '').trim();
    if (!key || await this.count(table, predicates({ column: keyColumn, values: [key] }))) return 0;
    const entries = Object.entries(row);
    const columns = entries.map(([column]) => this.identifier(column)).join(', ');
    const placeholders = entries.map((_, index) => this.placeholder(index + 1)).join(', ');
    await this.queryRunner.query(`INSERT INTO ${this.table(table)} (${columns}) VALUES (${placeholders})`, entries.map(([, value]) => value));
    return 1;
  }
}

async function discoverTargets(store, email) {
  const accountRows = await store.select('identity_email_accounts', ['email', 'identity_did'], predicates({ column: 'email', values: [email] }));
  let challengeRows = await store.select('identity_email_auth_challenges', ['challenge_id', 'email', 'identity_did', 'registration_id', 'username'], predicates({ column: 'email', values: [email] }));
  const verificationRows = await store.select('identity_verification_transactions', ['verification_id', 'identity_did', 'email', 'username'], predicates({ column: 'email', values: [email] }));
  let identityDids = unique([...valuesFrom(accountRows, 'identity_did'), ...valuesFrom(challengeRows, 'identity_did'), ...valuesFrom(verificationRows, 'identity_did')]);
  let registrationIds = valuesFrom(challengeRows, 'registration_id');
  let challengeIds = valuesFrom(challengeRows, 'challenge_id');

  let registrationRows = await store.select('identity_registrations', ['registration_id', 'identity_did', 'email_challenge_id'], predicates(
    { column: 'identity_did', values: identityDids }, { column: 'registration_id', values: registrationIds }, { column: 'email_challenge_id', values: challengeIds }
  ));
  identityDids = unique([...identityDids, ...valuesFrom(registrationRows, 'identity_did')]);
  registrationIds = unique([...registrationIds, ...valuesFrom(registrationRows, 'registration_id')]);
  challengeIds = unique([...challengeIds, ...valuesFrom(registrationRows, 'email_challenge_id')]);

  challengeRows = [...challengeRows, ...await store.select('identity_email_auth_challenges', ['challenge_id', 'email', 'identity_did', 'registration_id', 'username'], predicates(
    { column: 'email', values: [email] }, { column: 'identity_did', values: identityDids }, { column: 'registration_id', values: registrationIds }, { column: 'challenge_id', values: challengeIds }
  ))];
  identityDids = unique([...identityDids, ...valuesFrom(challengeRows, 'identity_did')]);
  registrationIds = unique([...registrationIds, ...valuesFrom(challengeRows, 'registration_id')]);
  challengeIds = unique([...challengeIds, ...valuesFrom(challengeRows, 'challenge_id')]);

  registrationRows = await store.select('identity_registrations', ['registration_id', 'identity_did', 'email_challenge_id'], predicates(
    { column: 'identity_did', values: identityDids }, { column: 'registration_id', values: registrationIds }, { column: 'email_challenge_id', values: challengeIds }
  ));
  identityDids = unique([...identityDids, ...valuesFrom(registrationRows, 'identity_did')]);
  registrationIds = unique([...registrationIds, ...valuesFrom(registrationRows, 'registration_id')]);

  const accountLinks = await store.select('identity_account_links', ['identity_did', 'account_id'], predicates({ column: 'identity_did', values: identityDids }));
  const usernameRows = await store.select('identity_usernames', ['normalized_username'], predicates({ column: 'identity_did', values: identityDids }));
  const authorizationRequests = await store.select('identity_authorization_requests', ['request_id', 'identity_did'], predicates({ column: 'identity_did', values: identityDids }));
  const issueSessions = await store.select('ucan_issue_sessions', ['session_hash', 'subject'], predicates({ column: 'subject', values: identityDids }));
  const grants = await store.select('scoped_grants', ['grant_id', 'subject_id'], predicates({ column: 'subject_id', values: identityDids }));
  const grantIds = valuesFrom(grants, 'grant_id');
  const grantTokens = await store.select('scoped_grant_tokens', ['token_id', 'grant_id'], predicates({ column: 'grant_id', values: grantIds }));
  const scopedTokenIds = valuesFrom(grantTokens, 'token_id');
  const sessionHashes = valuesFrom(issueSessions, 'session_hash');
  const persistedTokens = await store.select('ucan_issued_tokens', ['token_id', 'session_hash', 'subject', 'issuer_did'], predicates(
    { column: 'subject', values: identityDids }, { column: 'session_hash', values: sessionHashes }, { column: 'token_id', values: scopedTokenIds }
  ));
  const persistedTokenIds = new Set(valuesFrom(persistedTokens, 'token_id'));
  const issuedTokens = [
    ...persistedTokens,
    ...scopedTokenIds
      .filter((tokenId) => !persistedTokenIds.has(tokenId))
      .map((tokenId) => ({ token_id: tokenId, session_hash: '', subject: identityDids[0] || '', issuer_did: '' })),
  ];

  return {
    email, identityDids, registrationIds, challengeIds,
    usernames: unique([
      ...valuesFrom(challengeRows, 'username'),
      ...valuesFrom(verificationRows, 'username'),
      ...valuesFrom(usernameRows, 'normalized_username'),
    ]),
    accountIds: valuesFrom(accountLinks, 'account_id'),
    requestIds: valuesFrom(authorizationRequests, 'request_id'),
    sessionHashes, grantIds, scopedTokenIds, issuedTokens,
  };
}

function deletionSpecs(targets) {
  const ids = targets.identityDids;
  return [
    ['identity_authorization_codes', predicates({ column: 'identity_did', values: ids }, { column: 'request_id', values: targets.requestIds })],
    ['identity_authorization_requests', predicates({ column: 'identity_did', values: ids }, { column: 'request_id', values: targets.requestIds })],
    ['identity_authorization_sessions', predicates({ column: 'identity_did', values: ids })],
    ['identity_action_challenges', predicates({ column: 'identity_did', values: ids })],
    ['identity_credential_reissue_challenges', predicates({ column: 'identity_did', values: ids })],
    ['identity_totp_authenticators', predicates({ column: 'identity_did', values: ids })],
    ['identity_webauthn_challenges', predicates({ column: 'identity_did', values: ids }, { column: 'request_id', values: targets.registrationIds })],
    ['identity_passkey_credentials', predicates({ column: 'identity_did', values: ids })],
    ['identity_credentials', predicates({ column: 'identity_did', values: ids })],
    ['identity_verification_transactions', predicates({ column: 'email', values: [targets.email] }, { column: 'identity_did', values: ids })],
    ['identity_account_link_challenges', predicates({ column: 'identity_did', values: ids })],
    ['identity_account_links', predicates({ column: 'identity_did', values: ids })],
    ['identity_usernames', predicates({ column: 'identity_did', values: ids })],
    ['identity_registrations', predicates({ column: 'identity_did', values: ids }, { column: 'registration_id', values: targets.registrationIds }, { column: 'email_challenge_id', values: targets.challengeIds })],
    ['identity_email_auth_challenges', predicates({ column: 'email', values: [targets.email] }, { column: 'identity_did', values: ids }, { column: 'registration_id', values: targets.registrationIds }, { column: 'challenge_id', values: targets.challengeIds })],
    ['identity_email_accounts', predicates({ column: 'email', values: [targets.email] }, { column: 'identity_did', values: ids })],
    ['custody_key_records', predicates({ column: 'subject_id', values: targets.accountIds })],
  ];
}

async function buildPlan(store, email) {
  const targets = await discoverTargets(store, email);
  const deletions = [];
  for (const [table, where] of deletionSpecs(targets)) {
    const count = await store.count(table, where);
    if (count > 0) deletions.push({ table, count, where });
  }
  const at = new Date().toISOString();
  const updates = [];
  const candidates = [
    ['ucan_issue_sessions', { revoked_at: at }, predicates({ column: 'subject', values: targets.identityDids })],
    ['scoped_grants', { status: 'revoked', revoked_at: at, updated_at: at }, predicates({ column: 'grant_id', values: targets.grantIds })],
    ['scoped_grant_tokens', { status: 'revoked', revoked_at: at }, predicates({ column: 'token_id', values: targets.scopedTokenIds })],
  ];
  for (const [table, values, where] of candidates) {
    const count = await store.count(table, where);
    if (count > 0) updates.push({ table, count, values, where });
  }
  return { targets, deletions, updates };
}

async function executePlan(store, plan, now = new Date().toISOString()) {
  let revocationsInserted = 0;
  for (const token of plan.targets.issuedTokens) {
    revocationsInserted += await store.insertIfAbsent('ucan_token_revocations', 'token_id', {
      token_id: token.token_id, session_hash: token.session_hash || '', subject: token.subject || '',
      issuer_did: token.issuer_did || '', revoked_at: now, reason: 'identity_email_reset',
    });
    const revoked = await store.count('ucan_token_revocations', predicates({ column: 'token_id', values: [token.token_id] }));
    if (revoked !== 1) throw new Error(`Failed to persist UCAN revocation for token: ${token.token_id}`);
  }
  const updated = {};
  for (const item of plan.updates) {
    const values = { ...item.values };
    if ('revoked_at' in values) values.revoked_at = now;
    if ('updated_at' in values) values.updated_at = now;
    updated[item.table] = await store.update(item.table, values, item.where);
  }
  const deleted = {};
  for (const item of plan.deletions) deleted[item.table] = await store.delete(item.table, item.where);
  for (const [table, where] of deletionSpecs(plan.targets)) {
    const remaining = await store.count(table, where);
    if (remaining !== 0) throw new Error(`Post-reset verification failed: ${table} still has ${remaining} matching row(s)`);
  }
  return { deleted, updated, revocationsInserted };
}

function planSummary(plan) {
  return {
    email: plan.targets.email,
    identityDids: plan.targets.identityDids,
    usernames: plan.targets.usernames,
    walletAccounts: plan.targets.accountIds,
    deletions: Object.fromEntries(plan.deletions.map((item) => [item.table, item.count])),
    revocations: { ucanTokens: plan.targets.issuedTokens.length, sessionsAndGrants: Object.fromEntries(plan.updates.map((item) => [item.table, item.count])) },
    readyWithoutChanges: plan.deletions.length === 0 && plan.updates.length === 0 && plan.targets.issuedTokens.length === 0,
  };
}

function printSummary(summary, executed, result) {
  process.stdout.write(`${executed ? 'Identity email reset completed' : 'Identity email reset preview'}\n`);
  process.stdout.write(`Email: ${summary.email}\n`);
  process.stdout.write(`Identity DIDs (${summary.identityDids.length}): ${summary.identityDids.join(', ') || '(none)'}\n`);
  process.stdout.write(`Usernames (${summary.usernames.length}): ${summary.usernames.join(', ') || '(none)'}\n`);
  process.stdout.write(`Wallet accounts (${summary.walletAccounts.length}): ${summary.walletAccounts.join(', ') || '(none)'}\n`);
  process.stdout.write('Affected registration/authentication rows:\n');
  const entries = Object.entries(summary.deletions);
  if (entries.length === 0) process.stdout.write('  (none)\n');
  else entries.forEach(([table, count]) => process.stdout.write(`  - ${table}: ${count}\n`));
  process.stdout.write(`UCAN tokens to revoke: ${summary.revocations.ucanTokens}\n`);
  process.stdout.write('Authorization state to revoke:\n');
  const revocationEntries = Object.entries(summary.revocations.sessionsAndGrants);
  if (revocationEntries.length === 0) process.stdout.write('  (none)\n');
  else revocationEntries.forEach(([table, count]) => process.stdout.write(`  - ${table}: ${count}\n`));
  process.stdout.write('Preserved: users, user_state, business objects, and security audit logs.\n');
  if (executed) {
    process.stdout.write(`UCAN revocations inserted: ${result.revocationsInserted}\n`);
    process.stdout.write('The email is ready for a new registration. Start the Node service only after this command completes.\n');
    process.stdout.write('Previously issued access JWTs are stateless and may remain valid until their configured short TTL expires.\n');
  } else if (summary.readyWithoutChanges) {
    process.stdout.write('No blocking registration data was found; the email is already ready to register.\n');
  } else {
    process.stdout.write(`Preview only. To execute, stop every Node instance and run:\n  ./cmd identity email reset ${summary.email} --execute --confirm-email ${summary.email}\n`);
  }
}

function loadConfig(configPath) {
  const resolved = fs.realpathSync(configPath);
  delete require.cache[require.resolve(resolved)];
  const loaded = require(resolved);
  return loaded && loaded.default ? loaded.default : loaded;
}

async function connect(options) {
  const root = path.resolve(options.root || process.cwd());
  const configPath = path.resolve(root, options.config);
  if (!fs.existsSync(configPath)) throw new Error(`Config file not found: ${configPath}`);
  const config = loadConfig(configPath);
  const database = config?.database || {};
  if (!['postgres', 'mysql'].includes(database.type)) throw new Error(`Unsupported database type: ${database.type || '<empty>'}`);
  const configuredVault = path.resolve(root, config?.secrets?.file || 'run/secrets.enc.json');
  const vaultPath = options.file ? path.resolve(root, options.file) : configuredVault;
  if (options.file && vaultPath !== configuredVault) throw new Error('--file must match config secrets.file');
  const password = await readPassword({ promptText: '请输入密钥文件密码' });
  if (!password) throw new Error('密码不能为空');
  const secrets = decryptSecrets(loadVault(vaultPath), password);
  const username = String(secrets.DATABASE_USERNAME || '').trim();
  const databasePassword = String(secrets.DATABASE_PASSWORD || '');
  if (!username || !databasePassword) throw new Error('DATABASE_USERNAME and DATABASE_PASSWORD are required in the secrets vault');
  const dataSource = new DataSource({ ...database, username, password: databasePassword, synchronize: false, migrationsRun: false, entities: [], migrations: [] });
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  return { dataSource, runner, store: new SqlStore(runner, database.type, String(database.schema || 'public')) };
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { printUsage(); return; }
  const email = validateExecution(options);
  if (options.execute) {
    const root = path.resolve(options.root || process.cwd());
    const config = loadConfig(path.resolve(root, options.config));
    await assertServiceStopped(
      path.resolve(root, options.pidFile || 'run/node.pid'),
      Number(config?.app?.port),
    );
  }
  const connection = await connect(options);
  try {
    let plan;
    let result;
    if (options.execute) {
      await connection.runner.startTransaction();
      try {
        plan = await buildPlan(connection.store, email);
        result = await executePlan(connection.store, plan);
        await connection.runner.commitTransaction();
      } catch (error) {
        await connection.runner.rollbackTransaction();
        throw error;
      }
    } else plan = await buildPlan(connection.store, email);
    const summary = planSummary(plan);
    if (options.json) process.stdout.write(`${JSON.stringify({ mode: options.execute ? 'execute' : 'preview', ...summary, result }, null, 2)}\n`);
    else printSummary(summary, options.execute, result);
  } finally {
    await connection.runner.release();
    await connection.dataSource.destroy();
  }
}

module.exports = { SqlStore, normalizeEmail, parseArgs, validateExecution, isPortListening, assertServiceStopped, discoverTargets, deletionSpecs, buildPlan, executePlan, planSummary };

if (require.main === module) {
  run().catch((error) => {
    process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
