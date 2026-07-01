import { draftEmailTool } from './draft-email.js';
import { confirmSendTool } from './confirm-send.js';
import { cancelDraftTool } from './cancel-draft.js';
import { configureAccountTool } from './configure-account.js';
import type { Tool } from './types.js';

export const allTools: Tool[] = [draftEmailTool, confirmSendTool, cancelDraftTool, configureAccountTool];
