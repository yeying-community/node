import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getConfig } from '../config/runtime';

const VAULT_VERSION = 1;
const VAULT_FORMAT = 'node-secrets';
const PBKDF2_ITERATIONS = 210000;
const PBKDF2_DIGEST = 'sha256';
const KEY_BYTES = 32;
const AAD = Buffer.from('yeying-node-secrets:v1', 'utf8');

let initialized = false;
const runtimeSecrets = new Map<string, string>();

function assertNonEmptyString(value: unknown, label: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_BYTES, PBKDF2_DIGEST);
}

function resolveVaultFilePath(): string {
  const configuredFromConfig = String(getConfig<string>('secrets.file') ?? '').trim();
  if (configuredFromConfig) {
    return path.resolve(configuredFromConfig);
  }
  return path.resolve(process.cwd(), 'run', 'secrets.enc.json');
}

function isProductionEnvironment(): boolean {
  const configured = String(getConfig<string>('app.env') ?? '').trim().toLowerCase();
  const runtime = String(process.env.NODE_ENV ?? '').trim().toLowerCase();
  if (configured) {
    return configured === 'production';
  }
  return runtime === 'production';
}

function readPasswordFromFile(filePathInput: string): string {
  const filePath = path.resolve(filePathInput);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Secrets password file not found: ${filePath}`);
  }
  const value = fs.readFileSync(filePath, 'utf8').trim();
  if (isProductionEnvironment()) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore cleanup errors
    }
  }
  if (!value) {
    throw new Error('Secrets password file is empty');
  }
  return value;
}

function resolveVaultPassword(): string {
  const passwordFile = String(getConfig<string>('secrets.passwordFile') ?? '').trim();
  if (passwordFile) {
    return readPasswordFromFile(passwordFile);
  }

  throw new Error(
    'Secrets vault password is missing. Configure secrets.passwordFile with a protected one-time password file.'
  );
}

function decryptVault(vaultRaw: string, password: string): Record<string, string> {
  const vault = JSON.parse(vaultRaw) as Record<string, unknown>;
  if (!vault || typeof vault !== 'object') {
    throw new Error('Invalid vault payload');
  }
  if (Number(vault.version) !== VAULT_VERSION || String(vault.format) !== VAULT_FORMAT) {
    throw new Error('Unsupported vault format');
  }

  const kdf = (vault.kdf || {}) as Record<string, unknown>;
  const cipherInfo = (vault.cipher || {}) as Record<string, unknown>;
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
  const parsed = JSON.parse(plaintext.toString('utf8')) as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid decrypted secrets payload');
  }

  const normalized: Record<string, string> = {};
  Object.entries(parsed).forEach(([keyName, value]) => {
    const key = String(keyName || '').trim();
    if (!key) {
      return;
    }
    normalized[key] = String(value ?? '');
  });
  return normalized;
}

export function initializeRuntimeSecrets(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  const vaultPath = resolveVaultFilePath();
  if (!fs.existsSync(vaultPath)) {
    return;
  }

  const password = resolveVaultPassword();
  const vaultRaw = fs.readFileSync(vaultPath, 'utf8');
  const decrypted = decryptVault(vaultRaw, password);
  Object.entries(decrypted).forEach(([name, value]) => {
    runtimeSecrets.set(name, value);
  });

}

export function getRuntimeSecret(name: string): string {
  return String(runtimeSecrets.get(name) ?? '').trim();
}

export function getRequiredRuntimeSecret(name: string): string {
  const value = getRuntimeSecret(name);
  if (!value) {
    throw new Error(`${name} is required in secrets.enc.json`);
  }
  return value;
}

export function getDerivedRuntimeSecret(context: string): string {
  const root = getRuntimeSecret('NODE_KEY_DERIVATION_SECRET');
  if (!root) return '';
  const derived = crypto.hkdfSync(
    'sha256',
    Buffer.from(root, 'utf8'),
    Buffer.from('yeying-node-key-derivation:v1', 'utf8'),
    Buffer.from(context, 'utf8'),
    32
  );
  return Buffer.from(derived).toString('hex');
}
