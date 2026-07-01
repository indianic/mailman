import nodemailer from 'nodemailer';
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

export async function sendViaAppPassword(
  credentials: AppPasswordCredentials,
  message: OutboundMessage,
): Promise<{ messageId: string }> {
  const transport = createAppPasswordTransport(credentials);
  const info = await transport.sendMail({
    from: credentials.user,
    to: message.to.join(', '),
    cc: message.cc?.join(', '),
    bcc: message.bcc?.join(', '),
    subject: message.subject,
    text: message.bodyType === 'html' ? undefined : message.body,
    html: message.bodyType === 'html' ? message.body : undefined,
    attachments: message.attachments?.map((a) => ({
      filename: a.name,
      path: a.path,
      contentType: a.mimeType,
    })),
  });
  return { messageId: info.messageId };
}
