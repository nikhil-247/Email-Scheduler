import { afterEach, describe, expect, it } from 'vitest';
import { config, getSenders } from '../src/config.js';

const originalSenders = config.SMTP_SENDERS_JSON;

afterEach(() => {
  config.SMTP_SENDERS_JSON = originalSenders;
});

describe('getSenders', () => {
  it('parses a valid sender profile and applies the default port', () => {
    config.SMTP_SENDERS_JSON = JSON.stringify([{
      key: 'primary',
      name: 'Primary test sender',
      email: 'sender@example.com',
      host: 'smtp.example.com',
      user: 'smtp-user',
      pass: 'test-password',
    }]);

    expect(getSenders()).toEqual([{
      key: 'primary',
      name: 'Primary test sender',
      email: 'sender@example.com',
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      user: 'smtp-user',
      pass: 'test-password',
    }]);
  });

  it('rejects malformed JSON and non-array configuration', () => {
    config.SMTP_SENDERS_JSON = '{not-json';
    expect(() => getSenders()).toThrow('SMTP_SENDERS_JSON must be valid JSON.');

    config.SMTP_SENDERS_JSON = JSON.stringify({ key: 'primary' });
    expect(() => getSenders()).toThrow('SMTP_SENDERS_JSON must be a JSON array.');
  });

  it('rejects incomplete sender profiles and invalid ports', () => {
    config.SMTP_SENDERS_JSON = JSON.stringify([{ key: 'primary' }]);
    expect(() => getSenders()).toThrow(/missing name/);

    config.SMTP_SENDERS_JSON = JSON.stringify([{
      key: 'primary', name: 'Primary', email: 'sender@example.com',
      host: 'smtp.example.com', user: 'smtp-user', pass: 'test-password', port: 70000,
    }]);
    expect(() => getSenders()).toThrow(/invalid port/);
  });
});
