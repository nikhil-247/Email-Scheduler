import { prisma } from '../lib/prisma.js';
import { emailQueue } from '../lib/queue.js';
import { indexEmail } from './email-indexer.js';
const LIVE_STATES = ['waiting', 'delayed', 'active', 'paused', 'prioritized', 'waiting-children'] as const;
const TERMINAL_STATES = ['completed', 'failed'] as const;
/** Restore scheduled PostgreSQL rows missing from the persistent BullMQ queue. */
export async function enqueueScheduledEmails(campaignId?: string): Promise<{ inspected: number; enqueued: number; manualReview: number }> {
  if (campaignId) await prisma.$executeRaw`UPDATE "Email" SET "queueJobId" = 'email-' || "id" WHERE "campaignId" = ${campaignId} AND "status" = 'SCHEDULED' AND "queueJobId" = ''`;
  else await prisma.$executeRaw`UPDATE "Email" SET "queueJobId" = 'email-' || "id" WHERE "status" = 'SCHEDULED' AND "queueJobId" = ''`;
  const pending = await prisma.email.findMany({ where: { status: 'SCHEDULED', ...(campaignId ? { campaignId } : {}) }, orderBy: [{ scheduledAt: 'asc' }, { sequence: 'asc' }] });
  if (!pending.length) return { inspected: 0, enqueued: 0, manualReview: 0 };
  const [liveJobs, terminalJobs] = await Promise.all([emailQueue.getJobs([...LIVE_STATES], 0, -1), emailQueue.getJobs([...TERMINAL_STATES], 0, -1)]);
  const liveIds = new Set(liveJobs.map((job) => job.id)); const terminalIds = new Set(terminalJobs.map((job) => job.id));
  const missing = pending.filter((email) => !liveIds.has(email.queueJobId) && !terminalIds.has(email.queueJobId));
  const ambiguous = pending.filter((email) => terminalIds.has(email.queueJobId));
  if (ambiguous.length) await prisma.email.updateMany({ where: { id: { in: ambiguous.map((email) => email.id) }, status: 'SCHEDULED' }, data: { status: 'FAILED', failureReason: 'Queue job is already terminal while the database still says scheduled. Not automatically resending to avoid duplicates; review delivery and queue history.' } });
  if (missing.length) await emailQueue.addBulk(missing.map((email) => ({ name: 'send-email', data: { emailId: email.id }, opts: { jobId: email.queueJobId, delay: Math.max(0, email.scheduledAt.getTime() - Date.now()) } })));
  const rowsToIndex = await prisma.email.findMany({ where: { id: { in: pending.map((email) => email.id) } } });
  rowsToIndex.forEach((email) => { void indexEmail(email); });
  return { inspected: pending.length, enqueued: missing.length, manualReview: ambiguous.length };
}
