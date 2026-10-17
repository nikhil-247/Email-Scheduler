import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { redis } from './redis.js';

export const EMAIL_INDEX_QUEUE_NAME = 'email-indexing';
export type EmailIndexJobData = { emailId: string };

export const emailIndexQueue = new Queue<EmailIndexJobData>(EMAIL_INDEX_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 10,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { age: 24 * 60 * 60, count: 10000 },
    removeOnFail: { age: 7 * 24 * 60 * 60, count: 10000 },
  },
});

export function newIndexJobId(emailId: string): string {
  // Unique IDs let startup reconciliation retry records whose prior indexing job failed.
  return `index-${emailId}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}
