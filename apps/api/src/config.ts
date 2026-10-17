import 'dotenv/config';
import { z } from 'zod';
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'), API_ORIGIN: z.string().url().default('http://localhost:4000'),
  DATABASE_URL: z.string().min(1), REDIS_URL: z.string().url().default('redis://localhost:6379'),
  ELASTICSEARCH_URL: z.string().url().default('http://localhost:9200'), ELASTICSEARCH_USERNAME: z.string().optional().default(''), ELASTICSEARCH_PASSWORD: z.string().optional().default(''),
  SESSION_SECRET: z.string().min(32), GOOGLE_CLIENT_ID: z.string().optional().default(''), GOOGLE_CLIENT_SECRET: z.string().optional().default(''), GOOGLE_CALLBACK_URL: z.string().url().default('http://localhost:4000/api/auth/google/callback'),
  SLACK_CLIENT_ID: z.string().optional().default(''), SLACK_CLIENT_SECRET: z.string().optional().default(''), SLACK_CALLBACK_URL: z.string().url().default('http://localhost:4000/api/integrations/slack/callback'), TOKEN_ENCRYPTION_KEY: z.string().optional().default(''),
  SMTP_SENDERS_JSON: z.string().default('[]'), DEFAULT_SENDER_KEY: z.string().default('ethereal-primary'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5), MIN_SEND_INTERVAL_MS: z.coerce.number().int().min(1).default(2000),
  MAX_EMAILS_PER_HOUR_PER_SENDER: z.coerce.number().int().min(1).default(200), RATE_LIMIT_RETRY_JITTER_MS: z.coerce.number().int().min(0).default(250),
  BULL_BOARD_USERNAME: z.string().default('admin'), BULL_BOARD_PASSWORD: z.string().min(8).default('change-me-now'),
});
export const config = envSchema.parse(process.env);
export type SmtpSender = { key: string; name: string; email: string; host: string; port: number; secure: boolean; user: string; pass: string };
export function getSenders(): SmtpSender[] {
  let senders: unknown;
  try { senders = JSON.parse(config.SMTP_SENDERS_JSON); } catch { throw new Error('SMTP_SENDERS_JSON must be valid JSON.'); }
  if (!Array.isArray(senders)) throw new Error('SMTP_SENDERS_JSON must be a JSON array.');
  return senders.map((raw, index) => {
    const s = raw as Record<string, unknown>;
    for (const field of ['key','name','email','host','user','pass']) if (typeof s[field] !== 'string' || !s[field]) throw new Error(`SMTP sender #${index + 1} is missing ${field}.`);
    const port = Number(s.port ?? 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`SMTP sender #${index + 1} has an invalid port.`);
    return { key: String(s.key), name: String(s.name), email: String(s.email), host: String(s.host), port, secure: Boolean(s.secure), user: String(s.user), pass: String(s.pass) };
  });
}
