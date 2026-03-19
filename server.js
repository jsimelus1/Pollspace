// PollSpace - server.js
// Render PostgreSQL + Web Service
// Frontend: GitHub Pages or Netlify

const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3001;

// -----------------------------------------------------------------
// CORS - set manually on every response so no browser can block it.
// The cors npm package has edge cases with some CDN/proxy setups.
// This approach works universally with GitHub Pages + Render.
// -----------------------------------------------------------------
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  res.setHeader('Access-Control-Max-Age', '86400'); // cache preflight 24h

  // Respond immediately to OPTIONS preflight — do not pass to routes
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json());

// -----------------------------------------------------------------
// DATABASE
// -----------------------------------------------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

// -----------------------------------------------------------------
// AUTO SCHEMA
// -----------------------------------------------------------------
async function initSchema() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS polls (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        question    TEXT NOT NULL,
        description TEXT DEFAULT '',
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS poll_options (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        poll_id     UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
        option_text TEXT NOT NULL
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS poll_votes (
        id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        poll_id   UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
        option_id UUID NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
        voter_ip  TEXT,
        voted_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('Database schema ready');
  } catch (err) {
    console.error('Schema init failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// -----------------------------------------------------------------
// HELPER
// -----------------------------------------------------------------
async function queryPollById(id) {
  const { rows } = await pool.query(`
    SELECT
      p.id,
      p.question,
      p.description,
      p.created_at,
      COALESCE(
        json_agg(
          json_build_object(
            'id',          po.id,
            'option_text', po.option_text,
            'vote_count',  COUNT(pv.id)
          ) ORDER BY po.id
        ) FILTER (WHERE po.id IS NOT NULL),
        '[]'::json
      ) AS options
    FROM polls p
    LEFT JOIN poll_options po ON po.poll_id = p.id
    LEFT JOIN poll_votes   pv ON pv.option_id = po.id
    WHERE p.id = $1
    GROUP BY p.id
  `, [id]);
  return rows[0] || null;
}

// -----------------------------------------------------------------
// ROUTES
// -----------------------------------------------------------------

// Root - confirms service is up when you open the Render URL
app.get('/', (req, res) => {
  res.json({
    name: 'PollSpace API',
    status: 'running',
    health: '/api/health',
    polls: '/api/polls',
  });
});

// Health check - ping from UptimeRobot every 5 min to prevent sleep
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (e) {
    res.status(503).json({ status: 'error', message: e.message });
  }
});

// GET /api/polls
app.get('/api/polls', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        p.id,
        p.question,
        p.description,
        p.created_at,
        COALESCE(
          json_agg(
            json_build_object(
              'id',          po.id,
              'option_text', po.option_text,
              'vote_count',  COUNT(pv.id)
            ) ORDER BY po.id
          ) FILTER (WHERE po.id IS NOT NULL),
          '[]'::json
        ) AS options
      FROM polls p
      LEFT JOIN poll_options po ON po.poll_id = p.id
      LEFT JOIN poll_votes   pv ON pv.option_id = po.id
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `);
    res.json(rows);
  } catch (e) {
    console.error('GET /polls:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/polls/:id
app.get('/api/polls/:id', async (req, res) => {
  try {
    const poll = await queryPollById(req.params.id);
    if (!poll) return res.status(404).json({ error: 'Poll not found' });
    res.json(poll);
  } catch (e) {
    console.error('GET /polls/:id:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/polls
app.post('/api/polls', async (req, res) => {
  const { question, description = '', options } = req.body;

  if (!question || !question.trim())
    return res.status(400).json({ error: 'Question is required' });
  if (!Array.isArray(options) || options.length < 2)
    return res.status(400).json({ error: 'At least 2 options are required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [poll] } = await client.query(
      `INSERT INTO polls (question, description)
       VALUES ($1, $2)
       RETURNING id, question, description, created_at`,
      [question.trim(), description.trim()]
    );

    const insertedOptions = [];
    for (const text of options) {
      const { rows: [opt] } = await client.query(
        `INSERT INTO poll_options (poll_id, option_text)
         VALUES ($1, $2)
         RETURNING id, option_text`,
        [poll.id, text.trim()]
      );
      insertedOptions.push({ ...opt, vote_count: 0 });
    }

    await client.query('COMMIT');
    res.status(201).json({ ...poll, options: insertedOptions });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('POST /polls:', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// POST /api/polls/:id/vote
app.post('/api/polls/:id/vote', async (req, res) => {
  const { option_id } = req.body;
  const voter_ip = (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress ||
    'unknown'
  );

  if (!option_id)
    return res.status(400).json({ error: 'option_id is required' });

  try {
    const dup = await pool.query(
      `SELECT id FROM poll_votes WHERE poll_id = $1 AND voter_ip = $2`,
      [req.params.id, voter_ip]
    );
    if (dup.rows.length)
      return res.status(409).json({ error: 'You have already voted on this poll' });

    await pool.query(
      `INSERT INTO poll_votes (poll_id, option_id, voter_ip) VALUES ($1, $2, $3)`,
      [req.params.id, option_id, voter_ip]
    );

    res.json({ success: true });
  } catch (e) {
    console.error('POST /vote:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/polls/:id
app.delete('/api/polls/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM polls WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (!result.rows.length)
      return res.status(404).json({ error: 'Poll not found' });
    res.json({ success: true, deleted: req.params.id });
  } catch (e) {
    console.error('DELETE /polls:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// -----------------------------------------------------------------
// START
// -----------------------------------------------------------------
initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log('PollSpace running on port ' + PORT);
    });
  })
  .catch(err => {
    console.error('Startup failed:', err.message);
    process.exit(1);
  });
