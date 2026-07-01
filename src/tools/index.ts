import { draftEmailTool } from './draft-email.js';
import { confirmSendTool } from './confirm-send.js';
import { cancelDraftTool } from './cancel-draft.js';
import { configureAccountTool } from './configure-account.js';
import { previewAttachmentsTool } from './preview-attachments.js';
import { listAccountsTool } from './list-accounts.js';
import { removeAccountTool } from './remove-account.js';
import { getSettingsTool } from './get-settings.js';
import { updateSettingsTool } from './update-settings.js';
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
];
