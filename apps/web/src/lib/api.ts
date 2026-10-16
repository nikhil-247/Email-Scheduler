export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
export type AppUser = { id: string; name: string; email: string; avatarUrl: string | null };
export type EmailRecord = { id: string; recipient: string; subject: string; scheduledAt: string; sentAt: string | null; status: 'scheduled' | 'sending' | 'sent' | 'failed'; senderKey: string; failureReason?: string | null; campaignId: string };
export type Sender = { key: string; name: string; email: string };
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...init, credentials: 'include', headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
