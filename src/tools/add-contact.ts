import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { addContact } from '../contacts.js';
import type { Tool } from './types.js';

const InputSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
});

async function handler(rawArgs: Record<string, unknown>) {
  const parsed = InputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return toolError('INVALID_INPUT', parsed.error.message);
  }
  await addContact(parsed.data.email, parsed.data.name);
  return toolResponse({ ok: true });
}

export const addContactTool: Tool = {
  definition: {
    name: 'add_contact',
    description: 'Manually add a contact to the local address book, independent of auto-populated recents.',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string' },
        name: { type: 'string' },
      },
      required: ['email'],
    },
  },
  handler,
};
