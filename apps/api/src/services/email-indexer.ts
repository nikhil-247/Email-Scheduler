import type { Email } from '@prisma/client';
import { elasticsearch, EMAIL_INDEX, ensureEmailIndex } from '../lib/elasticsearch.js';
let indexReady: Promise<void> | undefined;
async function ensureIndexReady(): Promise<void> {
  if (!indexReady) indexReady = ensureEmailIndex().catch((error) => { indexReady = undefined; throw error; });
  return indexReady;
}
export async function indexEmail(email: Email): Promise<void> {
  try {
    await ensureIndexReady();
    await elasticsearch.index({ index: EMAIL_INDEX, id: email.id, document: { id: email.id, userId: email.userId, campaignId: email.campaignId, recipient: email.recipient, subject: email.subject, body: email.body, senderKey: email.senderKey, status: email.status.toLowerCase(), scheduledAt: email.scheduledAt, sentAt: email.sentAt, createdAt: email.createdAt }, refresh: 'wait_for' });
  } catch (error) { console.error(`Elasticsearch indexing failed for email ${email.id}:`, error); }
}
