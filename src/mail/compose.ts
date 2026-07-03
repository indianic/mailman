import crypto from 'node:crypto';

/** RFC 5322 "From" header value — bare address when the account has no display name set. */
export function formatFromAddress(email: string, displayName?: string): string {
  return displayName ? `${displayName} <${email}>` : email;
}

/**
 * A Message-ID whose local part is prefixed `mcp-mailman.` so any message this
 * tool sent is trivially identifiable — search/filter Message-ID for
 * "mcp-mailman" to find "did mailman send this?". The domain half is taken
 * from the sender address (falling back to a stable literal) to keep it a
 * valid RFC 5322 msg-id. Pass this as nodemailer's `messageId` option.
 */
export function buildMessageId(fromEmail: string): string {
  const domain = fromEmail.split('@')[1] || 'mcp-mailman.local';
  return `<mcp-mailman.${crypto.randomUUID()}@${domain}>`;
}

/** Custom headers stamped on every outbound message — the conventional X-Mailer brand, for filtering/tracking. */
export function mailmanHeaders(): Record<string, string> {
  return { 'X-Mailer': 'mcp-mailman' };
}

/**
 * Appended at draft time (not send time) so the preview shown to the user
 * for confirmation matches exactly what confirm_send later dispatches.
 */
export function appendSignature(body: string, signature: string | undefined, bodyType: 'text' | 'html'): string {
  if (!signature) return body;
  const separator = bodyType === 'html' ? '<br><br>' : '\n\n';
  return `${body}${separator}${signature}`;
}

/**
 * Wrap an HTML body in a clean, minimal shell — a shared visual identity for
 * emails: readable font stack, ~600px column, comfortable line-height, and a
 * subtle divider before the signature. Opt-in via settings.emailTheme or
 * draft_email's `theme` param; never changes plain/text sends.
 */
export function wrapPolished(html: string): string {
  return [
    '<div style="margin:0;padding:0;background:#f6f7f9">',
    '<div style="max-width:600px;margin:0 auto;padding:28px 24px;',
    'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;',
    'font-size:15px;line-height:1.6;color:#1f2937;background:#ffffff;',
    'border:1px solid #e5e7eb;border-radius:12px">',
    html,
    '</div>',
    '<div style="max-width:600px;margin:8px auto 0;padding:0 24px;',
    'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;',
    'font-size:12px;color:#9ca3af;text-align:center">Sent with MailMan</div>',
    '</div>',
  ].join('');
}
