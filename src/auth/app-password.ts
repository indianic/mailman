import nodemailer from 'nodemailer';
import { formatFromAddress, buildMessageId, mailmanHeaders, htmlToPlainText } from '../mail/compose.js';
import type { OutboundMessage } from '../mail/provider.js';

export interface AppPasswordCredentials {
  user: string;
  pass: string;
}

/**
 * Just the send-side transport for now. Phase 7's ImapSmtpProvider wraps
 * this same transport-creation logic into the full MailProvider (adding
 * list/search/read via IMAP under the same app password).
 */
export function createAppPasswordTransport(credentials: AppPasswordCredentials) {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: credentials.user, pass: credentials.pass },
  });
}

/** Pure — the exact options object handed to nodemailer, independently testable against a fake transport. */
export function buildMailOptions(credentials: AppPasswordCredentials, message: OutboundMessage) {
  return {
    from: formatFromAddress(credentials.user, message.fromDisplayName),
    to: message.to.join(', '),
    cc: message.cc?.join(', '),
    bcc: message.bcc?.join(', '),
    subject: message.subject,
    // Both parts for an HTML send, so the message goes out as
    // multipart/alternative rather than HTML-only. Anything that reads text
    // instead of markup — reply quoting, notification previews, screen readers
    // — otherwise has to invent its own conversion, and Gmail's drops the
    // `<br>`s inside the signature's `<i>` tags. `|| undefined` because an
    // empty part is worse than no part.
    text: message.bodyType === 'html' ? htmlToPlainText(message.body) || undefined : message.body,
    html: message.bodyType === 'html' ? message.body : undefined,
    // Brand the Message-ID (local part `mcp-mailman.*`) + X-Mailer header so
    // mailman's sends are identifiable in an inbox / by a filter.
    messageId: buildMessageId(credentials.user),
    // nodemailer emits In-Reply-To/References verbatim from these. `references`
    // takes an array and is joined with spaces per RFC 5322.
    inReplyTo: message.inReplyTo,
    references: message.references,
    headers: mailmanHeaders(),
    attachments: message.attachments?.map((a) => ({
      filename: a.name,
      path: a.path,
      contentType: a.mimeType,
    })),
  };
}

export async function sendViaAppPassword(
  credentials: AppPasswordCredentials,
  message: OutboundMessage,
): Promise<{ messageId: string }> {
  const transport = createAppPasswordTransport(credentials);
  const info = await transport.sendMail(buildMailOptions(credentials, message));
  return { messageId: info.messageId };
}
