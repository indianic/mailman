export interface ToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/**
 * Host-agnostic JSON-in-text-block response. Mirrors the convention in
 * this developer's sibling MCP server (sshmanager/mcp-server/src/types.ts's
 * textResponse()), so every host renders the same way regardless of
 * structuredContent adoption. See docs/PLAN.md's "Output format" section.
 */
export function toolResponse(value: unknown): ToolResponse {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

/**
 * Structured error, upgrading the sibling project's plain-string
 * errorResponse with a `code` field — mailman's control flow (ambiguous
 * account, rate limiting, expired drafts) needs a code Claude can branch
 * on, not just prose to pattern-match.
 */
export function toolError(code: string, message: string): ToolResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify({ code, message }) }],
    isError: true,
  };
}
