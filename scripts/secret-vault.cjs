#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const VAULT_VERSION = 1;
const VAULT_FORMAT = 'node-secrets';
const PBKDF2_ITERATIONS = 210000;
const PBKDF2_DIGEST = 'sha256';
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const AAD = Buffer.from('yeying-node-secrets:v1', 'utf8');

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function assertNonEmptyString(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function deriveKey(password, salt) {
  const raw = assertNonEmptyString(password, 'Password');
  return crypto.pbkdf2Sync(raw, salt, PBKDF2_ITERATIONS, KEY_BYTES, PBKDF2_DIGEST);
}

function encryptSecrets(secrets, password) {
  if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets)) {
    throw new Error('Secrets must be an object');
  }
  const normalized = {};
  Object.entries(secrets).forEach(([key, value]) => {
    const name = String(key || '').trim();
    if (!name) return;
    normalized[name] = String(value ?? '');
  });

  const plaintext = Buffer.from(JSON.stringify(normalized), 'utf8');
  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    version: VAULT_VERSION,
    format: VAULT_FORMAT,
    kdf: {
      name: 'pbkdf2',
      digest: PBKDF2_DIGEST,
      iterations: PBKDF2_ITERATIONS,
      salt: salt.toString('base64'),
    },
    cipher: {
      name: 'aes-256-gcm',
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
    },
    payload: ciphertext.toString('base64'),
    createdAt: new Date().toISOString(),
  };
}

function decryptSecrets(vault, password) {
  if (!vault || typeof vault !== 'object') {
    throw new Error('Invalid vault payload');
  }
  if (Number(vault.version) !== VAULT_VERSION || String(vault.format) !== VAULT_FORMAT) {
    throw new Error('Unsupported vault format');
  }

  const kdf = vault.kdf || {};
  const cipherInfo = vault.cipher || {};
  if (
    String(kdf.name) !== 'pbkdf2' ||
    String(kdf.digest) !== PBKDF2_DIGEST ||
    Number(kdf.iterations) !== PBKDF2_ITERATIONS ||
    String(cipherInfo.name) !== 'aes-256-gcm'
  ) {
    throw new Error('Unsupported vault algorithm');
  }

  const salt = Buffer.from(assertNonEmptyString(kdf.salt, 'kdf.salt'), 'base64');
  const iv = Buffer.from(assertNonEmptyString(cipherInfo.iv, 'cipher.iv'), 'base64');
  const authTag = Buffer.from(assertNonEmptyString(cipherInfo.authTag, 'cipher.authTag'), 'base64');
  const payload = Buffer.from(assertNonEmptyString(vault.payload, 'payload'), 'base64');

  const key = deriveKey(password, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(AAD);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(payload), decipher.final()]);
  const parsed = JSON.parse(plaintext.toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid decrypted secrets payload');
  }

  const normalized = {};
  Object.entries(parsed).forEach(([key, value]) => {
    const name = String(key || '').trim();
    if (!name) return;
    normalized[name] = String(value ?? '');
  });
  return normalized;
}

function loadVault(filePath) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Vault file not found: ${absolutePath}`);
  }
  const raw = fs.readFileSync(absolutePath, 'utf8');
  return JSON.parse(raw);
}

function saveVault(filePath, vault, force = false) {
  const absolutePath = path.resolve(filePath);
  if (!force && fs.existsSync(absolutePath)) {
    throw new Error(`Vault file already exists: ${absolutePath}`);
  }
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(vault, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(absolutePath, 0o600);
  return absolutePath;
}

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
      reject(new Error('Interactive password input requires a TTY'));
      return;
    }

    const stdin = process.stdin;
    let buffer = '';
    process.stdout.write(`${question}: `);

    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };

    const onData = (chunk) => {
      const value = String(chunk || '');
      if (value === '\u0003') {
        cleanup();
        process.stdout.write('\n');
        reject(new Error('Input cancelled'));
        return;
      }
      if (value === '\r' || value === '\n') {
        cleanup();
        process.stdout.write('\n');
        resolve(buffer);
        return;
      }
      if (value === '\u0008' || value === '\u007f') {
        if (buffer.length > 0) {
          buffer = buffer.slice(0, -1);
        }
        return;
      }
      buffer += value;
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function readPassword(options = {}) {
  const envName = String(options.envName || 'NODE_SECRETS_PASSWORD').trim();
  const promptText = String(options.promptText || '请输入密钥文件密码').trim();
  const fromEnv = String(process.env[envName] || '');
  if (fromEnv) {
    return fromEnv;
  }
  return promptHidden(promptText);
}

function base58Encode(input) {
  if (!Buffer.isBuffer(input)) {
    throw new Error('base58Encode input must be Buffer');
  }
  if (input.length === 0) return '';
  const digits = [0];
  for (const byte of input) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i] * 256;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let zeros = 0;
  while (zeros < input.length && input[zeros] === 0) {
    zeros += 1;
  }
  let encoded = '1'.repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    encoded += BASE58_ALPHABET[digits[i]];
  }
  return encoded;
}

function createEd25519PrivateKeyFromSeed(seedHex) {
  const normalized = assertNonEmptyString(seedHex, 'UCAN issuer private key seed').replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error('UCAN issuer private key seed must be 32-byte hex');
  }
  const seed = Buffer.from(normalized, 'hex');
  const der = Buffer.concat([ED25519_PKCS8_PREFIX, seed]);
  return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

function deriveDidFromSeedHex(seedHex) {
  const privateKey = createEd25519PrivateKeyFromSeed(seedHex);
  const publicKey = crypto.createPublicKey(privateKey);
  const der = publicKey.export({ format: 'der', type: 'spki' });
  if (
    !Buffer.isBuffer(der) ||
    der.length !== ED25519_SPKI_PREFIX.length + 32 ||
    !der.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    throw new Error('Failed to derive Ed25519 DID from private key');
  }
  const rawPublic = der.subarray(ED25519_SPKI_PREFIX.length);
  const multicodec = Buffer.concat([Buffer.from([0xed, 0x01]), rawPublic]);
  return `did:key:z${base58Encode(multicodec)}`;
}

function generateDefaultSecrets() {
  const issuerSeed = crypto.randomBytes(32).toString('hex');
  return {
    JWT_SECRET: crypto.randomBytes(32).toString('hex'),
    UCAN_ISSUER_PRIVATE_KEY: issuerSeed,
    UCAN_ISSUER_DID: deriveDidFromSeedHex(issuerSeed),
    TOTP_AUTH_TOTP_MASTER_KEY: crypto.randomBytes(32).toString('hex'),
  };
}

module.exports = {
  VAULT_VERSION,
  VAULT_FORMAT,
  encryptSecrets,
  decryptSecrets,
  loadVault,
  saveVault,
  readPassword,
  generateDefaultSecrets,
  deriveDidFromSeedHex,
};

