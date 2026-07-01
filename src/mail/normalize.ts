// Shared limits/helpers both backends (GmailApiProvider, ImapSmtpProvider)
// map into — see docs/PLAN.md's "Reading, listing, and searching mail"
// section. Keeps a single long email body or an uncapped message list
// from consuming a large slice of Claude's context window for one call.
export const MAX_LIST_LIMIT = 50;
export const DEFAULT_LIST_LIMIT = 10;
export const MAX_SNIPPET_CHARS = 200;
export const MAX_BODY_CHARS = 20_000;

export function truncateSnippet(text: string): string {
  return text.length > MAX_SNIPPET_CHARS ? text.slice(0, MAX_SNIPPET_CHARS) : text;
}

export function truncateBody(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_BODY_CHARS) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, MAX_BODY_CHARS), truncated: true };
}

export function clampLimit(requested: number | undefined): number {
  if (!requested || requested <= 0) {
    return DEFAULT_LIST_LIMIT;
  }
  return Math.min(requested, MAX_LIST_LIMIT);
}
