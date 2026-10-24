import { describe, expect, it } from 'vitest';
import { emailScheduleSchema } from '../src/schemas/email-schedule.js';

const validPayload = {
  subject: '  Product update  ',
  body: '  Hello from the scheduler.  ',
  recipients: ['  ALICE@example.com  ', 'bob@example.com'],
  scheduledAt: '2030-11-01T12:30:00.000Z',
  delaySeconds: 2,
  hourlyLimit: 100,
  senderKey: 'primary',
  campaignName: '  November update  ',
};

describe('emailScheduleSchema', () => {
  it('trims text fields and normalizes recipient addresses', () => {
    const result = emailScheduleSchema.safeParse(validPayload);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.subject).toBe('Product update');
    expect(result.data.body).toBe('Hello from the scheduler.');
    expect(result.data.recipients).toEqual(['alice@example.com', 'bob@example.com']);
    expect(result.data.campaignName).toBe('November update');
  });

  it('rejects invalid email addresses and missing recipients', () => {
    expect(emailScheduleSchema.safeParse({ ...validPayload, recipients: ['not-an-email'] }).success).toBe(false);
    expect(emailScheduleSchema.safeParse({ ...validPayload, recipients: [] }).success).toBe(false);
  });

  it('rejects values outside documented size and rate limits', () => {
    expect(emailScheduleSchema.safeParse({ ...validPayload, subject: 'x'.repeat(251) }).success).toBe(false);
    expect(emailScheduleSchema.safeParse({ ...validPayload, body: 'x'.repeat(100_001) }).success).toBe(false);
    expect(emailScheduleSchema.safeParse({ ...validPayload, recipients: Array.from({ length: 5001 }, (_, i) => `user${i}@example.com`) }).success).toBe(false);
    expect(emailScheduleSchema.safeParse({ ...validPayload, delaySeconds: 3601 }).success).toBe(false);
    expect(emailScheduleSchema.safeParse({ ...validPayload, hourlyLimit: 0 }).success).toBe(false);
  });

  it('requires a valid timestamp with an explicit UTC offset', () => {
    expect(emailScheduleSchema.safeParse({ ...validPayload, scheduledAt: '2030-11-01T12:30:00' }).success).toBe(false);
    expect(emailScheduleSchema.safeParse({ ...validPayload, scheduledAt: 'not-a-date' }).success).toBe(false);
  });

  it('allows campaignName to be omitted', () => {
    const { campaignName: _campaignName, ...payload } = validPayload;
    expect(emailScheduleSchema.safeParse(payload).success).toBe(true);
  });
});
