import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { removeContact } from '../contacts.js';
import type { Tool } from './types.js';

const InputSchema = z.object({ email: z.string().email() });

async function handler(rawArgs: Record<string, unknown>) {
  const parsed = InputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return toolError('INVALID_INPUT', parsed.error.message);
  }
  await removeContact(parsed.data.email);
  return toolResponse({ ok: true });
}

export const removeContactTool: Tool = {
  definition: {
    name: 'remove_contact',
    description: 'Remove a contact from the local address book.',
    inputSchema: {
      type: 'object',
      properties: { email: { type: 'string' } },
      required: ['email'],
    },
  },
  handler,
};
