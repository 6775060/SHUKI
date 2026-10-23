import crypto from 'node:crypto';
import { getMeta, setMeta, type DB } from './db.js';

// Bank credentials are encrypted with AES-256-GCM. The key is derived from the
// master password with scrypt and lives only in memory while the app is unlocked.

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const VERIFIER_PLAINTEXT = 'shefa-vault-v1';

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password.normalize('NFKC'), salt, 32, SCRYPT);
}

export function encrypt(key: Buffer, plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join(':');
}

export function decrypt(key: Buffer, payload: string): string {
  const [version, iv, tag, data] = payload.split(':');
  if (version !== 'v1') throw new Error('Unknown vault payload version');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

export class Vault {
  private key: Buffer | null = null;

  constructor(private db: DB) {}

  isInitialized(): boolean {
    return getMeta(this.db, 'vault_salt') !== undefined;
  }

  isUnlocked(): boolean {
    return this.key !== null;
  }

  setup(password: string): void {
    if (this.isInitialized()) throw new Error('Vault already initialized');
    if (password.length < 8) throw new Error('Password too short');
    const salt = crypto.randomBytes(16);
    const key = deriveKey(password, salt);
    setMeta(this.db, 'vault_salt', salt.toString('base64'));
    setMeta(this.db, 'vault_verifier', encrypt(key, VERIFIER_PLAINTEXT));
    this.key = key;
  }

  unlock(password: string): boolean {
    const salt = getMeta(this.db, 'vault_salt');
    const verifier = getMeta(this.db, 'vault_verifier');
    if (!salt || !verifier) throw new Error('Vault not initialized');
    const key = deriveKey(password, Buffer.from(salt, 'base64'));
    try {
      if (decrypt(key, verifier) !== VERIFIER_PLAINTEXT) return false;
    } catch {
      return false;
    }
    this.key = key;
    return true;
  }

  lock(): void {
    this.key?.fill(0);
    this.key = null;
  }

  seal(value: unknown): string {
    if (!this.key) throw new Error('Vault is locked');
    return encrypt(this.key, JSON.stringify(value));
  }

  open<T>(payload: string): T {
    if (!this.key) throw new Error('Vault is locked');
    return JSON.parse(decrypt(this.key, payload)) as T;
  }
}
