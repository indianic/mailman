const SENSITIVE_KEYS = new Set([
  'pass',
  'password',
  'credentials',
  'refreshToken',
  'clientSecret',
  'accessToken',
  'body',
  'bodyText',
  'bodyHtml',
  'ciphertext',
]);

/** Recursively replaces credential/body-shaped fields with '[redacted]'. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEYS.has(key) ? '[redacted]' : redact(val);
    }
    return out;
  }
  return value;
}

/**
 * Opt-in verbose logging (MCP_MAILMAN_DEBUG=1) — always redacted, never
 * plaintext credentials/bodies even when explicitly enabled. Off by
 * default, since stderr output isn't something Claude needs to see.
 */
export function debugLog(message: string, data?: unknown): void {
  if (!process.env.MCP_MAILMAN_DEBUG) {
    return;
  }
  const suffix = data === undefined ? '' : ` ${JSON.stringify(redact(data))}`;
  process.stderr.write(`[mcp-mailman] ${message}${suffix}\n`);
}
