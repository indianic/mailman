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

const NAMED_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  copy: '©',
  reg: '®',
  trade: '™',
  middot: '·',
  bull: '•',
};

function fromCodePoint(code: number): string {
  // A malformed entity should surface as nothing rather than throw mid-send.
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

function decodeEntities(text: string): string {
  return (
    text
      .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_m, dec: string) => fromCodePoint(parseInt(dec, 10)))
      .replace(/&([a-z]+);/gi, (whole, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? whole)
      // Last, always: decoding it earlier would turn "&amp;lt;" into "<" rather
      // than into the literal "&lt;" the author wrote.
      .replace(/&amp;/g, '&')
  );
}

/**
 * A readable `text/plain` rendering of an HTML body.
 *
 * Not cosmetic. mailman used to send HTML with no plain-text alternative at
 * all, and it showed the first time a real person replied: the signature came
 * back quoted as "Thanks & RegardsKalpesh Gamit" and "IndiaNIC Infotech
 * Ltd.Mobile: +91…", because the receiving client had to invent its own
 * conversion and dropped the `<br>`s inside the `<i>` tags. Anything that reads
 * text rather than markup hits the same problem — reply quoting, notification
 * previews, screen readers, watches — and a missing text part also reads as a
 * mild spam signal, which matters more for a 39-recipient campaign than for one
 * message to a colleague.
 *
 * Deliberately a small, predictable transform rather than a parser: mailman
 * composes the HTML it sends, so this only ever has to handle its own output
 * plus whatever a caller passed as a body.
 */
