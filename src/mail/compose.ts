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
 * Wrap an HTML body (body + signature, since appendSignature runs first) in the
 * branded MailMan shell: a brand accent bar, a readable ~600px card, and an
 * always-present IndiaNIC copyright footer. Because the signature is inside the
 * `html` passed here, it renders WITHIN the card — never dangling outside it.
 * Opt-in via settings.emailTheme / draft_email's `theme`; never touches text sends.
 */
const FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function wrapPolished(html: string): string {
  const year = new Date().getFullYear();
  return [
    '<div style="margin:0;padding:0;background:#f6f7f9">',
    `<div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;font-family:${FONT_STACK}">`,
    // Brand accent bar (the indigo→fuchsia identity), kept subtle for routine mail.
    '<div style="height:4px;background:linear-gradient(90deg,#6366f1,#a21caf,#d946ef)"></div>',
    `<div style="padding:28px 24px;font-size:15px;line-height:1.6;color:#1f2937">`,
    html,
    '</div>',
    // Always-on IndiaNIC footer / copyright.
    '<div style="border-top:1px solid #eef2f7;padding:16px 24px;font-size:12px;color:#9ca3af;text-align:center">',
    `© ${year} IndiaNIC Infotech Ltd. · <a href="https://mailman.indianic.dev" style="color:#6366f1;text-decoration:none">mailman.indianic.dev</a>`,
    '<br>Sent with MailMan',
    '</div>',
    '</div>',
    '</div>',
  ].join('');
}
