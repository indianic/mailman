import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, initDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const HOST = process.env.HOST || 'localhost';
const PORT = Number(process.env.PORT || 4000);

app.use(cors());
app.use(express.json());

// Basic email shape check — good enough for a newsletter box.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// --- API ---------------------------------------------------------------
app.post('/api/subscribe', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
  }
  try {
    const { rowCount } = await pool.query(
      `INSERT INTO subscribers (email) VALUES ($1)
       ON CONFLICT (email) DO NOTHING`,
      [email],
    );
    return res.json({
      ok: true,
      alreadySubscribed: rowCount === 0,
      message: rowCount === 0 ? "You're already on the list." : 'Thanks — you\'re subscribed!',
    });
  } catch (err) {
    console.error('subscribe failed:', err.message);
    return res.status(500).json({ ok: false, error: 'Something went wrong. Try again shortly.' });
  }
});

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'up' });
  } catch {
    res.status(503).json({ ok: false, db: 'down' });
  }
});

// --- Static client (production build) ----------------------------------
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
// SPA fallback — anything not an /api route serves index.html.
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) res.status(404).send('Client build not found. Run `npm run build` in site/client.');
  });
});

initDb()
  .then(() => {
    app.listen(PORT, HOST, () => console.log(`mailman-site server on http://${HOST}:${PORT}`));
  })
  .catch((err) => {
    console.error('DB init failed:', err.message);
    process.exit(1);
  });
