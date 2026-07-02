import nodemailer from 'nodemailer';
import { formatFromAddress, buildMessageId, mailmanHeaders } from '../mail/compose.js';
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
    text: message.bodyType === 'html' ? undefined : message.body,
    html: message.bodyType === 'html' ? message.body : undefined,
    // Brand the Message-ID (local part `mcp-mailman.*`) + X-Mailer header so
    // mailman's sends are identifiable in an inbox / by a filter.
    messageId: buildMessageId(credentials.user),
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
