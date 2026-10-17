import { prisma } from '../lib/prisma.js';
import { decryptToken } from './token-crypto.js';
async function slackPost(token: string, method: string, body: Record<string, unknown>) {
  const response = await fetch(`https://slack.com/api/${method}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
  const result = await response.json() as { ok?: boolean; error?: string; channel?: { id?: string } };
  if (!response.ok || !result.ok) throw new Error(`Slack ${method} failed: ${result.error ?? response.statusText}`);
  return result;
}
export async function notifySenderRateLimit(ownerId: string, senderKey: string, hourWindow: string, count: number, limit: number): Promise<void> {
  try {
    const connection = await prisma.slackConnection.findUnique({ where: { userId: ownerId } });
    if (!connection) return;
    const accessToken = decryptToken(connection.botToken);
    const conversation = await slackPost(accessToken, 'conversations.open', { users: connection.slackUserId });
    const channel = conversation.channel?.id;
    if (!channel) throw new Error('Slack did not return a DM channel.');
    await slackPost(accessToken, 'chat.postMessage', { channel, text: `ReachInbox email rate limit reached\nSender: ${senderKey}\nHourly limit: ${limit}\nWindow: ${hourWindow} UTC\nCount: ${count}. Remaining emails have been rescheduled to the next hour.` });
  } catch (error) { console.error(`Slack rate-limit notification failed for user ${ownerId}:`, error); }
}
