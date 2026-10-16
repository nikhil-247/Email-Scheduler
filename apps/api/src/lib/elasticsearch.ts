import { Client } from '@elastic/elasticsearch';
import { config } from '../config.js';
export const EMAIL_INDEX = 'reachinbox-emails-v1';
export const elasticsearch = new Client({ node: config.ELASTICSEARCH_URL, ...(config.ELASTICSEARCH_USERNAME && config.ELASTICSEARCH_PASSWORD ? { auth: { username: config.ELASTICSEARCH_USERNAME, password: config.ELASTICSEARCH_PASSWORD } } : {}) });
export async function ensureEmailIndex(): Promise<void> {
  const exists = await elasticsearch.indices.exists({ index: EMAIL_INDEX });
  if (!exists) await elasticsearch.indices.create({ index: EMAIL_INDEX, mappings: { properties: { id: { type: 'keyword' }, userId: { type: 'keyword' }, campaignId: { type: 'keyword' }, recipient: { type: 'search_as_you_type' }, subject: { type: 'search_as_you_type' }, body: { type: 'text' }, senderKey: { type: 'keyword' }, status: { type: 'keyword' }, scheduledAt: { type: 'date' }, sentAt: { type: 'date' }, createdAt: { type: 'date' } } } });
}
