import { z } from 'zod';

export const emailScheduleSchema = z.object({
  subject: z.string().trim().min(1).max(250),
  body: z.string().trim().min(1).max(100_000),
  recipients: z.array(z.string().trim().email().transform((value) => value.toLowerCase())).min(1).max(5000),
  scheduledAt: z.string().datetime({ offset: true }),
  delaySeconds: z.number().int().min(0).max(3600),
  hourlyLimit: z.number().int().min(1).max(10_000),
  senderKey: z.string().min(1),
  campaignName: z.string().trim().min(1).max(120).optional(),
});
