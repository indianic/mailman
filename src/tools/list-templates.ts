import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { listTemplates, listCategories, CORE_KEYS, TEMPLATES } from '../mail/templates.js';
import type { Tool } from './types.js';

const InputSchema = z.object({
  category: z.string().optional(),
  search: z.string().optional(),
  all: z.boolean().optional(),
});

async function handler(rawArgs: Record<string, unknown>) {
  const parsed = InputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return toolError('INVALID_INPUT', parsed.error.message);
  }
  const { category, search, all } = parsed.data;

  let templates = listTemplates({ category, search });
  // With no filter and no explicit `all`, return the tight core set to keep
  // the response high-signal; the full catalog is one `all:true` away.
  const filtered = Boolean(category || search);
  if (!filtered && !all) {
    templates = templates.filter((t) => CORE_KEYS.has(t.key));
  }

  return toolResponse({
    total: TEMPLATES.length,
    returned: templates.length,
    ...(filtered ? {} : { view: all ? 'all' : 'core' }),
    categories: listCategories(),
    templates: templates.map((t) => ({
      key: t.key,
      category: t.category,
      subjectPrefix: t.subjectPrefix || null,
      hint: t.hint,
      kind: t.kind,
    })),
    next_steps: [
      'Pick a template key and pass it as draft_email\'s `template` param; compose the body following its hint.',
    ],
  });
}

export const listTemplatesTool: Tool = {
  definition: {
    name: 'list_templates',
    description:
      'List message templates (subject prefix + a structural hint you compose from). No args returns the core set; pass category, search, or all:true for more. Use a key as draft_email\'s `template`.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Filter by category (see the categories field)' },
        search: { type: 'string', description: 'Free-text match on key/category/prefix/hint' },
        all: { type: 'boolean', description: 'Return the full catalog instead of just the core set' },
      },
    },
  },
  handler,
};
