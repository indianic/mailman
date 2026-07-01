import { draftEmailTool } from './draft-email.js';
import { confirmSendTool } from './confirm-send.js';
import { cancelDraftTool } from './cancel-draft.js';
import { configureAccountTool } from './configure-account.js';
import { previewAttachmentsTool } from './preview-attachments.js';
import { listAccountsTool } from './list-accounts.js';
import { removeAccountTool } from './remove-account.js';
import { getSettingsTool } from './get-settings.js';
import { updateSettingsTool } from './update-settings.js';
import { addContactTool } from './add-contact.js';
import { removeContactTool } from './remove-contact.js';
import { listContactsTool } from './list-contacts.js';
import { suggestRecipientsTool } from './suggest-recipients.js';
import { listRecentEmailsTool } from './list-recent-emails.js';
import { searchEmailsTool } from './search-emails.js';
import { readEmailTool } from './read-email.js';
import { scheduleSendTool } from './schedule-send.js';
import { listScheduledTool } from './list-scheduled.js';
import { cancelScheduledTool } from './cancel-scheduled.js';
import { getStatusTool } from './get-status.js';
import type { Tool } from './types.js';

export const allTools: Tool[] = [
  draftEmailTool,
  confirmSendTool,
  cancelDraftTool,
  configureAccountTool,
  previewAttachmentsTool,
  listAccountsTool,
  removeAccountTool,
  getSettingsTool,
  updateSettingsTool,
  addContactTool,
  removeContactTool,
  listContactsTool,
  suggestRecipientsTool,
  listRecentEmailsTool,
  searchEmailsTool,
  readEmailTool,
  scheduleSendTool,
  listScheduledTool,
  cancelScheduledTool,
  getStatusTool,
];
