import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { updateAccountProfile, AccountResolutionError } from '../accounts.js';
import { renderSignaturePreview, resolveSignatureType } from '../mail/compose.js';
import type { Tool } from './types.js';

const InputSchema = z.object({
  alias: z.string().min(1),
  displayName: z.string().nullable().optional(),
  signature: z.string().nullable().optional(),
  signatureType: z.enum(['text', 'html']).optional(),
});

/**
 * The literal strings "null"/"undefined" reaching a profile field are a
 * serialisation accident somewhere upstream, never a signature anyone wants
 * appended to their mail. Rejected with the fix spelled out rather than stored:
 * silently treating "null" as clear would be as surprising as sending it.
 */
function literalNullMistake(field: string, value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (!/^\s*(null|undefined)\s*$/i.test(value)) return undefined;
  return `${field} is the literal string ${JSON.stringify(value.trim())} — almost certainly a serialisation bug. To clear the field pass JSON null; to keep it, omit the field.`;
}

async function handler(rawArgs: Record<string, unknown>) {
  const parsed = InputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return toolError('INVALID_INPUT', parsed.error.message);
  }
  const { alias, displayName, signature, signatureType } = parsed.data;

  for (const [field, value] of [['displayName', displayName], ['signature', signature]] as const) {
    const mistake = literalNullMistake(field, value);
    if (mistake) return toolError('INVALID_INPUT', mistake);
  }

  const warnings: string[] = [];
  if (typeof signature === 'string' && signatureType) {
    const detected = resolveSignatureType(signature);
    if (detected !== signatureType) {
      warnings.push(
        signatureType === 'text'
          ? 'signatureType is "text" but the signature contains HTML tags — they will show literally in sent mail. Pass signatureType: "html" if that markup is meant to render.'
          : 'signatureType is "html" but no recognisable HTML tags were found — the signature will be sent as-is; line breaks in it will NOT become <br>.',
      );
    }
  }

  try {
    const account = await updateAccountProfile(alias, { displayName, signature, signatureType });
    return toolResponse({
      alias: account.alias,
      displayName: account.displayName,
      signature: account.signature,
      signatureType: account.signatureType,
      // Test-render of the stored signature so the caller can confirm it looks
      // right before any real send uses it.
      ...(account.signature
        ? { signaturePreview: renderSignaturePreview(account.signature, account.signatureType) }
        : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  } catch (err) {
    if (err instanceof AccountResolutionError) {
      return toolError(err.code, err.message);
    }
    throw err;
  }
}

export const updateAccountProfileTool: Tool = {
  definition: {
    name: 'update_account_profile',
    description:
      'Update an existing account\'s "From Name" and/or signature without touching its credentials. Pass JSON null to clear a field, omit to leave it unchanged. Returns a signaturePreview (renderedHtml/renderedText) — show it to the user so they can verify the signature renders before it rides on real mail.',
    inputSchema: {
      type: 'object',
      properties: {
        alias: { type: 'string', description: 'Alias of the account to update (see list_accounts)' },
        displayName: { type: ['string', 'null'], description: '"From Name" shown to recipients, e.g. "Kalpesh Gamit"' },
        signature: {
          type: ['string', 'null'],
          description:
            'Appended to every draft from this account. May be plain text or HTML (e.g. a table-based signature pasted from a mail client) — declare which with signatureType, or it is auto-detected.',
        },
        signatureType: {
          type: 'string',
          enum: ['text', 'html'],
          description:
            'How the signature should be read: "html" renders its markup on HTML sends (converted to readable text on text sends); "text" escapes it literally. Omit to auto-detect from the content.',
        },
      },
      required: ['alias'],
      additionalProperties: false,
    },
  },
  handler,
};
