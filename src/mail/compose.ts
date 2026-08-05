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
 * So for a PLAIN TEXT signature it is escaped first and *then* newlines become
 * `<br>`. That order matters: escaping afterwards would turn the `<br>` into
 * `&lt;br&gt;`.
 *
 * That used to be the whole story, and the trade-off was stated here as
 * acceptable: "a signature that deliberately contains HTML now shows its tags
 * literally … a visibly literal tag is a better failure than content that
 * silently disappears." **It was not acceptable.** The first real campaign put
 * `---------------&lt;br&gt;&lt;i&gt;Thanks &amp;amp; Regards…` in front of four
 * colleagues, because the stored signature was the one the user's mail client
 * had given them — which is markup. "Better than silent loss" is a low bar, and
 * both failures were avoidable.
 *
 * So the content decides now. A signature containing recognisable formatting
 * tags is treated as HTML and sanitised through an allowlist
 * (`sanitizeSignatureHtml`); anything else keeps the escaping path above
 * unchanged. Every guarantee that motivated the escaping still holds — see the
 * tests: `<kalpesh@indianic.com>` is not a tag and still cannot vanish, a bare
 * `&` is still an ampersand rather than a broken entity, and nothing in a
 * signature can close the polished card or run a script.
 */
export function appendSignature(body: string, signature: string | undefined, bodyType: 'text' | 'html'): string {
  if (!signature) return body;
  if (bodyType === 'text') return `${body}\n\n${signature}`;

  if (looksLikeHtmlSignature(signature)) {
    return `${body}<br><br>${sanitizeSignatureHtml(signature)}`;
  }

  // Normalise CRLF/CR first so a signature typed on Windows breaks identically.
  const asHtml = escapeHtml(signature.replace(/\r\n?/g, '\n')).replace(/\n/g, '<br>');
  return `${body}<br><br>${asHtml}`;
}

/**
 * Inline formatting a real email signature actually uses.
 *
 * Block and layout tags are deliberately absent — `div`, `p`, `table`. An
 * unbalanced `</div>` in a signature closes the polished card early and
 * swallows the footer, and a signature is the one piece of an email nobody
 * re-reads after setting it once.
 */
const SIGNATURE_TAGS = new Set([
  'br', 'b', 'strong', 'i', 'em', 'u', 's', 'small', 'sub', 'sup', 'span', 'a', 'hr', 'font', 'img',
]);

const SIGNATURE_ATTRS = new Set([
  'href', 'src', 'alt', 'title', 'width', 'height', 'style', 'color', 'size', 'face', 'target',
]);

const VOID_TAGS = new Set(['br', 'hr', 'img']);

/**
 * A tag from the allowlist, matched strictly enough that `<kalpesh@indianic.com>`
 * is not one.
 *
 * The strictness is the whole point. A loose `<(tag)\b` would read
 * `<sub@example.com>` as a `<sub>` element and delete the address — reinstating
 * the exact silent-loss bug the escaping was introduced to fix. So the tag name
 * must be followed by `>`, `/>`, or whitespace-then-attributes, and `@` is none
 * of those.
 */
function signatureTagPattern(flags: string): RegExp {
  return new RegExp(`<\\s*(/?)\\s*([a-zA-Z][a-zA-Z0-9]*)\\s*(/?>|\\s[^>]*>)`, flags);
}

/**
 * Whether this signature was written as HTML rather than as plain text.
 *
 * The field is documented plain-text (docs/CLI.md), and for a long time that
 * reading was enforced by escaping everything. It cost a real user a correctly
 * rendered signature on every HTML send: people paste the signature their mail
 * client already gave them, which is markup, and got `&lt;br&gt;` in front of
 * colleagues. Both readings are now honoured — the content decides.
 */
export function looksLikeHtmlSignature(signature: string): boolean {
  for (const match of signature.matchAll(signatureTagPattern('gi'))) {
    if (SIGNATURE_TAGS.has(match[2].toLowerCase())) return true;
  }
  return false;
}

/** Escape text that sits BETWEEN tags, leaving existing entities (`&amp;`) intact. */
function escapeTextKeepingEntities(text: string): string {
  return text
    .replace(/&(?!#?[a-zA-Z0-9]+;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function rebuildTag(closing: string, name: string, rest: string): string {
  const tag = name.toLowerCase();
  if (closing) return VOID_TAGS.has(tag) ? '' : `</${tag}>`;

  const attrs: string[] = [];
  for (const attr of rest.replace(/\/?>$/, '').matchAll(/([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    const key = attr[1].toLowerCase();
    if (!SIGNATURE_ATTRS.has(key)) continue; // drops every on* handler by omission
    const value = attr[2] ?? attr[3] ?? attr[4] ?? '';
    // A javascript:/vbscript: URL in a signature is never legitimate. data: is
    // allowed only for inline images, which is how embedded logos arrive.
    if ((key === 'href' || key === 'src') && /^\s*(?:javascript|vbscript|data):/i.test(value)) {
      if (!/^\s*data:image\//i.test(value)) continue;
    }
    attrs.push(`${key}="${value.replace(/"/g, '&quot;')}"`);
  }

  return `<${tag}${attrs.length > 0 ? ` ${attrs.join(' ')}` : ''}>`;
}

/**
 * Keep the allowlisted formatting, escape everything else.
 *
 * Newlines are NOT converted to `<br>` here, unlike the plain-text path: an
 * HTML signature states its own line breaks, and a pasted one is usually
 * pretty-printed across several source lines that would otherwise each become a
 * blank line in the delivered mail.
 */
export function sanitizeSignatureHtml(signature: string): string {
  let out = '';
  let cursor = 0;

  for (const match of signature.matchAll(signatureTagPattern('gi'))) {
    const [whole, closing, name, rest] = match;
    out += escapeTextKeepingEntities(signature.slice(cursor, match.index));
    out += SIGNATURE_TAGS.has(name.toLowerCase()) ? rebuildTag(closing, name, rest) : escapeHtml(whole);
    cursor = match.index + whole.length;
  }

  return out + escapeTextKeepingEntities(signature.slice(cursor));
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
