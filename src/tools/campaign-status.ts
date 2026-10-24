import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { ErrorCodes } from '../errors.js';
import { decryptCampaignContent, getCampaign, listCampaigns, tallyRecipients } from '../campaigns/store.js';
import type { Tool } from './types.js';

const InputSchema = z.object({
  campaignId: z.string().optional(),
  account: z.string().optional(),
});

async function handler(rawArgs: Record<string, unknown>) {
  const parsed = InputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return toolError('INVALID_INPUT', parsed.error.message);
  }

  // No id — the list view. Deliberately does not decrypt: "which campaigns
  // exist and how far did they get" is answerable from the plaintext half.
  if (!parsed.data.campaignId) {
    const all = await listCampaigns();
    const filtered = parsed.data.account ? all.filter((c) => c.account === parsed.data.account) : all;
    return toolResponse({
      campaigns: filtered.map((c) => ({
        campaignId: c.campaignId,
        account: c.account,
        status: c.status,
        createdAt: c.createdAt,
        ...tallyRecipients(c.recipients),
      })),
    });
  }

  const campaign = await getCampaign(parsed.data.campaignId);
  if (!campaign) {
    return toolError(ErrorCodes.CAMPAIGN_NOT_FOUND, `No such campaign: ${parsed.data.campaignId}`);
  }

  const content = await decryptCampaignContent(campaign);

  return toolResponse({
    campaignId: campaign.campaignId,
    account: campaign.account,
    status: campaign.status,
    createdAt: campaign.createdAt,
    subject: content.subjectTemplate,
    throttlePerMinute: campaign.throttlePerMinute,
    maxAttempts: campaign.maxAttempts,
    ccFirstOnly: content.ccFirstOnly,
    bccFirstOnly: content.bccFirstOnly ?? [],
    ...(campaign.ccAppliedToSeq !== undefined
      ? { visibilityListCarriedBy: content.recipients[campaign.ccAppliedToSeq]?.email }
      : {}),
    ...(campaign.abortReason ? { abortReason: campaign.abortReason } : {}),
    ...tallyRecipients(campaign.recipients),
    recipients: campaign.recipients.map((r) => ({
      email: content.recipients[r.seq]?.email,
      status: r.status,
      attempts: r.attempts,
      ...(r.sentAt ? { sentAt: r.sentAt } : {}),
      ...(r.messageId ? { messageId: r.messageId } : {}),
      ...(r.error ? { error: r.error } : {}),
      ...(r.status === 'failed' ? { retriable: r.attempts < campaign.maxAttempts } : {}),
    })),
  });
}

export const campaignStatusTool: Tool = {
  definition: {
    name: 'campaign_status',
    description:
      'Per-recipient state of a campaign — who was sent, who failed and why, who is still pending. Call with no campaignId to list every campaign. This is how a partially-sent or aborted run is inspected before deciding whether to resume it.',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'string', description: 'Omit to list all campaigns instead of detailing one' },
        account: { type: 'string', description: 'List view only — filter by account alias' },
      },
      required: [],
      additionalProperties: false,
    },
  },
  handler,
};
