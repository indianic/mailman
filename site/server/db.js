import pg from 'pg';
import { SEED } from './seed-content.js';

// Local Postgres — user "kalpesh", empty password. An empty PGPASSWORD is
// intentional; pg treats "" as "no password", which is what a trust/peer
// local setup expects.
const pool = new pg.Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'kalpesh',
  password: process.env.PGPASSWORD || '',
  database: process.env.PGDATABASE || 'mailman_site',
  max: 5,
});

// Idempotent — safe to call on every boot. Creates the schema and seeds the
// default welcome-email template if it isn't there yet.
export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscribers (
      id          SERIAL PRIMARY KEY,
      email       TEXT UNIQUE NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      welcomed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS email_templates (
      id         SERIAL PRIMARY KEY,
      name       TEXT UNIQUE NOT NULL,
      subject    TEXT NOT NULL,
      body_html  TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Editable site content: one row per section, value as JSON.
    CREATE TABLE IF NOT EXISTS site_content (
      key        TEXT PRIMARY KEY,
      data       JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Seed each content section if it isn't there yet (won't clobber later edits).
  for (const [key, data] of Object.entries(SEED)) {
    await pool.query(
      `INSERT INTO site_content (key, data) VALUES ($1, $2)
       ON CONFLICT (key) DO NOTHING`,
      [key, JSON.stringify(data)],
    );
  }

  // Back-fill the column on pre-existing subscribers tables.
  await pool.query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS welcomed_at TIMESTAMPTZ;`);

  // Seed the subscriber email templates (editable later straight in the DB).
  // ON CONFLICT DO NOTHING keeps any hand-edits; bump the name or edit the row
  // to change what goes out.
  const emailTemplates = [
    ['welcome', 'Welcome to {{brand}} 👋', WELCOME_HTML],
    ['newsletter', '{{title}}', NEWSLETTER_HTML],
  ];
  for (const [name, subject, body] of emailTemplates) {
    // Upsert: these subscriber templates are code-owned, so a deploy/restart
    // refreshes them. (site_content stays DO NOTHING — that's user-editable.)
    await pool.query(
      `INSERT INTO email_templates (name, subject, body_html)
       VALUES ($1, $2, $3)
       ON CONFLICT (name) DO UPDATE
         SET subject = EXCLUDED.subject, body_html = EXCLUDED.body_html, updated_at = now()`,
      [name, subject, body],
    );
  }
}

// Email-safe shell: table/inline styles (Gmail/Outlook strip <style> and SVG),
// ~600px column, gradient header with a white "AI" badge (the brand mark).
// Placeholders {{brand}}, {{email}}, {{year}}, {{title}}, {{content}} are
// substituted at send time.
function emailShell(bodyHtml) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <div style="max-width:600px;margin:0 auto;padding:28px 16px;">
      <div style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
        <div style="background:linear-gradient(135deg,#6366f1,#d946ef);padding:22px 28px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="padding-right:12px;">
              <div style="width:36px;height:36px;background:#ffffff;border-radius:9px;text-align:center;font-weight:800;color:#4f46e5;font-size:15px;line-height:36px;">AI</div>
            </td>
            <td style="font-size:20px;font-weight:800;color:#ffffff;letter-spacing:-0.2px;">{{brand}}</td>
          </tr></table>
        </div>
        <div style="padding:30px 28px;line-height:1.6;color:#334155;font-size:15px;">
          ${bodyHtml}
        </div>
      </div>
      <p style="text-align:center;font-size:12px;color:#94a3b8;margin:16px 0 0;">
        © {{year}} IndiaNIC · {{brand}} · <a href="https://npm.indianic.in/#/packages" style="color:#94a3b8;">npm.indianic.in</a>
      </p>
    </div>
  </body>
</html>`;
}

// Sent to a new footer subscriber on subscribe.
const WELCOME_HTML = emailShell(`
  <h1 style="margin:0 0 12px;font-size:22px;color:#0f172a;">You're on the list 🎉</h1>
  <p style="margin:0 0 14px;">
    Thanks for subscribing to <strong>{{brand}}</strong> updates. Short, occasional,
    and never spam — just release notes and product news.
  </p>
  <p style="margin:0 0 18px;">
    {{brand}} lets you send and read email just by asking your AI assistant, with a
    draft → preview → confirm safety flow so nothing sends without your OK. It plugs
    into Claude, Cursor, Gemini, OpenAI and more — on macOS, Linux and Windows.
  </p>
  <a href="https://mailman.indianic.dev"
     style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:9999px;">
    Explore {{brand}} →
  </a>
  <p style="margin:22px 0 0;font-size:13px;color:#94a3b8;">
    You're receiving this because {{email}} subscribed at the {{brand}} site.
  </p>
`);

// Reusable branded newsletter/broadcast shell. Pass {{title}} + {{content}}
// (HTML) via sendTemplate('newsletter', email, { title, content }).
const NEWSLETTER_HTML = emailShell(`
  <h1 style="margin:0 0 12px;font-size:22px;color:#0f172a;">{{title}}</h1>
  {{content}}
  <p style="margin:22px 0 0;font-size:13px;color:#94a3b8;">
    You're receiving this because {{email}} subscribed to {{brand}} updates.
  </p>
`);

export { pool };
