import { z } from 'zod';

const AddressSchema = z.string().email();

export interface ParsedRecipients {
  /** Bare, de-duplicated addresses, in first-seen order. */
  addresses: string[];
  /** Entries that couldn't be read as an address, verbatim, for the error message. */
  invalid: string[];
}

/**
 * Split a recipient string on `,`/`;` while ignoring separators inside a
 * quoted display name (`"Example, Alice" <alice@example.com>`) or inside the angle
 * brackets of an addr-spec.
 */
function splitEntries(value: string): string[] {
  const entries: string[] = [];
  let current = '';
  let inQuotes = false;
  let inAngles = false;

  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === '\\' && inQuotes && i + 1 < value.length) {
      current += char + value[i + 1];
      i++;
      continue;
    }
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && char === '<') inAngles = true;
    else if (!inQuotes && char === '>') inAngles = false;
    else if (!inQuotes && !inAngles && (char === ',' || char === ';')) {
      entries.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  entries.push(current);
  return entries;
}

/** `Alice Example <alice@example.com>` → `alice@example.com`; a bare address passes through. */
function extractAddress(entry: string): string {
  const angled = entry.match(/<([^>]*)>\s*$/);
  return (angled ? angled[1] : entry).trim();
}

/**
 * The display half of `Alice Example <alice@example.com>`, unquoted.
 * Undefined for a bare address — an empty string would be indistinguishable
 * from "this person has no name", which campaigns treat very differently.
 */
function extractDisplayName(entry: string): string | undefined {
  const angled = entry.match(/^(.*)<[^>]*>\s*$/);
  if (!angled) return undefined;
  const name = angled[1].trim().replace(/^"(.*)"$/, '$1').replace(/\\(.)/g, '$1').trim();
  return name || undefined;
}

export interface ParsedRecipientEntry {
  address: string;
  /** Only present when the caller wrote `Name <addr>`. */
  name?: string;
}

/**
 * Normalize whatever a caller passed for to/cc/bcc into bare addresses.
 *
 * Accepts a single address, a comma/semicolon-separated string, an array, or
 * an array whose elements are themselves separated lists — and the RFC 5322
 * `Name <addr>` form in any of those positions. Callers naturally write
 * multiple recipients as one separated string (it's the form mailman's own
 * read path emits for a `To` header), and rejecting it silently cost a
 * recipient their spot in `To`.
 *
 * Output is bare addresses on purpose: drafts flow into
 * `ScheduledMessageContentSchema` and `upsertRecipient`, both of which
 * validate with `z.string().email()`. A display name is dropped rather than
 * carried, so anything this returns is valid downstream.
 */
export function parseRecipientList(value: string | string[]): ParsedRecipients {
  const { entries, invalid } = parseRecipientEntries(value);
  return { addresses: entries.map((e) => e.address), invalid };
}

/**
 * The same parse as parseRecipientList, but keeping the display name.
 *
 * Mail sends drop it on purpose (see above); a personalised campaign is the
 * one caller that wants it — `draft_campaign` will happily use the "Yash
 * Suryawanshi" in `Yash Suryawanshi <yash.s@example.com>` as the `{{name}}`
 * for a recipient the local address book has never heard of.
 */
export function parseRecipientEntries(value: string | string[]): {
  entries: ParsedRecipientEntry[];
  invalid: string[];
} {
  const raw = Array.isArray(value) ? value : [value];
  const entries: ParsedRecipientEntry[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    for (const entry of splitEntries(item)) {
      const trimmed = entry.trim();
      // An empty slot ("alice@example.com, ") is a typo in the separator list, not a
      // recipient the caller meant — dropping it beats failing the send.
      if (!trimmed) continue;

      const address = extractAddress(trimmed);
      if (!AddressSchema.safeParse(address).success) {
        invalid.push(trimmed);
        continue;
      }
      const key = address.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ address, name: extractDisplayName(trimmed) });
    }
  }

  return { entries, invalid };
}

export type NormalizedRecipients =
  | { ok: true; to: string[]; cc: string[]; bcc: string[] }
  | { ok: false; message: string };

/**
 * Normalize a draft's three recipient fields together, with an error message
 * that says which field was bad and what it couldn't read — a caller that
 * gets "invalid to[1]: bob at example.com" can fix the call, whereas a
 * raw zod dump invites it to give up and quietly demote a recipient to Cc.
 */
export function normalizeRecipientFields(fields: {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
}): NormalizedRecipients {
  const parsed = {
    to: parseRecipientList(fields.to),
    cc: parseRecipientList(fields.cc ?? []),
    bcc: parseRecipientList(fields.bcc ?? []),
  };

  const problems = (['to', 'cc', 'bcc'] as const)
    .filter((field) => parsed[field].invalid.length > 0)
    .map((field) => `${field}: ${parsed[field].invalid.map((entry) => `"${entry}"`).join(', ')}`);
  if (problems.length > 0) {
    return {
      ok: false,
      message: `Not a usable email address — ${problems.join('; ')}. Pass each recipient as a plain address; multiple recipients can be an array or one comma-separated string.`,
    };
  }

  if (parsed.to.addresses.length === 0) {
    return { ok: false, message: 'at least one recipient is required in "to".' };
  }

  return { ok: true, to: parsed.to.addresses, cc: parsed.cc.addresses, bcc: parsed.bcc.addresses };
}
