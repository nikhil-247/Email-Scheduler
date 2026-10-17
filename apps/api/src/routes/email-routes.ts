import { Router } from 'express';
import { z } from 'zod';
import { config, getSenders } from '../config.js';
import { prisma } from '../lib/prisma.js';
import { elasticsearch, EMAIL_INDEX, ensureEmailIndex } from '../lib/elasticsearch.js';
import { enqueueScheduledEmails } from '../services/queue-recovery.js';
import { requireAuth } from '../middleware/auth.js';

export const emailRouter = Router();
emailRouter.use(requireAuth);
const scheduleSchema = z.object({
  subject: z.string().trim().min(1).max(250), body: z.string().trim().min(1).max(100_000),
  recipients: z.array(z.string().trim().email().transform((v) => v.toLowerCase())).min(1).max(5000),
  scheduledAt: z.string().datetime({ offset: true }), delaySeconds: z.number().int().min(0).max(3600),
  hourlyLimit: z.number().int().min(1).max(10_000), senderKey: z.string().min(1), campaignName: z.string().trim().min(1).max(120).optional(),
});
emailRouter.get('/senders', (_req, res) => { const senders = getSenders().map(({ key, name, email }) => ({ key, name, email })); res.json({ senders, defaultSenderKey: config.DEFAULT_SENDER_KEY }); });
emailRouter.post('/schedule', async (req, res, next) => {
  try {
    const parsed = scheduleSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid schedule request.', details: parsed.error.flatten() }); return; }
    const input = parsed.data; const user = req.user as Express.User; const senders = getSenders();
    if (!senders.some((s) => s.key === input.senderKey)) { res.status(400).json({ error: 'Unknown senderKey. Configure it in SMTP_SENDERS_JSON first.' }); return; }
    const idempotencyKey = req.header('Idempotency-Key')?.trim();
    if (!idempotencyKey) { res.status(400).json({ error: 'Idempotency-Key header is required to prevent duplicate campaign creation.' }); return; }
    if (idempotencyKey.length > 200) { res.status(400).json({ error: 'Idempotency-Key must be at most 200 characters.' }); return; }
    const startAt = new Date(input.scheduledAt);
    if (startAt.getTime() <= Date.now()) { res.status(400).json({ error: 'scheduledAt must be a future time. Choose a time later than now.' }); return; }
    const uniqueRecipients = [...new Set(input.recipients)];
    const campaignName = input.campaignName || input.subject.slice(0, 80);
    let campaign;
    try {
      campaign = await prisma.campaign.create({ data: {
        userId: user.id, name: campaignName, subject: input.subject, body: input.body, senderKey: input.senderKey,
        startAt, delayMs: input.delaySeconds * 1000, hourlyLimit: input.hourlyLimit, idempotencyKey,
        emails: { create: uniqueRecipients.map((recipient, index) => ({ userId: user.id, recipient, sequence: index, subject: input.subject, body: input.body, senderKey: input.senderKey, scheduledAt: new Date(startAt.getTime() + index * input.delaySeconds * 1000), queueJobId: '' })) },
      }, include: { emails: true } });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        const previous = await prisma.campaign.findUnique({ where: { userId_idempotencyKey: { userId: user.id, idempotencyKey } }, include: { emails: true } });
        if (previous) { await enqueueScheduledEmails(previous.id); res.status(200).json({ campaignId: previous.id, idempotentReplay: true, count: previous.emails.length }); return; }
      }
      throw error;
    }
    // Bulk insertion handles large recipient lists. A retry with the same key repairs queue failures.
    await enqueueScheduledEmails(campaign.id);
    const created = await prisma.email.findMany({ where: { campaignId: campaign.id }, orderBy: { sequence: 'asc' } });
    res.status(201).json({ campaignId: campaign.id, count: created.length, emails: created.map((e) => ({ id: e.id, recipient: e.recipient, subject: e.subject, scheduledAt: e.scheduledAt, status: e.status.toLowerCase() })) });
  } catch (error) { next(error); }
});
emailRouter.get('/', async (req, res, next) => {
  try {
    const user = req.user as Express.User; const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : undefined;
    const validStatus = ['SCHEDULED','SENDING','SENT','FAILED'].includes(status ?? '') ? status as 'SCHEDULED' | 'SENDING' | 'SENT' | 'FAILED' : undefined;
    const page = Math.max(1, Math.min(10000, Number(req.query.page) || 1)); const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize) || 50));
    const where = { userId: user.id, ...(validStatus ? { status: validStatus } : {}) };
    const [items, total] = await Promise.all([prisma.email.findMany({ where, orderBy: [{ scheduledAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }), prisma.email.count({ where })]);
    res.json({ items: items.map((e) => ({ id: e.id, recipient: e.recipient, subject: e.subject, scheduledAt: e.scheduledAt, sentAt: e.sentAt, status: e.status.toLowerCase(), senderKey: e.senderKey, failureReason: e.failureReason, campaignId: e.campaignId })), total, page, pageSize });
  } catch (error) { next(error); }
});
emailRouter.get('/search', async (req, res, next) => {
  try {
    const user = req.user as Express.User; const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) { res.json({ items: [] }); return; }
    await ensureEmailIndex();
    const result = await elasticsearch.search({ index: EMAIL_INDEX, query: { bool: { filter: [{ term: { userId: user.id } }], must: [{ multi_match: { query: q, fields: ['recipient', 'subject', 'body'] } }] } }, size: 50 });
    res.json({ items: result.hits.hits.map((hit) => hit._source) });
  } catch (error) { next(error); }
});
