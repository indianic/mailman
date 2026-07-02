import sgMail from '@sendgrid/mail';
import { pool } from './db.js';

const BRAND = process.env.BRAND || 'MailMan';
const FROM = process.env.SENDGRID_FROM || `${BRAND} <no-reply@indianic.com>`;
const API_KEY = process.env.SENDGRID_API_KEY || '';

// If a key is present we send for real via SendGrid; otherwise we run in
// "dry-run" mode — the subscribe/lead flow still works and is fully testable
// locally, it just logs the rendered email instead of sending it.
const live = Boolean(API_KEY);
if (live) sgMail.setApiKey(API_KEY);

export const mailerMode = live ? 'sendgrid' : 'dry-run';

function render(str, vars) {
  return str.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? String(vars[k]) : ''));
}

// Look up a template by name, fill placeholders, and email it to `email`.
// Best-effort: never throws — returns a small status object instead, so a
// mail failure can't break the subscribe/lead request.
export async function sendTemplate(name, email, extraVars = {}) {
  try {
    const { rows } = await pool.query(
      'SELECT subject, body_html FROM email_templates WHERE name = $1',
      [name],
    );
    if (!rows.length) return { sent: false, reason: `template "${name}" not found` };

    const vars = { brand: BRAND, email, year: new Date().getFullYear(), ...extraVars };
    const subject = render(rows[0].subject, vars);
    const html = render(rows[0].body_html, vars);

    if (!live) {
      console.log(`[mailer:dry-run] would send "${subject}" to ${email} (set SENDGRID_API_KEY to send)`);
      return { sent: true, mode: 'dry-run', subject };
    }

    const [resp] = await sgMail.send({ to: email, from: FROM, subject, html });
    return {
      sent: true,
      mode: 'sendgrid',
      status: resp?.statusCode,
      messageId: resp?.headers?.['x-message-id'],
      subject,
    };
  } catch (err) {
    // SendGrid returns rich error bodies — surface them for debugging.
    const detail = err?.response?.body?.errors?.map((e) => e.message).join('; ') || err.message;
    console.error(`sendTemplate("${name}") failed:`, detail);
    return { sent: false, reason: detail };
  }
}
