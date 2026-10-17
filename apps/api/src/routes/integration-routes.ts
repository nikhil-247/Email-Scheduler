import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { encryptToken } from '../services/token-crypto.js';

export const integrationRouter = Router();
integrationRouter.use(requireAuth);
integrationRouter.get('/slack/status', async (req, res, next) => {
  try {
    const connection = await prisma.slackConnection.findUnique({ where: { userId: (req.user as Express.User).id }, select: { teamId: true, teamName: true, connectedAt: true } });
    res.json({ connected: Boolean(connection), connection });
  } catch (error) { next(error); }
});
integrationRouter.get('/slack/connect', (req, res) => {
  if (!config.SLACK_CLIENT_ID || !config.SLACK_CLIENT_SECRET) { res.status(503).json({ error: 'Slack OAuth is not configured. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET in .env.' }); return; }
  if (!config.TOKEN_ENCRYPTION_KEY) { res.status(503).json({ error: 'Slack token encryption is not configured. Set TOKEN_ENCRYPTION_KEY in .env before connecting Slack.' }); return; }
  const state = randomBytes(24).toString('hex');
  req.session.slackOauthState = state;
  const url = new URL('https://slack.com/oauth/v2/authorize');
  url.searchParams.set('client_id', config.SLACK_CLIENT_ID); url.searchParams.set('scope', 'chat:write,im:write');
  url.searchParams.set('redirect_uri', config.SLACK_CALLBACK_URL); url.searchParams.set('state', state);
  res.redirect(url.toString());
});
integrationRouter.get('/slack/callback', async (req, res, next) => {
  try {
    const expected = req.session.slackOauthState; delete req.session.slackOauthState;
    const actual = typeof req.query.state === 'string' ? req.query.state : '';
    if (!expected || !actual || expected.length !== actual.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) { res.status(400).send('Invalid OAuth state. Please reconnect Slack from the dashboard.'); return; }
    if (typeof req.query.code !== 'string') { res.redirect(`${config.WEB_ORIGIN}/dashboard?slack=cancelled`); return; }
    const tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.SLACK_CLIENT_ID, client_secret: config.SLACK_CLIENT_SECRET, code: req.query.code, redirect_uri: config.SLACK_CALLBACK_URL }) });
    const payload = await tokenResponse.json() as { ok?: boolean; error?: string; access_token?: string; team?: { id?: string; name?: string }; authed_user?: { id?: string } };
    if (!tokenResponse.ok || !payload.ok || !payload.access_token || !payload.team?.id || !payload.authed_user?.id) throw new Error(`Slack OAuth failed: ${payload.error ?? tokenResponse.statusText}`);
    await prisma.slackConnection.upsert({ where: { userId: (req.user as Express.User).id }, update: { botToken: encryptToken(payload.access_token), teamId: payload.team.id, teamName: payload.team.name ?? 'Slack workspace', slackUserId: payload.authed_user.id }, create: { userId: (req.user as Express.User).id, botToken: encryptToken(payload.access_token), teamId: payload.team.id, teamName: payload.team.name ?? 'Slack workspace', slackUserId: payload.authed_user.id } });
    res.redirect(`${config.WEB_ORIGIN}/dashboard?slack=connected`);
  } catch (error) { next(error); }
});
integrationRouter.delete('/slack', async (req, res, next) => {
  try { await prisma.slackConnection.deleteMany({ where: { userId: (req.user as Express.User).id } }); res.status(204).end(); }
  catch (error) { next(error); }
});
