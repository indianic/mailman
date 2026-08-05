import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { ErrorCodes } from '../errors.js';
import { cancelCampaign, getCampaign, tallyRecipients } from '../campaigns/store.js';
import type { Tool } from './types.js';

const InputSchema = z.object({ campaignId: z.string() });

async function handler(rawArgs: Record<string, unknown>) {
  const parsed = InputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return toolError('INVALID_INPUT', parsed.error.message);
  }

  const existing = await getCampaign(parsed.data.campaignId);
  if (!existing) {
    return toolError(ErrorCodes.CAMPAIGN_NOT_FOUND, `No such campaign: ${parsed.data.campaignId}`);
  }

  const cancelled = await cancelCampaign(parsed.data.campaignId);
  const totals = tallyRecipients(cancelled!.recipients);

  // Reported, not glossed over: cancelling stops what is left, it does not
  // recall what already went out. A caller told only "cancelled: true" would
  // reasonably tell the user nothing was sent.
  return toolResponse({
    cancelled: true,
    campaignId: parsed.data.campaignId,
    status: cancelled!.status,
    ...totals,
    note:
      totals.sent > 0
        ? `${totals.sent} message(s) had already been sent and cannot be recalled; the remaining ${totals.skipped} were skipped.`
        : 'Nothing had been sent yet.',
  });
}

export const cancelCampaignTool: Tool = {
  definition: {
    name: 'cancel_campaign',
    description:
      'Stop a campaign. Pending recipients become "skipped" and are never sent; recipients already sent are untouched and reported back — cancelling is not a recall. Takes effect between messages, so it also stops a run that is currently in flight.',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'string', description: 'The campaignId returned by draft_campaign (see campaign_status)' },
      },
      required: ['campaignId'],
      additionalProperties: false,
    },
  },
  handler,
};
