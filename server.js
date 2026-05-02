// Pollytics - server.js
// Supports: Polls (single question) + Surveys (multiple questions)

const express  = require('express');
const { Pool } = require('pg');
const path     = require('path');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');

const app  = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'pollytics-dev-secret-change-in-production';

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── Database ──────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

// ── Schema ────────────────────────────────────────────────────
async function initSchema() {
  const client = await pool.connect();
  try {

    // Admins
    await client.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name       TEXT NOT NULL,
        email      TEXT NOT NULL UNIQUE,
        password   TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Polls (single-question)
    await client.query(`
      CREATE TABLE IF NOT EXISTS polls (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        question    TEXT NOT NULL,
        image_url   TEXT DEFAULT '',
        description TEXT DEFAULT '',
        end_date    TIMESTAMPTZ,
        created_by  UUID REFERENCES admins(id) ON DELETE SET NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`ALTER TABLE polls ADD COLUMN IF NOT EXISTS end_date   TIMESTAMPTZ`);
    await client.query(`ALTER TABLE polls ADD COLUMN IF NOT EXISTS image_url  TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE polls ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES admins(id) ON DELETE SET NULL`);

    // Poll options
    await client.query(`
      CREATE TABLE IF NOT EXISTS poll_options (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        poll_id     UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
        option_text TEXT NOT NULL
      )
    `);

    // Poll votes
    await client.query(`
      CREATE TABLE IF NOT EXISTS poll_votes (
        id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        poll_id   UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
        option_id UUID NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
        voter_ip  TEXT,
        voted_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Poll insights cache
    await client.query(`
      CREATE TABLE IF NOT EXISTS poll_insights (
        poll_id      UUID PRIMARY KEY REFERENCES polls(id) ON DELETE CASCADE,
        insights     TEXT NOT NULL,
        generated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── SURVEYS ──────────────────────────────────────────────
    // Survey = container with title, image, end_date
    await client.query(`
      CREATE TABLE IF NOT EXISTS surveys (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title       TEXT NOT NULL,
        description TEXT DEFAULT '',
        image_url   TEXT DEFAULT '',
        end_date    TIMESTAMPTZ,
        created_by  UUID REFERENCES admins(id) ON DELETE SET NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Survey questions (each question belongs to one survey)
    await client.query(`
      CREATE TABLE IF NOT EXISTS survey_questions (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        survey_id    UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
        question     TEXT NOT NULL,
        position     INT  NOT NULL DEFAULT 0,
        created_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Survey options (each option belongs to one survey question)
    await client.query(`
      CREATE TABLE IF NOT EXISTS survey_options (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        question_id UUID NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,
        option_text TEXT NOT NULL
      )
    `);

    // Survey votes (one response per question per voter)
    await client.query(`
      CREATE TABLE IF NOT EXISTS survey_votes (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        survey_id   UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
        question_id UUID NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,
        option_id   UUID NOT NULL REFERENCES survey_options(id) ON DELETE CASCADE,
        voter_ip    TEXT,
        voted_at    TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(question_id, voter_ip)
      )
    `);

    // Survey insights cache
    await client.query(`
      CREATE TABLE IF NOT EXISTS survey_insights (
        survey_id    UUID PRIMARY KEY REFERENCES surveys(id) ON DELETE CASCADE,
        insights     TEXT NOT NULL,
        generated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    console.log('All tables ready');
  } catch (err) {
    console.error('Schema init error:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// ── Auth middleware ───────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Poll builder ──────────────────────────────────────────────
async function buildPoll(pollRow) {
  const { rows: options } = await pool.query(
    `SELECT po.id, po.option_text, COUNT(pv.id)::int AS vote_count
     FROM poll_options po
     LEFT JOIN poll_votes pv ON pv.option_id = po.id
     WHERE po.poll_id = $1
     GROUP BY po.id ORDER BY po.id`,
    [pollRow.id]
  );
  const total_votes  = options.reduce((s, o) => s + o.vote_count, 0);
  const is_concluded = pollRow.end_date ? new Date(pollRow.end_date) < new Date() : false;
  return {
    type: 'poll',
    id: pollRow.id, question: pollRow.question, description: pollRow.description,
    image_url: pollRow.image_url || '', end_date: pollRow.end_date,
    created_at: pollRow.created_at, created_by: pollRow.created_by,
    is_concluded, total_votes, options,
  };
}

// ── Survey builder ────────────────────────────────────────────
async function buildSurvey(surveyRow) {
  const { rows: questions } = await pool.query(
    `SELECT id, question, position FROM survey_questions
     WHERE survey_id = $1 ORDER BY position`,
    [surveyRow.id]
  );
  let total_responses = 0;
  for (const q of questions) {
    const { rows: options } = await pool.query(
      `SELECT so.id, so.option_text, COUNT(sv.id)::int AS vote_count
       FROM survey_options so
       LEFT JOIN survey_votes sv ON sv.option_id = so.id
       WHERE so.question_id = $1
       GROUP BY so.id ORDER BY so.id`,
      [q.id]
    );
    q.options    = options;
    q.vote_count = options.reduce((s, o) => s + o.vote_count, 0);
    if (q.vote_count > total_responses) total_responses = q.vote_count;
  }
  const is_concluded = surveyRow.end_date ? new Date(surveyRow.end_date) < new Date() : false;
  return {
    type: 'survey',
    id: surveyRow.id, title: surveyRow.title, description: surveyRow.description,
    image_url: surveyRow.image_url || '', end_date: surveyRow.end_date,
    created_at: surveyRow.created_at, created_by: surveyRow.created_by,
    is_concluded, total_responses, questions,
  };
}

// ── AI insights for polls ─────────────────────────────────────
async function generatePollInsights(poll) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const sorted = [...poll.options].sort((a, b) => b.vote_count - a.vote_count);
  const optionsSummary = sorted.map((o, i) => {
    const pct = poll.total_votes > 0 ? ((o.vote_count / poll.total_votes) * 100).toFixed(1) : '0.0';
    return `${i + 1}. "${o.option_text}" — ${o.vote_count} votes (${pct}%)`;
  }).join('\n');

  const winner    = sorted[0];
  const winnerPct = poll.total_votes > 0 ? ((winner.vote_count / poll.total_votes) * 100).toFixed(1) : '0';
  const daysRan   = poll.end_date && poll.created_at
    ? Math.max(1, Math.round((new Date(poll.end_date) - new Date(poll.created_at)) / 86400000)) : null;

  return callAI(`You are a senior data analyst preparing a stakeholder report on poll results.

Poll question: "${poll.question}"
${poll.description ? `Context: ${poll.description}` : ''}
Total votes cast: ${poll.total_votes}
${daysRan ? `Poll duration: ${daysRan} day${daysRan !== 1 ? 's' : ''}` : ''}
Poll ran: ${new Date(poll.created_at).toDateString()} to ${new Date(poll.end_date).toDateString()}
Winning option: "${winner.option_text}" with ${winner.vote_count} votes (${winnerPct}%)

Full results (ranked):
${optionsSummary}`);
}

// ── AI insights for surveys ───────────────────────────────────
async function generateSurveyInsights(survey) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const questionsSummary = survey.questions.map((q, qi) => {
    const sorted = [...q.options].sort((a, b) => b.vote_count - a.vote_count);
    const total  = q.vote_count;
    const opts   = sorted.map((o, i) => {
      const pct = total > 0 ? ((o.vote_count / total) * 100).toFixed(1) : '0.0';
      return `   ${i + 1}. "${o.option_text}" — ${o.vote_count} votes (${pct}%)`;
    }).join('\n');
    return `Question ${qi + 1}: "${q.question}"\n${opts}`;
  }).join('\n\n');

  const daysRan = survey.end_date && survey.created_at
    ? Math.max(1, Math.round((new Date(survey.end_date) - new Date(survey.created_at)) / 86400000)) : null;

  return callAI(`You are a senior data analyst preparing a stakeholder report on a multi-question survey.

Survey title: "${survey.title}"
${survey.description ? `Context: ${survey.description}` : ''}
Total respondents: ${survey.total_responses}
${daysRan ? `Survey duration: ${daysRan} day${daysRan !== 1 ? 's' : ''}` : ''}
Survey ran: ${new Date(survey.created_at).toDateString()} to ${new Date(survey.end_date).toDateString()}
Number of questions: ${survey.questions.length}

Full results by question:
${questionsSummary}`);
}

// ── Shared AI call ────────────────────────────────────────────
async function callAI(contextPrompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const fullPrompt = `${contextPrompt}

Respond ONLY with a valid JSON object — no markdown, no code fences, no preamble. Use this exact structure:
{
  "key_finding": "One powerful sentence about the most important result",
  "summary": "Two to three sentences interpreting what the overall data means for decision makers",
  "insights": [
    { "icon": "📊", "title": "Short title", "body": "One to two sentence insight" },
    { "icon": "🔍", "title": "Short title", "body": "One to two sentence insight" },
    { "icon": "💡", "title": "Short title", "body": "One to two sentence insight" }
  ],
  "recommendations": [
    { "priority": "High",   "title": "Short action title", "body": "Specific actionable recommendation", "rationale": "Why this matters based on the data" },
    { "priority": "Medium", "title": "Short action title", "body": "Specific actionable recommendation", "rationale": "Why this matters based on the data" },
    { "priority": "Low",    "title": "Short action title", "body": "Specific actionable recommendation", "rationale": "Why this matters based on the data" }
  ],
  "data_quality": {
    "score": <integer 1-10>,
    "note": "One sentence about data quality or limitations"
  },
  "sentiment": "<strongly_positive|positive|neutral|mixed|negative|strongly_negative>"
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 1400, messages: [{ role: 'user', content: fullPrompt }] }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Claude API error: ' + response.status);
  }
  const data = await response.json();
  const raw  = data.content[0].text.trim();
  try { JSON.parse(raw); } catch { throw new Error('AI returned invalid JSON — please try regenerating'); }
  return raw;
}

// ════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ════════════════════════════════════════════════════════════

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name?.trim())   return res.status(400).json({ error: 'Name is required' });
  if (!email?.trim())  return res.status(400).json({ error: 'Email is required' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const existing = await pool.query('SELECT id FROM admins WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length) return res.status(409).json({ error: 'An account with this email already exists' });
    const hashed = await bcrypt.hash(password, 12);
    const { rows: [admin] } = await pool.query(
      `INSERT INTO admins (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email, created_at`,
      [name.trim(), email.toLowerCase(), hashed]
    );
    const token = jwt.sign({ id: admin.id, email: admin.email, name: admin.name }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, admin: { id: admin.id, name: admin.name, email: admin.email } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  try {
    const { rows } = await pool.query('SELECT id, name, email, password FROM admins WHERE email = $1', [email.toLowerCase()]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid email or password' });
    const valid = await bcrypt.compare(password, rows[0].password);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });
    const token = jwt.sign({ id: rows[0].id, email: rows[0].email, name: rows[0].name }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, admin: { id: rows[0].id, name: rows[0].name, email: rows[0].email } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, email, created_at FROM admins WHERE id = $1', [req.admin.id]);
    if (!rows.length) return res.status(404).json({ error: 'Admin not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
//  POLL ROUTES
// ════════════════════════════════════════════════════════════

app.get('/api/polls', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, question, description, image_url, end_date, created_by, created_at FROM polls
       WHERE end_date IS NULL OR end_date > NOW() ORDER BY created_at DESC`
    );
    res.json(await Promise.all(rows.map(buildPoll)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/polls/concluded', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, question, description, image_url, end_date, created_by, created_at FROM polls
       WHERE end_date IS NOT NULL AND end_date <= NOW() AND created_by = $1 ORDER BY end_date DESC`,
      [req.admin.id]
    );
    res.json(await Promise.all(rows.map(buildPoll)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/polls/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, question, description, image_url, end_date, created_by, created_at FROM polls WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Poll not found' });
    res.json(await buildPoll(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/polls', requireAuth, async (req, res) => {
  const { question, description = '', options, end_date, image_url = '' } = req.body;
  if (!question?.trim())                           return res.status(400).json({ error: 'Question is required' });
  if (!Array.isArray(options) || options.length < 2) return res.status(400).json({ error: 'At least 2 options are required' });
  if (!end_date)                                    return res.status(400).json({ error: 'End date is required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [poll] } = await client.query(
      `INSERT INTO polls (question, description, image_url, end_date, created_by) VALUES ($1,$2,$3,$4,$5)
       RETURNING id, question, description, image_url, end_date, created_by, created_at`,
      [question.trim(), description.trim(), image_url.trim(), new Date(end_date), req.admin.id]
    );
    const insertedOptions = [];
    for (const text of options) {
      const { rows: [opt] } = await client.query(
        `INSERT INTO poll_options (poll_id, option_text) VALUES ($1,$2) RETURNING id, option_text`,
        [poll.id, text.trim()]
      );
      insertedOptions.push({ ...opt, vote_count: 0 });
    }
    await client.query('COMMIT');
    res.status(201).json({ ...poll, type: 'poll', options: insertedOptions, total_votes: 0, is_concluded: false });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

app.post('/api/polls/:id/vote', async (req, res) => {
  const { option_id } = req.body;
  const voter_ip = ((req.headers['x-forwarded-for']||'').split(',')[0].trim()||req.socket.remoteAddress||'unknown');
  if (!option_id) return res.status(400).json({ error: 'option_id is required' });
  try {
    const { rows } = await pool.query(`SELECT end_date FROM polls WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Poll not found' });
    if (rows[0].end_date && new Date(rows[0].end_date) < new Date())
      return res.status(403).json({ error: 'This poll has concluded and is no longer accepting votes' });
    const dup = await pool.query(`SELECT id FROM poll_votes WHERE poll_id=$1 AND voter_ip=$2`, [req.params.id, voter_ip]);
    if (dup.rows.length) return res.status(409).json({ error: 'You have already voted on this poll' });
    await pool.query(`INSERT INTO poll_votes (poll_id, option_id, voter_ip) VALUES ($1,$2,$3)`, [req.params.id, option_id, voter_ip]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/polls/:id/insights', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT id, question, description, image_url, end_date, created_by, created_at FROM polls WHERE id=$1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].created_by !== req.admin.id) return res.status(403).json({ error: 'Access denied' });
    const poll = await buildPoll(rows[0]);
    if (!poll.is_concluded) return res.status(400).json({ error: 'Insights only available for concluded polls' });
    const { rows: cached } = await pool.query(`SELECT insights, generated_at FROM poll_insights WHERE poll_id=$1`, [req.params.id]);
    if (cached.length && !req.query.regenerate) return res.json({ insights: cached[0].insights, cached: true, generated_at: cached[0].generated_at });
    const insights = await generatePollInsights(poll);
    await pool.query(`INSERT INTO poll_insights (poll_id, insights) VALUES ($1,$2) ON CONFLICT (poll_id) DO UPDATE SET insights=$2, generated_at=NOW()`, [req.params.id, insights]);
    res.json({ insights, cached: false, generated_at: new Date() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/polls/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT created_by FROM polls WHERE id=$1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].created_by !== req.admin.id) return res.status(403).json({ error: 'Access denied' });
    await pool.query(`DELETE FROM polls WHERE id=$1`, [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
//  SURVEY ROUTES
// ════════════════════════════════════════════════════════════

// GET /api/surveys — public, active surveys
app.get('/api/surveys', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, description, image_url, end_date, created_by, created_at FROM surveys
       WHERE end_date IS NULL OR end_date > NOW() ORDER BY created_at DESC`
    );
    res.json(await Promise.all(rows.map(buildSurvey)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/surveys/concluded — protected, admin's concluded surveys
app.get('/api/surveys/concluded', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, description, image_url, end_date, created_by, created_at FROM surveys
       WHERE end_date IS NOT NULL AND end_date <= NOW() AND created_by = $1 ORDER BY end_date DESC`,
      [req.admin.id]
    );
    res.json(await Promise.all(rows.map(buildSurvey)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/surveys/:id — public
app.get('/api/surveys/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, description, image_url, end_date, created_by, created_at FROM surveys WHERE id=$1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Survey not found' });
    res.json(await buildSurvey(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/surveys — protected
// Body: { title, description?, image_url?, end_date, questions: [{question, options:[]}] }
app.post('/api/surveys', requireAuth, async (req, res) => {
  const { title, description = '', image_url = '', end_date, questions } = req.body;
  if (!title?.trim())                                  return res.status(400).json({ error: 'Title is required' });
  if (!Array.isArray(questions) || questions.length < 2) return res.status(400).json({ error: 'At least 2 questions are required for a survey' });
  if (!end_date)                                        return res.status(400).json({ error: 'End date is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [survey] } = await client.query(
      `INSERT INTO surveys (title, description, image_url, end_date, created_by) VALUES ($1,$2,$3,$4,$5)
       RETURNING id, title, description, image_url, end_date, created_by, created_at`,
      [title.trim(), description.trim(), image_url.trim(), new Date(end_date), req.admin.id]
    );

    const insertedQuestions = [];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.question?.trim())            throw new Error(`Question ${i+1} text is required`);
      if (!Array.isArray(q.options) || q.options.length < 2) throw new Error(`Question ${i+1} needs at least 2 options`);

      const { rows: [qRow] } = await client.query(
        `INSERT INTO survey_questions (survey_id, question, position) VALUES ($1,$2,$3) RETURNING id, question, position`,
        [survey.id, q.question.trim(), i]
      );

      const insertedOptions = [];
      for (const text of q.options) {
        const { rows: [opt] } = await client.query(
          `INSERT INTO survey_options (question_id, option_text) VALUES ($1,$2) RETURNING id, option_text`,
          [qRow.id, text.trim()]
        );
        insertedOptions.push({ ...opt, vote_count: 0 });
      }
      insertedQuestions.push({ ...qRow, options: insertedOptions, vote_count: 0 });
    }

    await client.query('COMMIT');
    res.status(201).json({ ...survey, type: 'survey', questions: insertedQuestions, total_responses: 0, is_concluded: false });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// POST /api/surveys/:id/vote — public, submits all answers at once
// Body: { answers: [{ question_id, option_id }] }
app.post('/api/surveys/:id/vote', async (req, res) => {
  const { answers } = req.body;
  const voter_ip = ((req.headers['x-forwarded-for']||'').split(',')[0].trim()||req.socket.remoteAddress||'unknown');

  if (!Array.isArray(answers) || !answers.length)
    return res.status(400).json({ error: 'answers array is required' });

  try {
    const { rows } = await pool.query(`SELECT end_date FROM surveys WHERE id=$1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Survey not found' });
    if (rows[0].end_date && new Date(rows[0].end_date) < new Date())
      return res.status(403).json({ error: 'This survey has concluded' });

    // Check if already voted on any question
    const dup = await pool.query(
      `SELECT id FROM survey_votes WHERE survey_id=$1 AND voter_ip=$2 LIMIT 1`,
      [req.params.id, voter_ip]
    );
    if (dup.rows.length) return res.status(409).json({ error: 'You have already completed this survey' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const a of answers) {
        await client.query(
          `INSERT INTO survey_votes (survey_id, question_id, option_id, voter_ip) VALUES ($1,$2,$3,$4)
           ON CONFLICT (question_id, voter_ip) DO NOTHING`,
          [req.params.id, a.question_id, a.option_id, voter_ip]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally { client.release(); }

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/surveys/:id/insights — protected, owner only
app.get('/api/surveys/:id/insights', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, description, image_url, end_date, created_by, created_at FROM surveys WHERE id=$1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].created_by !== req.admin.id) return res.status(403).json({ error: 'Access denied' });
    const survey = await buildSurvey(rows[0]);
    if (!survey.is_concluded) return res.status(400).json({ error: 'Insights only available for concluded surveys' });

    const { rows: cached } = await pool.query(`SELECT insights, generated_at FROM survey_insights WHERE survey_id=$1`, [req.params.id]);
    if (cached.length && !req.query.regenerate) return res.json({ insights: cached[0].insights, cached: true, generated_at: cached[0].generated_at });

    const insights = await generateSurveyInsights(survey);
    await pool.query(`INSERT INTO survey_insights (survey_id, insights) VALUES ($1,$2) ON CONFLICT (survey_id) DO UPDATE SET insights=$2, generated_at=NOW()`, [req.params.id, insights]);
    res.json({ insights, cached: false, generated_at: new Date() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/surveys/:id — protected, owner only
app.delete('/api/surveys/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT created_by FROM surveys WHERE id=$1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].created_by !== req.admin.id) return res.status(403).json({ error: 'Access denied' });
    await pool.query(`DELETE FROM surveys WHERE id=$1`, [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Combined feed (polls + surveys for home page) ─────────────
app.get('/api/feed', async (req, res) => {
  try {
    const [{ rows: pollRows }, { rows: surveyRows }] = await Promise.all([
      pool.query(`SELECT id, question, description, image_url, end_date, created_by, created_at FROM polls WHERE end_date IS NULL OR end_date > NOW() ORDER BY created_at DESC`),
      pool.query(`SELECT id, title, description, image_url, end_date, created_by, created_at FROM surveys WHERE end_date IS NULL OR end_date > NOW() ORDER BY created_at DESC`),
    ]);
    const [polls, surveys] = await Promise.all([
      Promise.all(pollRows.map(buildPoll)),
      Promise.all(surveyRows.map(buildSurvey)),
    ]);
    const feed = [...polls, ...surveys].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(feed);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Dashboard concluded feed ──────────────────────────────────
app.get('/api/concluded', requireAuth, async (req, res) => {
  try {
    const [{ rows: pollRows }, { rows: surveyRows }] = await Promise.all([
      pool.query(`SELECT id, question, description, image_url, end_date, created_by, created_at FROM polls WHERE end_date IS NOT NULL AND end_date <= NOW() AND created_by=$1 ORDER BY end_date DESC`, [req.admin.id]),
      pool.query(`SELECT id, title, description, image_url, end_date, created_by, created_at FROM surveys WHERE end_date IS NOT NULL AND end_date <= NOW() AND created_by=$1 ORDER BY end_date DESC`, [req.admin.id]),
    ]);
    const [polls, surveys] = await Promise.all([
      Promise.all(pollRows.map(buildPoll)),
      Promise.all(surveyRows.map(buildSurvey)),
    ]);
    const feed = [...polls, ...surveys].sort((a, b) => new Date(b.end_date) - new Date(a.end_date));
    res.json(feed);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Health
app.get('/api/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ status: 'ok', db: 'connected' }); }
  catch (e) { res.status(503).json({ status: 'error', message: e.message }); }
});

// Catch-all
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

initSchema()
  .then(() => app.listen(PORT, () => console.log('Pollytics running on port ' + PORT)))
  .catch(err => { console.error('Startup failed:', err.message); process.exit(1); });
