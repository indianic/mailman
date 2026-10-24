import crypto from 'node:crypto';
import { getCampaignsPath } from '../config/paths.js';
import { readJsonFile, updateJsonFile } from '../config/store.js';
import {
  CampaignsFileSchema,
  DEFAULT_CAMPAIGNS_FILE,
  type CampaignContent,
  type CampaignEntry,
  type CampaignRecipientState,
} from '../config/schema.js';
import { encrypt, decrypt } from '../config/crypto.js';
import { getOrCreateMasterKey, getMasterKeyOrThrow } from '../config/keychain.js';

export function listCampaigns(): Promise<CampaignEntry[]> {
  return readJsonFile(getCampaignsPath(), CampaignsFileSchema, DEFAULT_CAMPAIGNS_FILE).then((f) => f.campaigns);
}

export async function getCampaign(campaignId: string): Promise<CampaignEntry | undefined> {
  const campaigns = await listCampaigns();
  return campaigns.find((c) => c.campaignId === campaignId);
}

/** Same "decrypt only when actually needed" discipline as scheduler/store.ts. */
export async function decryptCampaignContent(entry: CampaignEntry): Promise<CampaignContent> {
  const masterKey = await getMasterKeyOrThrow();
  return JSON.parse(decrypt(masterKey, entry.content)) as CampaignContent;
}

export interface CreateCampaignInput {
  account: string;
  throttlePerMinute: number;
  maxAttempts: number;
  content: CampaignContent;
}

export async function createCampaign(input: CreateCampaignInput): Promise<CampaignEntry> {
  const masterKey = await getOrCreateMasterKey();
  const campaignId = `cmp_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

  const entry: CampaignEntry = {
    campaignId,
    account: input.account,
    status: 'draft',
    createdAt: new Date().toISOString(),
    throttlePerMinute: input.throttlePerMinute,
    maxAttempts: input.maxAttempts,
    content: encrypt(masterKey, JSON.stringify(input.content)),
    recipients: input.content.recipients.map((_, seq) => ({ seq, status: 'pending' as const, attempts: 0 })),
  };

  await updateJsonFile(getCampaignsPath(), CampaignsFileSchema, DEFAULT_CAMPAIGNS_FILE, (current) => ({
    ...current,
    campaigns: [...current.campaigns, entry],
  }));

  return entry;
}

/**
 * Read-modify-write of one campaign, serialized against every other writer of
 * campaigns.json by config/store.ts's per-file queue.
 *
 * Every recipient transition goes through here rather than through an
 * in-memory copy held across the send loop. That is the difference between a
 * crash at recipient 20 costing nothing and costing 20 duplicate emails: the
 * file on disk is authoritative after every single send, not at the end.
 */
export async function updateCampaign(
  campaignId: string,
  mutate: (entry: CampaignEntry) => CampaignEntry,
): Promise<CampaignEntry | undefined> {
  let updated: CampaignEntry | undefined;
  await updateJsonFile(getCampaignsPath(), CampaignsFileSchema, DEFAULT_CAMPAIGNS_FILE, (current) => ({
    ...current,
    campaigns: current.campaigns.map((c) => {
      if (c.campaignId !== campaignId) return c;
      updated = mutate(c);
      return updated;
    }),
  }));
  return updated;
}

export function updateRecipient(
  campaignId: string,
  seq: number,
  mutate: (recipient: CampaignRecipientState) => CampaignRecipientState,
): Promise<CampaignEntry | undefined> {
  return updateCampaign(campaignId, (entry) => ({
    ...entry,
    recipients: entry.recipients.map((r) => (r.seq === seq ? mutate(r) : r)),
  }));
}

export interface CampaignTotals {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
}

export function tallyRecipients(recipients: CampaignRecipientState[]): CampaignTotals {
  return {
    total: recipients.length,
    sent: recipients.filter((r) => r.status === 'sent').length,
    failed: recipients.filter((r) => r.status === 'failed').length,
    skipped: recipients.filter((r) => r.status === 'skipped').length,
    pending: recipients.filter((r) => r.status === 'pending').length,
  };
}

/**
 * Who a run should still attempt: never-tried recipients, plus failures that
 * have retries left. `sent` and `skipped` are terminal and can never come back
 * into scope — that single rule is what makes re-running confirm_campaign a
 * resume rather than a restart.
 */
export function eligibleRecipients(entry: CampaignEntry): CampaignRecipientState[] {
  return entry.recipients.filter(
    (r) => r.status === 'pending' || (r.status === 'failed' && r.attempts < entry.maxAttempts),
  );
}

/** Pending → skipped. Already-sent recipients are untouched and stay reported. */
export async function cancelCampaign(campaignId: string): Promise<CampaignEntry | undefined> {
  return updateCampaign(campaignId, (entry) => ({
    ...entry,
    status: 'cancelled',
    recipients: entry.recipients.map((r) => (r.status === 'sent' ? r : { ...r, status: 'skipped' as const })),
  }));
}
