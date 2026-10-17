import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '../config.js';

function encryptionKey(): Buffer {
  if (!config.TOKEN_ENCRYPTION_KEY) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be set before storing or reading Slack tokens.');
  }
  const key = Buffer.from(config.TOKEN_ENCRYPTION_KEY, 'base64');
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte value. Generate it with node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))".');
  }
  return key;
}

/** AES-256-GCM authenticated encryption for OAuth tokens stored in PostgreSQL. */
export function encryptToken(plainText: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(':');
}

export function decryptToken(storedValue: string): string {
  const [version, ivValue, tagValue, ciphertextValue] = storedValue.split(':');
  if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error('Stored Slack token format is invalid. Disconnect and reconnect Slack after configuring token encryption.');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, 'base64url')), decipher.final()]).toString('utf8');
}
