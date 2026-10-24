import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { decryptToken, encryptToken } from '../src/services/token-crypto.js';

const originalKey = config.TOKEN_ENCRYPTION_KEY;
const testKey = Buffer.alloc(32, 7).toString('base64');

afterEach(() => {
  config.TOKEN_ENCRYPTION_KEY = originalKey;
});

describe('Slack token encryption', () => {
  it('round-trips a token using authenticated encryption', () => {
    config.TOKEN_ENCRYPTION_KEY = testKey;
    const token = 'xoxb-test-token-do-not-use';

    const encrypted = encryptToken(token);

    expect(encrypted).not.toContain(token);
    expect(encrypted.startsWith('v1:')).toBe(true);
    expect(decryptToken(encrypted)).toBe(token);
  });

  it('rejects tampered ciphertext', () => {
    config.TOKEN_ENCRYPTION_KEY = testKey;
    const encrypted = encryptToken('sensitive-token');
    const parts = encrypted.split(':');
    parts[3] = `${parts[3][0] === 'A' ? 'B' : 'A'}${parts[3].slice(1)}`;

    expect(() => decryptToken(parts.join(':'))).toThrow();
  });

  it('rejects unknown versions and malformed ciphertext', () => {
    config.TOKEN_ENCRYPTION_KEY = testKey;

    expect(() => decryptToken('v2:iv:tag:ciphertext')).toThrow(/format is invalid/);
    expect(() => decryptToken('v1')).toThrow(/format is invalid/);
  });

  it('requires a configured 32-byte key', () => {
    config.TOKEN_ENCRYPTION_KEY = '';
    expect(() => encryptToken('token')).toThrow(/must be set/);

    config.TOKEN_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64');
    expect(() => encryptToken('token')).toThrow(/32-byte/);
  });
});
