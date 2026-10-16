import { Queue } from 'bullmq';
import { redis } from './redis.js';
export const EMAIL_QUEUE_NAME = 'scheduled-emails';
export type EmailJobData = { emailId: string };
export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, { connection: redis, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 3000 }, removeOnComplete: { age: 24 * 60 * 60, count: 10000 }, removeOnFail: { age: 7 * 24 * 60 * 60, count: 10000 } } });
