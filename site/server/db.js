import pg from 'pg';

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

// Idempotent — safe to call on every boot.
export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscribers (
      id         SERIAL PRIMARY KEY,
      email      TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

export { pool };