export function htmlToPlainText(html: string): string {
  let text = html;

  // Non-content elements go entirely, contents included — otherwise CSS from
  // the polished shell would be pasted into the readable text.
  text = text.replace(/<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1>/gi, '');

  // Source formatting is not content. A body written as
  //
  //     <ul>
  //       <li>one</li>
  //       <li>two</li>
  //     </ul>
  //
  // carries a real newline plus indentation between every tag, and those
  // newlines used to survive into the text part — putting a blank line between
  // each bullet, which HTML itself would never render. Collapsed to a single
  // space rather than removed outright, because between INLINE tags
  // (`<b>a</b>\n<i>b</i>`) that whitespace is a real word gap; the block
  // handling below re-inserts the breaks that belong, and the per-line trim at
  // the end drops the leftover space.
  text = text.replace(/>[^\S\n]*\n\s*</g, '> <');

  // A text reader cannot click an anchor, so the URL has to survive as text.
  text = text.replace(
    /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, _q, href: string, label: string) => {
      const clean = label.replace(/<[^>]+>/g, '').trim();
      if (!clean) return href;
      return clean === href ? href : `${clean} (${href})`;
    },
  );

  // Images carry nothing but their alt text.
  text = text.replace(/<img\b[^>]*\balt\s*=\s*(["'])(.*?)\1[^>]*>/gi, '$2');
  text = text.replace(/<img\b[^>]*>/gi, '');

  // Structure, before the tags themselves disappear.
  //
  // A block boundary is a blank line and `<br>` is a single break, which is how
  // the two differ in HTML and how a reader expects them to differ in text.
  // `</li>` is deliberately NOT a block close: `<li>` already opened with a
  // break, and closing with another would put a blank line between every bullet.
  text = text.replace(/<li\b[^>]*>/gi, '\n- ');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<hr\s*\/?>/gi, '\n---\n');
  // A block element BEGINNING also ends the line before it. Only closing tags
  // used to break, so inline content butted straight up against a following
  // block — a signature rendered "AI SOLUTION ARCHITECT☎ +91 …" the moment a
  // contact table followed the role span. `td`/`th` are excluded: their closing
  // tag already breaks, and adding the open would blank-line every cell.
  text = text.replace(/<(table|div|p|tr|ul|ol|blockquote|h[1-6])\b[^>]*>/gi, '\n\n');

  // A table cell is a block: without this, a two-column layout collapses its
  // columns into one run — "Kalpesh GamitAI SOLUTION ARCHITECT". A single
  // break rather than a blank line, since cells in a row are usually one idea.
  text = text.replace(/<\/(td|th)\s*>/gi, '\n');
  text = text.replace(/<\/(p|div|tr|ul|ol|table|blockquote|h[1-6])\s*>/gi, '\n\n');
  text = text.replace(/<[^>]+>/g, '');

  text = decodeEntities(text);

  // Whitespace last: collapse runs of spaces, trim each line, and cap blank
  // runs at one so the polished shell's nesting doesn't leave a gulf of them.
  text = text
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  return text.trim();
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
 *    `<name@example.com>` disappeared entirely — the browser read it as an
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
 * tests: `<name@example.com>` is not a tag and still cannot vanish, a bare
 * `&` is still an ampersand rather than a broken entity, and nothing in a
 * signature can close the polished card or run a script.
 *
 * `signatureType` is the account's stored declaration (see
 * update_account_profile). When present it wins over detection — a signature
 * that IS markup but happens to contain no allowlisted tag, or plain text that
 * mentions `<table>` in prose, can only be told apart by the person who saved
 * it. Detection remains the fallback for profiles saved before the field
 * existed.
 */
export type SignatureType = 'text' | 'html';

export function resolveSignatureType(signature: string, declared?: SignatureType): SignatureType {
  return declared ?? (looksLikeHtmlSignature(signature) ? 'html' : 'text');
}

export function appendSignature(
  body: string,
  signature: string | undefined,
  bodyType: 'text' | 'html',
  signatureType?: SignatureType,
): string {
  if (!signature) return body;
  const sigType = resolveSignatureType(signature, signatureType);

  if (bodyType === 'text') {
    // An HTML signature pasted into a text/plain email used to go out as raw
    // markup — `<hr style=…><table cellpadding=…>` in front of the recipient.
    // A text send gets the same readable rendering the alternative part of an
    // HTML send gets, and the preview warns so the caller can upgrade to html.
    const asText = sigType === 'html' ? htmlToPlainText(signature) : signature;
    return asText ? `${body}\n\n${asText}` : body;
  }

  if (sigType === 'html') {
    return `${body}<br><br>${sanitizeSignatureHtml(signature)}`;
  }

  return `${body}<br><br>${textSignatureAsHtml(signature)}`;
}

/** Normalise CRLF/CR first so a signature typed on Windows breaks identically. */
function textSignatureAsHtml(signature: string): string {
  return escapeHtml(signature.replace(/\r\n?/g, '\n')).replace(/\n/g, '<br>');
}

/**
 * Both renderings of a signature, exactly as appendSignature would emit them —
 * update_account_profile returns this so a signature can be verified at save
 * time instead of in a recipient's inbox.
 */
export function renderSignaturePreview(
  signature: string,
  declared?: SignatureType,
): { signatureType: SignatureType; renderedHtml: string; renderedText: string } {
  const signatureType = resolveSignatureType(signature, declared);
  return {
    signatureType,
    renderedHtml: signatureType === 'html' ? sanitizeSignatureHtml(signature) : textSignatureAsHtml(signature),
    renderedText: signatureType === 'html' ? htmlToPlainText(signature) : signature,
  };
}

/**
 * What a real email signature is allowed to contain.
 *
 * Layout tags were originally excluded outright, because an unbalanced
 * `</div>` closes the polished card early and swallows the footer, and a
 * signature is the one piece of an email nobody re-reads after setting it once.
 * The reasoning was sound; the conclusion was too strict. A photo beside text
 * is a two-column layout, and in email that means a table — the only construct
 * Outlook lays out reliably.
 *
 * They are allowed now, and the original risk is closed properly rather than
 * avoided: sanitizeSignatureHtml tracks open tags and emits a balanced tree. A
 * stray close with no matching open is dropped, and anything still open at the
 * end is closed. Nothing in a signature can reach past its own boundary,
 * whatever is stored.
 */
const SIGNATURE_TAGS = new Set([
  'br', 'b', 'strong', 'i', 'em', 'u', 's', 'small', 'sub', 'sup', 'span', 'a', 'hr', 'font', 'img',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'div', 'p',
]);

const SIGNATURE_ATTRS = new Set([
  'href', 'src', 'alt', 'title', 'width', 'height', 'style', 'color', 'size', 'face', 'target',
  'align', 'valign', 'cellpadding', 'cellspacing', 'border', 'bgcolor', 'colspan', 'rowspan',
]);

const VOID_TAGS = new Set(['br', 'hr', 'img']);

/** Content-ID an inline signature photo is referenced by — `<img src="cid:…">`. */
export const SIGNATURE_IMAGE_CID = 'mailman-signature';

/**
 * The inline-image list for a send, given the account and the composed body.
 *
 * Attached only when the body actually references the cid. A signature photo
 * configured but not used — a text send, or a signature edited to drop the
 * `<img>` — must not ride along as a mystery attachment on every email.
 */
export function signatureInlineImages(
  account: { signatureImage?: string },
  body: string,
  bodyType: 'text' | 'html',
): Array<{ cid: string; path: string }> | undefined {
  if (!account.signatureImage) return undefined;
  if (bodyType !== 'html') return undefined;
  if (!body.includes(`cid:${SIGNATURE_IMAGE_CID}`)) return undefined;
  return [{ cid: SIGNATURE_IMAGE_CID, path: account.signatureImage }];
}

/**
 * A tag from the allowlist, matched strictly enough that `<name@example.com>`
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
  // Open, unclosed elements, innermost last. This is what makes layout tags
  // safe to allow: the output is balanced no matter what the input does.
  const open: string[] = [];

  for (const match of signature.matchAll(signatureTagPattern('gi'))) {
    const [whole, closing, name, rest] = match;
    const tag = name.toLowerCase();
    out += escapeTextKeepingEntities(signature.slice(cursor, match.index));
    cursor = match.index + whole.length;

    if (!SIGNATURE_TAGS.has(tag)) {
      out += escapeHtml(whole);
      continue;
    }

    if (VOID_TAGS.has(tag)) {
      out += rebuildTag(closing, name, rest);
      continue;
    }

    if (closing) {
      // A close with no matching open is dropped outright. Escaping it would
      // be honest but ugly; emitting it is the bug this exists to prevent.
      const depth = open.lastIndexOf(tag);
      if (depth === -1) continue;
      // Close everything it implicitly ends, innermost first — `<b><i></b>`
      // must not leave `<i>` dangling into the rest of the email.
      while (open.length > depth) out += `</${open.pop()}>`;
      continue;
    }

    // A self-closed non-void element (`<div/>`) opens nothing.
    if (/^\s*\/>/.test(rest)) {
      out += rebuildTag('', name, rest);
      out += `</${tag}>`;
      continue;
    }

    open.push(tag);
    out += rebuildTag('', name, rest);
  }

  out += escapeTextKeepingEntities(signature.slice(cursor));
  while (open.length > 0) out += `</${open.pop()}>`;
  return out;
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
