import { createClient } from 'redis';
import session from 'express-session';
import RedisStore from 'connect-redis';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import passport from 'passport';
import { ExpressAdapter } from '@bull-board/express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { config } from './config.js';
import { configurePassport } from './auth.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { emailQueue } from './lib/queue.js';
import { emailIndexQueue } from './lib/index-queue.js';
import { ensureEmailIndex } from './lib/elasticsearch.js';
import { authRouter } from './routes/auth-routes.js';
import { integrationRouter } from './routes/integration-routes.js';
import { emailRouter } from './routes/email-routes.js';
import { requireAuth } from './middleware/auth.js';
import { enqueueAllEmailIndexes, indexEmail } from './services/email-indexer.js';
import { enqueueScheduledEmails } from './services/queue-recovery.js';

async function recoverScheduledEmails() {
  const staleBoundary = new Date(Date.now() - 120_000);
  const interrupted = await prisma.email.findMany({ where: { status: 'SENDING', OR: [{ sendingStartedAt: { lt: staleBoundary } }, { sendingStartedAt: null, updatedAt: { lt: staleBoundary } }] } });
  if (interrupted.length) {
    const ambiguity = 'Worker stopped during SMTP delivery. Delivery outcome may be ambiguous; not auto-resending to avoid duplicates.';
    await prisma.email.updateMany({ where: { id: { in: interrupted.map((email) => email.id) }, status: 'SENDING' }, data: { status: 'FAILED', sendingStartedAt: null, failureReason: ambiguity } });
    interrupted.forEach((email) => { void indexEmail(email); });
    console.warn(`Marked ${interrupted.length} interrupted SMTP attempts as failed for manual review.`);
  }
  const recovered = await enqueueScheduledEmails();
  console.info(`Scheduler recovery complete: inspected ${recovered.inspected} scheduled emails, re-enqueued ${recovered.enqueued}, marked ${recovered.manualReview} ambiguous terminal queue records for review.`);
}

async function main() {
  const sessionClient = createClient({ url: config.REDIS_URL });
  sessionClient.on('error', (error) => console.error('Session Redis error:', error));
  await sessionClient.connect();
  configurePassport();
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginOpenerPolicy: false }));
  app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(session({ store: new RedisStore({ client: sessionClient }), name: 'reachinbox.sid', secret: config.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax', secure: config.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 } }));
  app.use(passport.initialize()); app.use(passport.session());
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'reachinbox-email-scheduler', timestamp: new Date().toISOString() }));
  app.use('/api/auth', authRouter); app.use('/api/integrations', integrationRouter); app.use('/api/emails', emailRouter);
  const serverAdapter = new ExpressAdapter(); serverAdapter.setBasePath('/admin/queues');
  createBullBoard({ queues: [new BullMQAdapter(emailQueue), new BullMQAdapter(emailIndexQueue)], serverAdapter });
  app.use('/admin/queues', requireAuth, (req, res, next) => {
    const authHeader = req.header('authorization');
    if (!authHeader?.startsWith('Basic ')) { res.setHeader('WWW-Authenticate', 'Basic realm="BullMQ Dashboard"'); res.status(401).send('Authentication required'); return; }
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8'); const separator = decoded.indexOf(':');
    const username = decoded.slice(0, separator); const password = decoded.slice(separator + 1);
    if (username !== config.BULL_BOARD_USERNAME || password !== config.BULL_BOARD_PASSWORD) { res.setHeader('WWW-Authenticate', 'Basic realm="BullMQ Dashboard"'); res.status(401).send('Invalid dashboard credentials'); return; }
    next();
  }, serverAdapter.getRouter());
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { console.error('API error:', error); if (res.headersSent) return; res.status(500).json({ error: 'Internal server error. Check the API logs for details.' }); });
  await prisma.$connect();
  try { await ensureEmailIndex(); } catch (error) { console.error('Elasticsearch unavailable at startup; the persistent indexing worker will retry:', error); }
  const searchJobsQueued = await enqueueAllEmailIndexes();
  console.info(`Queued ${searchJobsQueued} existing email records for Elasticsearch indexing/reconciliation.`);
  await recoverScheduledEmails();
  const server = app.listen(config.API_PORT, () => console.info(`API listening on http://localhost:${config.API_PORT}`));
  const shutdown = async (signal: string) => {
    console.info(`${signal} received; shutting down API...`);
    server.close(async () => { await Promise.all([emailQueue.close(), emailIndexQueue.close()]); await prisma.$disconnect(); await sessionClient.quit(); await redis.quit(); process.exit(0); });
  };
  process.on('SIGINT', () => void shutdown('SIGINT')); process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
main().catch((error) => { console.error('Failed to start API:', error); process.exit(1); });
