// PollSpace - server.js
// Serves frontend from /public and API from /api
// Features: poll deadlines, concluded poll detection, AI insights via Claude

const express = require('express');
const { Pool } = require('pg');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── Database ──────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

// ── Schema init ───────────────────────────────────────────────
async function initSchema() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS polls (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        question    TEXT NOT NULL,
        description TEXT DEFAULT '',
        end_date    TIMESTAMPTZ,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('polls table ready');

    // Add end_date column if upgrading from older schema
    await client.query(`
      ALTER TABLE polls ADD COLUMN IF NOT EXISTS end_date TIMESTAMPTZ
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS poll_options (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        poll_id     UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
        option_text TEXT NOT NULL
      )
    `);
    console.log('poll_options table ready');

    await client.query(`
      CREATE TABLE IF NOT EXISTS poll_votes (
        id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        poll_id   UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
        option_id UUID NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
        voter_ip  TEXT,
        voted_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('poll_votes table ready');

    // Cache AI insights to avoid regenerating on every dashboard load
    await client.query(`
      CREATE TABLE IF NOT EXISTS poll_insights (
        poll_id     UUID PRIMARY KEY REFERENCES polls(id) ON DELETE CASCADE,
        insights    TEXT NOT NULL,
        generated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('poll_insights table ready');

  } catch (err) {
    console.error('Schema init error:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// ── Helper: build full poll object ────────────────────────────
async function buildPoll(pollRow) {
  const { rows: options } = await pool.query(
    `SELECT
       po.id,
       po.option_text,
       COUNT(pv.id)::int AS vote_count
     FROM poll_options po
     LEFT JOIN poll_votes pv ON pv.option_id = po.id
     WHERE po.poll_id = $1
     GROUP BY po.id
     ORDER BY po.id`,
    [pollRow.id]
  );
  const total_votes = options.reduce((s, o) => s + o.vote_count, 0);
  const is_concluded = pollRow.end_date
    ? new Date(pollRow.end_date) < new Date()
    : false;
  return {
    id:           pollRow.id,
    question:     pollRow.question,
    description:  pollRow.description,
    end_date:     pollRow.end_date,
    created_at:   pollRow.created_at,
    is_concluded,
    total_votes,
    options,
  };
}

// ── Helper: generate AI insights via Claude API ───────────────
async function generateInsights(poll) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const optionsSummary = poll.options
    .sort((a, b) => b.vote_count - a.vote_count)
    .map((o, i) => {
      const pct = poll.total_votes > 0
        ? ((o.vote_count / poll.total_votes) * 100).toFixed(1)
        : '0.0';
      return `${i + 1}. "${o.option_text}" — ${o.vote_count} votes (${pct}%)`;
    })
    .join('\n');

  const prompt = `You are a data analyst presenting poll results to stakeholders.

Poll question: "${poll.question}"
${poll.description ? `Context: ${poll.description}` : ''}
Total votes: ${poll.total_votes}
Poll ran from: ${new Date(poll.created_at).toDateString()} to ${new Date(poll.end_date).toDateString()}

Results:
${optionsSummary}

Please provide a structured analysis with the following sections:
1. **Key Finding** - One sentence summary of the most important result
2. **Insights** - 3 bullet points interpreting what the data means
3. **Recommendations** - 3 actionable recommendations for stakeholders based on these results
4. **Watch Out For** - One potential caveat or limitation of this data

Keep the tone professional and concise. Focus on actionable insights.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Claude API error: ' + response.status);
  }

  const data = await response.json();
  return data.content[0].text;
}

// ── Routes ────────────────────────────────────────────────────

// Health check
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (e) {
    res.status(503).json({ status: 'error', message: e.message });
  }
});

// GET /api/polls — active polls only (not yet concluded)
app.get('/api/polls', async (req, res) => {
  try {
    const { rows: pollRows } = await pool.query(
      `SELECT id, question, description, end_date, created_at
       FROM polls
       WHERE end_date IS NULL OR end_date > NOW()
       ORDER BY created_at DESC`
    );
    const polls = await Promise.all(pollRows.map(buildPoll));
    res.json(polls);
  } catch (e) {
    console.error('GET /api/polls error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/polls/concluded — polls past their end_date
app.get('/api/polls/concluded', async (req, res) => {
  try {
    const { rows: pollRows } = await pool.query(
      `SELECT id, question, description, end_date, created_at
       FROM polls
       WHERE end_date IS NOT NULL AND end_date <= NOW()
       ORDER BY end_date DESC`
    );
    const polls = await Promise.all(pollRows.map(buildPoll));
    res.json(polls);
  } catch (e) {
    console.error('GET /api/polls/concluded error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/polls/:id
app.get('/api/polls/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, question, description, end_date, created_at
       FROM polls WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Poll not found' });
    const poll = await buildPoll(rows[0]);
    res.json(poll);
  } catch (e) {
    console.error('GET /api/polls/:id error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/polls — now accepts end_date
app.post('/api/polls', async (req, res) => {
  const { question, description = '', options, end_date } = req.body;

  if (!question || !question.trim())
    return res.status(400).json({ error: 'Question is required' });
  if (!Array.isArray(options) || options.length < 2)
    return res.status(400).json({ error: 'At least 2 options are required' });
  if (!end_date)
    return res.status(400).json({ error: 'End date is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [poll] } = await client.query(
      `INSERT INTO polls (question, description, end_date)
       VALUES ($1, $2, $3)
       RETURNING id, question, description, end_date, created_at`,
      [question.trim(), description.trim(), new Date(end_date)]
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
    res.status(201).json({ ...poll, options: insertedOptions, total_votes: 0, is_concluded: false });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('POST /api/polls error:', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// POST /api/polls/:id/vote — blocked if poll is concluded
app.post('/api/polls/:id/vote', async (req, res) => {
  const { option_id } = req.body;
  const voter_ip = (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress || 'unknown'
  );

  if (!option_id)
    return res.status(400).json({ error: 'option_id is required' });

  try {
    // Check if poll is still active
    const { rows } = await pool.query(
      `SELECT end_date FROM polls WHERE id = $1`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Poll not found' });
    if (rows[0].end_date && new Date(rows[0].end_date) < new Date())
      return res.status(403).json({ error: 'This poll has concluded and is no longer accepting votes' });

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
    console.error('POST /api/vote error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/polls/:id/insights — returns cached or freshly generated AI insights
app.get('/api/polls/:id/insights', async (req, res) => {
  try {
    // Only generate insights for concluded polls
    const { rows: pollRows } = await pool.query(
      `SELECT id, question, description, end_date, created_at
       FROM polls WHERE id = $1`, [req.params.id]
    );
    if (!pollRows.length) return res.status(404).json({ error: 'Poll not found' });

    const poll = await buildPoll(pollRows[0]);
    if (!poll.is_concluded)
      return res.status(400).json({ error: 'Insights are only available for concluded polls' });

    // Return cached insights if available
    const { rows: cached } = await pool.query(
      `SELECT insights, generated_at FROM poll_insights WHERE poll_id = $1`,
      [req.params.id]
    );
    if (cached.length) {
      return res.json({ insights: cached[0].insights, cached: true, generated_at: cached[0].generated_at });
    }

    // Generate fresh insights via Claude
    const insights = await generateInsights(poll);

    // Cache them
    await pool.query(
      `INSERT INTO poll_insights (poll_id, insights) VALUES ($1, $2)
       ON CONFLICT (poll_id) DO UPDATE SET insights = $2, generated_at = NOW()`,
      [req.params.id, insights]
    );

    res.json({ insights, cached: false, generated_at: new Date() });
  } catch (e) {
    console.error('GET /api/polls/:id/insights error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/polls/:id
app.delete('/api/polls/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM polls WHERE id = $1 RETURNING id`, [req.params.id]
    );
    if (!result.rows.length)
      return res.status(404).json({ error: 'Poll not found' });
    res.json({ success: true, deleted: req.params.id });
  } catch (e) {
    console.error('DELETE /api/polls error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Catch-all: serve index.html for any non-API route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────
initSchema()
  .then(() => {
    app.listen(PORT, () => console.log('PollSpace running on port ' + PORT));
  })
  .catch(err => {
    console.error('Startup failed:', err.message);
    process.exit(1);
  });
