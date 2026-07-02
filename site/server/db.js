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

  // Seed the welcome template (editable later straight in the DB).
  await pool.query(
    `INSERT INTO email_templates (name, subject, body_html)
     VALUES ('welcome', $1, $2)
     ON CONFLICT (name) DO NOTHING`,
    [
      'Welcome to {{brand}} 👋',
      WELCOME_HTML,
    ],
  );
}

// Placeholders {{brand}}, {{email}}, {{year}} are substituted at send time.
const WELCOME_HTML = `<!doctype html>
<html>
  <body style="margin:0;background:#f1f5f9;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;">
    <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
      <div style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
        <div style="background:linear-gradient(135deg,#6366f1,#d946ef);padding:28px 32px;">
          <div style="font-size:20px;font-weight:800;color:#ffffff;">✉️ {{brand}}</div>
        </div>
        <div style="padding:32px;">
          <h1 style="margin:0 0 12px;font-size:22px;">You're on the list 🎉</h1>
          <p style="margin:0 0 16px;line-height:1.6;color:#334155;">
            Thanks for subscribing to <strong>{{brand}}</strong> updates. We'll send you
            release notes and product news — short, occasional, and never spam.
          </p>
          <p style="margin:0 0 24px;line-height:1.6;color:#334155;">
            {{brand}} lets you send and read email just by asking your AI assistant —
            with a preview-and-confirm safety flow so nothing sends without your OK.
          </p>
          <a href="https://npm.indianic.in/#/packages"
             style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:9999px;">
            Explore {{brand}} →
          </a>
          <p style="margin:24px 0 0;font-size:13px;color:#94a3b8;">
            You're receiving this because {{email}} subscribed at the {{brand}} site.
          </p>
        </div>
      </div>
      <p style="text-align:center;font-size:12px;color:#94a3b8;margin-top:16px;">
        © {{year}} IndiaNIC · {{brand}}
      </p>
    </div>
  </body>
</html>`;

export { pool };
