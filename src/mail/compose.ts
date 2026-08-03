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

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Exported for tests — the signature is the one place plain text meets HTML. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/**
 * Appended at draft time (not send time) so the preview shown to the user
 * for confirmation matches exactly what confirm_send later dispatches.
 *
 * The signature is a PLAIN TEXT field — `account profile --signature
 * "Regards,\nKalpesh"` stores a real newline, and docs/CLI.md documents it that
 * way. Dropping it into an HTML body verbatim, which is what this used to do,
 * broke it two ways:
 *
 *  - **Newlines vanished.** HTML collapses whitespace, so the documented
 *    multi-line signature rendered as one run-on line: "Regards, Kalpesh Gamit
 *    IndiaNIC". Only `<br><br>` between body and signature was ever emitted.
 *  - **Markup characters were interpreted.** A signature containing
 *    `<kalpesh@indianic.com>` disappeared entirely — the browser read it as an
 *    unknown tag — and `Sales & Marketing` was an invalid entity. Silent loss,
 *    which is worse than showing something wrong.
 *
 * So for HTML the signature is escaped first and *then* newlines become `<br>`.
 * That order matters: escaping afterwards would turn the `<br>` into `&lt;br&gt;`.
 *
 * The trade-off, stated plainly: a signature that deliberately contains HTML now
 * shows its tags literally instead of rendering. That is the correct reading of a
 * field documented as plain text, and a visibly literal tag is a better failure
 * than content that silently disappears.
 */
export function appendSignature(body: string, signature: string | undefined, bodyType: 'text' | 'html'): string {
  if (!signature) return body;
  if (bodyType === 'text') return `${body}\n\n${signature}`;

  // Normalise CRLF/CR first so a signature typed on Windows breaks identically.
  const asHtml = escapeHtml(signature.replace(/\r\n?/g, '\n')).replace(/\n/g, '<br>');
  return `${body}<br><br>${asHtml}`;
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
