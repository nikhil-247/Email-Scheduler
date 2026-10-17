import type { Email } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { emailIndexQueue, newIndexJobId, EMAIL_INDEX_QUEUE_NAME } from '../lib/index-queue.js';
import { elasticsearch, EMAIL_INDEX, ensureEmailIndex } from '../lib/elasticsearch.js';

/**
 * Persist indexing work in BullMQ rather than making the email sender depend on
 * Elasticsearch availability. Repeated indexing is safe because Elasticsearch
 * documents use the email's PostgreSQL ID.
 */
export async function indexEmail(email: Pick<Email, 'id'>): Promise<void> {
  try {
    await emailIndexQueue.add('index-email', { emailId: email.id }, { jobId: newIndexJobId(email.id) });
  } catch (error) {
    // Startup reconciliation queues every row again. This log makes enqueue
    // failures visible while keeping a completed SMTP send from being retried.
    console.error(`Could not enqueue Elasticsearch indexing for email ${email.id}:`, error);
  }
}

/** Called by the dedicated BullMQ index worker; failures bubble up for retries. */
export async function processEmailIndex(emailId: string): Promise<void> {
  const email = await prisma.email.findUnique({ where: { id: emailId } });
  if (!email) return;
  await ensureEmailIndex();
  await elasticsearch.index({
    index: EMAIL_INDEX,
    id: email.id,
    document: {
      id: email.id,
      userId: email.userId,
      campaignId: email.campaignId,
      recipient: email.recipient,
      subject: email.subject,
      body: email.body,
      senderKey: email.senderKey,
      status: email.status.toLowerCase(),
      scheduledAt: email.scheduledAt,
      sentAt: email.sentAt,
      createdAt: email.createdAt,
    },
    refresh: 'wait_for',
  });
}

/** Queue existing records in small batches so search can be rebuilt after a restart. */
export async function enqueueAllEmailIndexes(batchSize = 250): Promise<number> {
  let cursorId: string | undefined;
  let queued = 0;
  while (true) {
    const rows = await prisma.email.findMany({
      take: batchSize,
      orderBy: { id: 'asc' },
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;
    await emailIndexQueue.addBulk(rows.map((email) => ({
      name: 'index-email',
      data: { emailId: email.id },
      opts: { jobId: newIndexJobId(email.id) },
    })));
    queued += rows.length;
    cursorId = rows[rows.length - 1]!.id;
  }
  return queued;
}

export const EMAIL_INDEX_WORKER_NAME = EMAIL_INDEX_QUEUE_NAME;
