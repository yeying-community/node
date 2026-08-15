#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { loadVault, decryptSecrets, encryptSecrets, replaceVault, readPassword } = require('./secret-vault.cjs');

const LEGACY = ['UCAN_ISSUER_PRIVATE_KEY', 'JWT_SECRET', 'TOTP_AUTH_TOTP_MASTER_KEY', 'PASSPORT_ASSERTION_SECRET', 'NOTIFICATION_WEBHOOK_MASTER_KEY'];
const b64url = (value) => Buffer.from(value).toString('base64url');
const fromB64url = (value) => Buffer.from(String(value).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - String(value).length % 4) % 4), 'base64');
const hkdf = (root, context) => Buffer.from(crypto.hkdfSync('sha256', Buffer.from(root, 'utf8'), Buffer.from('yeying-node-key-derivation:v1'), Buffer.from(context), 32)).toString('hex');
const quote = (value) => `"${String(value).replace(/"/g, '""')}"`;

function decodeLegacyTotpKey(value) {
  const raw = String(value || '').trim(); const hex = raw.replace(/^0x/i, '');
  if (/^[0-9a-f]+$/i.test(hex) && hex.length >= 32 && hex.length % 2 === 0) return Buffer.from(hex, 'hex');
  const base64 = Buffer.from(raw, 'base64'); if (base64.length >= 16) return base64;
  if (Buffer.byteLength(raw) < 16) throw new Error('Legacy TOTP key is invalid'); return Buffer.from(raw);
}
function cipherKey(master, context) { return crypto.createHash('sha256').update(master).update(context).digest(); }
function decrypt(value, key) { const [v, iv, tag, data] = String(value).split('.'); if (v !== 'v1' || !iv || !tag || !data) throw new Error('Invalid encrypted value'); const d = crypto.createDecipheriv('aes-256-gcm', key, fromB64url(iv)); d.setAuthTag(fromB64url(tag)); return Buffer.concat([d.update(fromB64url(data)), d.final()]); }
function encrypt(value, key) { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const data = Buffer.concat([c.update(value), c.final()]); return `v1.${b64url(iv)}.${b64url(c.getAuthTag())}.${b64url(data)}`; }

async function migrateTable(client, schema, table, id, oldKey, newKey) {
  const relation = `${schema}.${table}`;
  const exists = await client.query('SELECT to_regclass($1) AS name', [relation]); if (!exists.rows[0].name) return 0;
  const rows = await client.query(`SELECT ${quote(id)}, secret_ciphertext FROM ${quote(schema)}.${quote(table)} WHERE secret_ciphertext <> ''`);
  for (const row of rows.rows) {
    const plaintext = decrypt(row.secret_ciphertext, oldKey);
    await client.query(`UPDATE ${quote(schema)}.${quote(table)} SET secret_ciphertext = $1 WHERE ${quote(id)} = $2`, [encrypt(plaintext, newKey), row[id]]);
  }
  return rows.rowCount;
}

async function run() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write('Usage: node scripts/migrate-secrets.cjs\nMigrates legacy vault keys and re-encrypts TOTP/Webhook records for the unified key model.\n');
    return;
  }
  const config = require(path.resolve('config.js')); const vaultPath = path.resolve(config.secrets?.file || 'run/secrets.enc.json');
  const password = await readPassword({ promptText: '请输入密钥文件密码' }); const secrets = decryptSecrets(loadVault(vaultPath), password);
  const backup = `${vaultPath}.before-unified-${Date.now()}.bak`; fs.copyFileSync(vaultPath, backup); fs.chmodSync(backup, 0o600);
  if (!secrets.ISSUER_PRIVATE_KEY && secrets.UCAN_ISSUER_PRIVATE_KEY) secrets.ISSUER_PRIVATE_KEY = secrets.UCAN_ISSUER_PRIVATE_KEY;
  if (!secrets.ISSUER_PRIVATE_KEY) throw new Error('ISSUER_PRIVATE_KEY or legacy UCAN_ISSUER_PRIVATE_KEY is required');
  if (!secrets.NODE_KEY_DERIVATION_SECRET) secrets.NODE_KEY_DERIVATION_SECRET = crypto.randomBytes(32).toString('hex');
  const legacyTotp = secrets.TOTP_AUTH_TOTP_MASTER_KEY; const legacyWebhook = secrets.NOTIFICATION_WEBHOOK_MASTER_KEY;
  if (legacyTotp || legacyWebhook) {
    const client = new Client({ host: config.database.host, port: config.database.port, database: config.database.database, user: secrets.DATABASE_USERNAME, password: secrets.DATABASE_PASSWORD });
    await client.connect(); try { await client.query('BEGIN'); const schema = config.database.schema || 'public';
      const totals = { totp: 0, webhook: 0 };
      if (legacyTotp) totals.totp = await migrateTable(client, schema, 'totp_subject_secrets', 'subject', cipherKey(decodeLegacyTotpKey(legacyTotp), 'totp-auth-secret:v1'), cipherKey(decodeLegacyTotpKey(hkdf(secrets.NODE_KEY_DERIVATION_SECRET, 'totp-storage')), 'totp-auth-secret:v1'));
      if (legacyWebhook) totals.webhook = await migrateTable(client, schema, 'notification_webhooks', 'uid', cipherKey(Buffer.from(legacyWebhook, 'utf8'), 'notification-webhook-secret:v1'), cipherKey(Buffer.from(hkdf(secrets.NODE_KEY_DERIVATION_SECRET, 'notification-webhook'), 'utf8'), 'notification-webhook-secret:v1'));
      await client.query('COMMIT'); process.stdout.write(`Re-encrypted records: TOTP=${totals.totp}, webhook=${totals.webhook}\n`);
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { await client.end(); }
  }
  LEGACY.forEach((name) => delete secrets[name]); replaceVault(vaultPath, encryptSecrets(secrets, password));
  process.stdout.write(`Migrated vault: ${vaultPath}\nBackup: ${backup}\n`);
}
run().catch((error) => { process.stderr.write(`ERROR: ${error.message}\n`); process.exit(1); });
