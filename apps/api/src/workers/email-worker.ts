import nodemailer from 'nodemailer';
import { Worker, type Job } from 'bullmq';
import { config, getSenders } from '../config.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { emailQueue, EMAIL_QUEUE_NAME, type EmailJobData } from '../lib/queue.js';
import { indexEmail } from '../services/email-indexer.js';
import { notifySenderRateLimit } from '../services/slack-notifier.js';

const RESERVE_SEND_SLOT_LUA = `
local now = tonumber(ARGV[1])
local minInterval = tonumber(ARGV[2])
local senderLimit = tonumber(ARGV[3])
local campaignLimit = tonumber(ARGV[4])
local campaignKey = KEYS[2]
local senderKey = KEYS[1]
local nextKey = KEYS[3]
local senderCount = tonumber(redis.call('GET', senderKey) or '0')
local campaignCount = tonumber(redis.call('GET', campaignKey) or '0')
local nextAllowedAt = tonumber(redis.call('GET', nextKey) or '0')
if senderCount >= senderLimit then return {2, senderCount, senderLimit, 3600000 - (now % 3600000)} end
if campaignCount >= campaignLimit then return {3, campaignCount, campaignLimit, 3600000 - (now % 3600000)} end
if nextAllowedAt > now then return {1, senderCount, senderLimit, nextAllowedAt - now} end
local hourTtl = math.ceil((3600000 - (now % 3600000)) / 1000) + 3600
redis.call('INCR', senderKey); redis.call('EXPIRE', senderKey, hourTtl)
redis.call('INCR', campaignKey); redis.call('EXPIRE', campaignKey, hourTtl)
if minInterval > 0 then redis.call('SET', nextKey, now + minInterval, 'PX', math.max(minInterval * 3, 1000)) else redis.call('DEL', nextKey) end
return {0, senderCount + 1, senderLimit, 0}
`;
const senderProfiles = new Map(getSenders().map((s) => [s.key, s]));
const transporters = new Map<string, nodemailer.Transporter>();
function getTransport(senderKey: string) {
  const existing = transporters.get(senderKey); if (existing) return existing;
  const sender = senderProfiles.get(senderKey); if (!sender) throw new Error(`SMTP sender "${senderKey}" is not configured.`);
  const transporter = nodemailer.createTransport({ host: sender.host, port: sender.port, secure: sender.secure, auth: { user: sender.user, pass: sender.pass } });
  transporters.set(senderKey, transporter); return transporter;
}
async function requeueAt(emailId: string, runAt: number): Promise<void> {
  const nextJobId = `email-${emailId}-retry-${runAt}`;
  const scheduled = await prisma.email.update({ where: { id: emailId }, data: { status: 'SCHEDULED', queueJobId: nextJobId, scheduledAt: new Date(runAt) } });
  await emailQueue.add('send-email', { emailId }, { jobId: nextJobId, delay: Math.max(0, runAt - Date.now()) });
  void indexEmail(scheduled);
}
async function queueAmbiguousAttemptCheck(emailId: string, runAt: number): Promise<void> {
  const nextJobId = `email-${emailId}-delivery-check-${runAt}`;
  await prisma.email.update({ where: { id: emailId }, data: { queueJobId: nextJobId, scheduledAt: new Date(runAt) } });
  await emailQueue.add('send-email', { emailId }, { jobId: nextJobId, delay: Math.max(0, runAt - Date.now()) });
}
async function processEmail(job: Job<EmailJobData>): Promise<void> {
  const email = await prisma.email.findUnique({ where: { id: job.data.emailId }, include: { campaign: true } });
  if (!email || email.status === 'SENT' || email.status === 'FAILED') return;
  if (email.queueJobId && email.queueJobId !== job.id) return;
  if (email.status === 'SENDING') {
    const staleBoundary = new Date(Date.now() - 120_000); const sendingSince = email.sendingStartedAt ?? email.updatedAt;
    if (sendingSince.getTime() < staleBoundary.getTime()) {
      const ambiguity = 'Worker stopped during SMTP delivery. Delivery outcome may be ambiguous; not auto-resending to avoid duplicates.';
      const changed = await prisma.email.updateMany({ where: { id: email.id, status: 'SENDING', OR: [{ sendingStartedAt: { lt: staleBoundary } }, { sendingStartedAt: null, updatedAt: { lt: staleBoundary } }] }, data: { status: 'FAILED', failureReason: ambiguity } });
      if (changed.count) { const failed = await prisma.email.findUnique({ where: { id: email.id } }); if (failed) void indexEmail(failed); }
      return;
    }
    await queueAmbiguousAttemptCheck(email.id, sendingSince.getTime() + 120_000); return;
  }
  const senderLimit = config.MAX_EMAILS_PER_HOUR_PER_SENDER; const campaignLimit = email.campaign.hourlyLimit;
  const hourWindow = new Date().toISOString().slice(0, 13) + ':00';
  const senderHourKey = `rate:sender:${email.senderKey}:${hourWindow}`; const campaignHourKey = `rate:campaign:${email.campaignId}:${hourWindow}`; const senderNextKey = `rate:next:${email.senderKey}`;
  const result = await redis.eval(RESERVE_SEND_SLOT_LUA, 3, senderHourKey, campaignHourKey, senderNextKey, String(Date.now()), String(config.MIN_SEND_INTERVAL_MS), String(senderLimit), String(campaignLimit)) as [number, number, number, number];
  const [code, count, limit, waitMs] = result.map(Number) as [number, number, number, number];
  if (code !== 0) {
    if (code === 2) {
      const notifiedKey = `rate:slack-notified:${email.userId}:${email.senderKey}:${hourWindow}`; const wasNotified = await redis.exists(notifiedKey);
      if (!wasNotified) {
        const slackConnection = await prisma.slackConnection.findUnique({ where: { userId: email.userId }, select: { id: true } });
        if (slackConnection) { const shouldNotify = await redis.set(notifiedKey, '1', 'EX', 7200, 'NX'); if (shouldNotify) void notifySenderRateLimit(email.userId, email.senderKey, hourWindow, count, limit); }
      }
    }
    const jitter = Math.floor(Math.random() * (config.RATE_LIMIT_RETRY_JITTER_MS + 1));
    await requeueAt(email.id, Date.now() + Math.max(100, waitMs) + jitter);
    console.info(`Email ${email.id} rescheduled due to ${code === 1 ? 'minimum send interval' : code === 2 ? 'sender hourly limit' : 'campaign hourly limit'}.`); return;
  }
  const claimed = await prisma.email.updateMany({ where: { id: email.id, status: 'SCHEDULED', queueJobId: String(job.id) }, data: { status: 'SENDING', sendingStartedAt: new Date(), attemptCount: { increment: 1 }, failureReason: null } });
  if (claimed.count !== 1) return;
  const current = await prisma.email.findUniqueOrThrow({ where: { id: email.id } });
  const sender = senderProfiles.get(email.senderKey);
  if (!sender) {
    const message = `SMTP sender "${email.senderKey}" is not configured.`;
    const failed = await prisma.email.update({ where: { id: current.id }, data: { status: 'FAILED', sendingStartedAt: null, failureReason: message } });
    void indexEmail(failed);
    console.error(`Email ${current.id} failed: ${message}`);
    return;
  }

  // Only an explicit SMTP error enters BullMQ's retry path. A DB error after SMTP
  // acceptance must not trigger another delivery attempt, because the message may
  // already be visible in the recipient's mail server / Ethereal preview.
  const info = await (async () => {
    try {
      return await getTransport(email.senderKey).sendMail({ from: { name: sender.name, address: sender.email }, to: email.recipient, subject: email.subject, text: email.body });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown SMTP error';
      const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      const updated = await prisma.email.update({ where: { id: current.id }, data: { status: finalAttempt ? 'FAILED' : 'SCHEDULED', sendingStartedAt: null, failureReason: message.slice(0, 4000) } });
      void indexEmail(updated);
      if (finalAttempt) console.error(`Email ${current.id} permanently failed: ${message}`);
      throw error;
    }
  })();

  let sent;
  try {
    sent = await prisma.email.update({ where: { id: current.id }, data: { status: 'SENT', sentAt: new Date(), sendingStartedAt: null, smtpMessageId: info.messageId, failureReason: null } });
  } catch (databaseError) {
    console.error(`SMTP accepted email ${current.id}, but the database SENT update failed. Leaving the record in SENDING so recovery can mark it for manual review without blindly resending.`, databaseError);
    throw databaseError;
  }
  void indexEmail(sent);
  console.info(`Sent email ${sent.id} to ${sent.recipient}; Ethereal preview: ${nodemailer.getTestMessageUrl(info) ?? 'not available'}`);
}
const worker = new Worker<EmailJobData>(EMAIL_QUEUE_NAME, processEmail, { connection: redis, concurrency: config.WORKER_CONCURRENCY });
worker.on('completed', (job) => console.info(`Queue job ${job.id} completed.`));
worker.on('failed', (job, error) => console.error(`Queue job ${job?.id ?? 'unknown'} failed:`, error.message));
worker.on('error', (error) => console.error('BullMQ worker error:', error));
console.info(`Email worker online. Concurrency=${config.WORKER_CONCURRENCY}, minimum sender interval=${config.MIN_SEND_INTERVAL_MS}ms, per-sender hourly cap=${config.MAX_EMAILS_PER_HOUR_PER_SENDER}.`);
async function shutdown(signal: string) {
  console.info(`${signal} received; shutting down worker...`); await worker.close(); await emailQueue.close(); await prisma.$disconnect(); await redis.quit(); process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT')); process.on('SIGTERM', () => void shutdown('SIGTERM'));
