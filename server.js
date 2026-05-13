const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'lovepop-ambassador-secret-2024';

// ── Upload dirs ───────────────────────────────────────────────
const DATA_DIR = process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : null;
const UPLOADS_DIR = DATA_DIR
  ? path.join(DATA_DIR, 'uploads')
  : path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const diskStorage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({ storage: diskStorage, limits: { fileSize: 15 * 1024 * 1024 } });

app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// ── Auth middleware ───────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function teamOnly(req, res, next) {
  if (req.user?.role !== 'team') return res.status(403).json({ error: 'Team access required' });
  next();
}

// ── Tier calculation ──────────────────────────────────────────
function calculateTier(totalPosts, totalImpressions) {
  const postScore = totalPosts;
  const impScore = totalImpressions / 10000; // 10k impressions = 1 point
  const score = postScore + impScore;
  if (score >= 150) return 'diamond';
  if (score >= 75) return 'platinum';
  if (score >= 35) return 'gold';
  if (score >= 15) return 'silver';
  return 'bronze';
}

function updateInfluencerStats(influencerId) {
  const stats = db.prepare(`
    SELECT COUNT(*) as total_posts, COALESCE(SUM(impressions),0) as total_impressions
    FROM post_submissions WHERE influencer_id = ? AND status = 'approved'
  `).get(influencerId);
  const tier = calculateTier(stats.total_posts, stats.total_impressions);
  db.prepare(`
    UPDATE influencers SET total_posts = ?, total_impressions = ?, tier = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(stats.total_posts, stats.total_impressions, tier, influencerId);
}

// ── Campaign status auto-calculation ─────────────────────────
function getCampaignStatus(campaign) {
  if (campaign.status_override) return campaign.status_override;
  const now = new Date();
  const start = campaign.start_date ? new Date(campaign.start_date) : null;
  const end = campaign.end_date ? new Date(campaign.end_date) : null;
  if (!start && !end) return 'coming_soon';
  if (start && now < start) return 'coming_soon';
  if (end && now > end) return 'closed';
  if (end) {
    const daysLeft = (end - now) / (1000 * 60 * 60 * 24);
    if (daysLeft <= 7) return 'closing_soon';
  }
  return 'live';
}

// ═══════════════════════════════════════════════════════════════
// AUTH ROUTES
// ═══════════════════════════════════════════════════════════════

// Team login
app.post('/api/auth/team-login', (req, res) => {
  const { username, password } = req.body;
  const TEAM_USERS = JSON.parse(process.env.TEAM_USERS || '[]');
  // Default demo credentials if no env var set
  const defaults = [
    { username: 'admin', password: 'lovepop2024', name: 'Admin User' },
    { username: 'team', password: 'ambassador123', name: 'Team Member' }
  ];
  const users = TEAM_USERS.length ? TEAM_USERS : defaults;
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ role: 'team', name: user.name, username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, name: user.name, role: 'team' });
});

// Influencer login
app.post('/api/auth/influencer-login', (req, res) => {
  const { email, password } = req.body;
  const influencer = db.prepare('SELECT * FROM influencers WHERE email = ?').get(email);
  if (!influencer) return res.status(401).json({ error: 'Invalid credentials' });
  if (influencer.status !== 'approved') return res.status(403).json({ error: 'Account pending approval' });
  if (!influencer.password_hash) return res.status(401).json({ error: 'Password not set. Please contact the Lovepop team.' });
  const valid = bcrypt.compareSync(password, influencer.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ role: 'influencer', id: influencer.id, name: influencer.name, email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, name: influencer.name, role: 'influencer', id: influencer.id });
});

// Me endpoint
app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json(req.user);
});

// ═══════════════════════════════════════════════════════════════
// SIGNUP (public)
// ═══════════════════════════════════════════════════════════════
app.post('/api/signup', (req, res) => {
  const {
    name, email, phone,
    instagram, tiktok, youtube, linkedin,
    instagram_followers, tiktok_followers, youtube_followers, linkedin_followers,
    why_lovepop, age_range, audience_description
  } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
  const existing = db.prepare('SELECT id FROM influencers WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'An application with this email already exists' });
  try {
    const result = db.prepare(`
      INSERT INTO influencers (name, email, phone, instagram, tiktok, youtube, linkedin,
        instagram_followers, tiktok_followers, youtube_followers, linkedin_followers,
        why_lovepop, age_range, audience_description, status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending')
    `).run(
      name, email, phone || '',
      instagram || '', tiktok || '', youtube || '', linkedin || '',
      parseInt(instagram_followers) || 0, parseInt(tiktok_followers) || 0,
      parseInt(youtube_followers) || 0, parseInt(linkedin_followers) || 0,
      why_lovepop || '', age_range || '', audience_description || ''
    );
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// INFLUENCER ROUTES (team manages)
// ═══════════════════════════════════════════════════════════════
app.get('/api/influencers', authMiddleware, teamOnly, (req, res) => {
  const { status, search } = req.query;
  let query = 'SELECT * FROM influencers WHERE 1=1';
  const params = [];
  if (status && status !== 'all') { query += ' AND status = ?'; params.push(status); }
  if (search) { query += ' AND (name LIKE ? OR email LIKE ? OR instagram LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  query += ' ORDER BY created_at DESC';
  const influencers = db.prepare(query).all(...params);
  // Parse JSON fields
  const result = influencers.map(i => ({
    ...i,
    lovepop_contacts: JSON.parse(i.lovepop_contacts || '[]'),
    notes: JSON.parse(i.notes || '[]'),
    contracts: JSON.parse(i.contracts || '[]')
  }));
  res.json(result);
});

app.get('/api/influencers/:id', authMiddleware, (req, res) => {
  if (req.user.role === 'influencer' && req.user.id !== parseInt(req.params.id)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const influencer = db.prepare('SELECT * FROM influencers WHERE id = ?').get(req.params.id);
  if (!influencer) return res.status(404).json({ error: 'Not found' });
  const contacts = db.prepare('SELECT * FROM influencer_contacts WHERE influencer_id = ? ORDER BY id').all(influencer.id);
  res.json({
    ...influencer,
    lovepop_contacts: JSON.parse(influencer.lovepop_contacts || '[]'),
    notes: JSON.parse(influencer.notes || '[]'),
    contracts: JSON.parse(influencer.contracts || '[]'),
    contacts
  });
});

app.put('/api/influencers/:id', authMiddleware, teamOnly, (req, res) => {
  const {
    name, email, phone, instagram, tiktok, youtube, linkedin,
    instagram_followers, tiktok_followers, youtube_followers, linkedin_followers,
    why_lovepop, age_range, audience_description, status, password,
    lovepop_contacts, notes, contracts, contacts
  } = req.body;

  const influencer = db.prepare('SELECT * FROM influencers WHERE id = ?').get(req.params.id);
  if (!influencer) return res.status(404).json({ error: 'Not found' });

  let password_hash = influencer.password_hash;
  if (password) {
    password_hash = bcrypt.hashSync(password, 10);
  }

  db.prepare(`
    UPDATE influencers SET
      name=?, email=?, phone=?, instagram=?, tiktok=?, youtube=?, linkedin=?,
      instagram_followers=?, tiktok_followers=?, youtube_followers=?, linkedin_followers=?,
      why_lovepop=?, age_range=?, audience_description=?, status=?, password_hash=?,
      lovepop_contacts=?, notes=?, contracts=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    name || influencer.name,
    email || influencer.email,
    phone ?? influencer.phone,
    instagram ?? influencer.instagram,
    tiktok ?? influencer.tiktok,
    youtube ?? influencer.youtube,
    linkedin ?? influencer.linkedin,
    parseInt(instagram_followers) || influencer.instagram_followers,
    parseInt(tiktok_followers) || influencer.tiktok_followers,
    parseInt(youtube_followers) || influencer.youtube_followers,
    parseInt(linkedin_followers) || influencer.linkedin_followers,
    why_lovepop ?? influencer.why_lovepop,
    age_range ?? influencer.age_range,
    audience_description ?? influencer.audience_description,
    status || influencer.status,
    password_hash,
    JSON.stringify(lovepop_contacts || JSON.parse(influencer.lovepop_contacts || '[]')),
    JSON.stringify(notes || JSON.parse(influencer.notes || '[]')),
    JSON.stringify(contracts || JSON.parse(influencer.contracts || '[]')),
    req.params.id
  );

  // Update contacts
  if (contacts !== undefined) {
    db.prepare('DELETE FROM influencer_contacts WHERE influencer_id = ?').run(req.params.id);
    for (const c of contacts) {
      db.prepare(`
        INSERT INTO influencer_contacts (influencer_id, name, email, phone, role, active)
        VALUES (?,?,?,?,?,?)
      `).run(req.params.id, c.name || '', c.email || '', c.phone || '', c.role || '', c.active ? 1 : 0);
    }
  }

  res.json({ success: true });
});

// Self-update profile (influencer updating their own record)
app.put('/api/influencers/:id/profile', authMiddleware, (req, res) => {
  const influencer = db.prepare('SELECT * FROM influencers WHERE id = ?').get(req.params.id);
  if (!influencer) return res.status(404).json({ error: 'Not found' });

  // Influencers can only edit themselves; team can edit anyone
  if (req.user.role !== 'team' && req.user.id !== influencer.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const {
    name, email, phone,
    instagram, tiktok, youtube, linkedin,
    instagram_followers, tiktok_followers, youtube_followers, linkedin_followers,
    age_range, audience_description, why_lovepop,
    new_password
  } = req.body;

  // Email uniqueness check (skip if unchanged)
  if (email && email !== influencer.email) {
    const conflict = db.prepare('SELECT id FROM influencers WHERE email = ? AND id != ?').get(email, req.params.id);
    if (conflict) return res.status(400).json({ error: 'That email is already in use.' });
  }

  let password_hash = influencer.password_hash;
  if (new_password && new_password.length >= 6) {
    password_hash = bcrypt.hashSync(new_password, 10);
  }

  db.prepare(`
    UPDATE influencers SET
      name=?, email=?, phone=?,
      instagram=?, tiktok=?, youtube=?, linkedin=?,
      instagram_followers=?, tiktok_followers=?, youtube_followers=?, linkedin_followers=?,
      age_range=?, audience_description=?, why_lovepop=?,
      password_hash=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    name              ?? influencer.name,
    email             ?? influencer.email,
    phone             ?? influencer.phone,
    instagram         ?? influencer.instagram,
    tiktok            ?? influencer.tiktok,
    youtube           ?? influencer.youtube,
    linkedin          ?? influencer.linkedin,
    parseInt(instagram_followers) >= 0 ? parseInt(instagram_followers) : influencer.instagram_followers,
    parseInt(tiktok_followers)    >= 0 ? parseInt(tiktok_followers)    : influencer.tiktok_followers,
    parseInt(youtube_followers)   >= 0 ? parseInt(youtube_followers)   : influencer.youtube_followers,
    parseInt(linkedin_followers)  >= 0 ? parseInt(linkedin_followers)  : influencer.linkedin_followers,
    age_range            ?? influencer.age_range,
    audience_description ?? influencer.audience_description,
    why_lovepop          ?? influencer.why_lovepop,
    password_hash,
    req.params.id
  );

  res.json({ success: true });
});

// Approve/Reject actions
app.post('/api/influencers/:id/approve', authMiddleware, teamOnly, (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required for approval' });
  const password_hash = bcrypt.hashSync(password, 10);
  db.prepare(`UPDATE influencers SET status='approved', password_hash=?, updated_at=datetime('now') WHERE id=?`).run(password_hash, req.params.id);
  res.json({ success: true });
});

app.post('/api/influencers/:id/reject', authMiddleware, teamOnly, (req, res) => {
  db.prepare(`UPDATE influencers SET status='rejected', updated_at=datetime('now') WHERE id=?`).run(req.params.id);
  res.json({ success: true });
});

// Upload contract
app.post('/api/influencers/:id/contract', authMiddleware, teamOnly, upload.single('file'), (req, res) => {
  const influencer = db.prepare('SELECT * FROM influencers WHERE id = ?').get(req.params.id);
  if (!influencer) return res.status(404).json({ error: 'Not found' });
  const contracts = JSON.parse(influencer.contracts || '[]');
  contracts.push({
    filename: req.file.originalname,
    path: `/uploads/${req.file.filename}`,
    uploaded_at: new Date().toISOString()
  });
  db.prepare(`UPDATE influencers SET contracts=?, updated_at=datetime('now') WHERE id=?`).run(JSON.stringify(contracts), req.params.id);
  res.json({ success: true, contracts });
});

// Add note
app.post('/api/influencers/:id/notes', authMiddleware, teamOnly, (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Note text required' });
  const influencer = db.prepare('SELECT * FROM influencers WHERE id = ?').get(req.params.id);
  if (!influencer) return res.status(404).json({ error: 'Not found' });
  const notes = JSON.parse(influencer.notes || '[]');
  notes.unshift({ text, author: req.user.name || req.user.username, timestamp: new Date().toISOString() });
  db.prepare(`UPDATE influencers SET notes=?, updated_at=datetime('now') WHERE id=?`).run(JSON.stringify(notes), req.params.id);
  res.json({ success: true, notes });
});

// ═══════════════════════════════════════════════════════════════
// CAMPAIGN ROUTES
// ═══════════════════════════════════════════════════════════════
app.get('/api/campaigns', authMiddleware, (req, res) => {
  const campaigns = db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all();
  const result = campaigns.map(c => ({
    ...c,
    computed_status: getCampaignStatus(c),
    product_bundles: JSON.parse(c.product_bundles || '[]'),
    image_assets: JSON.parse(c.image_assets || '[]'),
    sku_designations: JSON.parse(c.sku_designations || '[]')
  }));
  res.json(result);
});

app.get('/api/campaigns/:id', authMiddleware, (req, res) => {
  const c = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json({
    ...c,
    computed_status: getCampaignStatus(c),
    product_bundles: JSON.parse(c.product_bundles || '[]'),
    image_assets: JSON.parse(c.image_assets || '[]'),
    sku_designations: JSON.parse(c.sku_designations || '[]')
  });
});

app.post('/api/campaigns', authMiddleware, teamOnly, (req, res) => {
  const { name, description, objectives, start_date, end_date, status_override, success_metrics, product_bundles, sku_designations } = req.body;
  if (!name) return res.status(400).json({ error: 'Campaign name required' });
  const result = db.prepare(`
    INSERT INTO campaigns (name, description, objectives, start_date, end_date, status_override, success_metrics, product_bundles, sku_designations)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(
    name, description || '', objectives || '', start_date || '', end_date || '',
    status_override || '', success_metrics || '',
    JSON.stringify(product_bundles || []),
    JSON.stringify(sku_designations || [])
  );
  res.json({ success: true, id: result.lastInsertRowid });
});

app.put('/api/campaigns/:id', authMiddleware, teamOnly, (req, res) => {
  const c = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const { name, description, objectives, start_date, end_date, status_override, success_metrics, product_bundles, sku_designations } = req.body;
  db.prepare(`
    UPDATE campaigns SET name=?, description=?, objectives=?, start_date=?, end_date=?,
      status_override=?, success_metrics=?, product_bundles=?, sku_designations=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    name ?? c.name, description ?? c.description, objectives ?? c.objectives,
    start_date ?? c.start_date, end_date ?? c.end_date, status_override ?? c.status_override,
    success_metrics ?? c.success_metrics,
    JSON.stringify(product_bundles ?? JSON.parse(c.product_bundles || '[]')),
    JSON.stringify(sku_designations ?? JSON.parse(c.sku_designations || '[]')),
    req.params.id
  );
  res.json({ success: true });
});

app.delete('/api/campaigns/:id', authMiddleware, teamOnly, (req, res) => {
  db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Campaign image upload
app.post('/api/campaigns/:id/images', authMiddleware, teamOnly, upload.single('file'), (req, res) => {
  const c = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const assets = JSON.parse(c.image_assets || '[]');
  assets.push({
    filename: req.file.originalname,
    path: `/uploads/${req.file.filename}`,
    uploaded_at: new Date().toISOString()
  });
  db.prepare(`UPDATE campaigns SET image_assets=?, updated_at=datetime('now') WHERE id=?`).run(JSON.stringify(assets), req.params.id);
  res.json({ success: true, image_assets: assets });
});

// ═══════════════════════════════════════════════════════════════
// POST SUBMISSION ROUTES
// ═══════════════════════════════════════════════════════════════
app.get('/api/posts', authMiddleware, (req, res) => {
  let query, params;
  if (req.user.role === 'influencer') {
    query = 'SELECT ps.*, c.name as campaign_name FROM post_submissions ps LEFT JOIN campaigns c ON ps.campaign_id=c.id WHERE ps.influencer_id=? ORDER BY ps.created_at DESC';
    params = [req.user.id];
  } else {
    const { influencer_id, status } = req.query;
    query = 'SELECT ps.*, i.name as influencer_name, c.name as campaign_name FROM post_submissions ps LEFT JOIN influencers i ON ps.influencer_id=i.id LEFT JOIN campaigns c ON ps.campaign_id=c.id WHERE 1=1';
    params = [];
    if (influencer_id) { query += ' AND ps.influencer_id=?'; params.push(influencer_id); }
    if (status) { query += ' AND ps.status=?'; params.push(status); }
    query += ' ORDER BY ps.created_at DESC';
  }
  res.json(db.prepare(query).all(...params));
});

app.post('/api/posts', authMiddleware, upload.single('screenshot'), (req, res) => {
  const influencer_id = req.user.role === 'influencer' ? req.user.id : req.body.influencer_id;
  const { campaign_id, platform, post_url, date_posted, impressions, notes } = req.body;
  if (!platform) return res.status(400).json({ error: 'Platform required' });
  const screenshot_path = req.file ? `/uploads/${req.file.filename}` : '';
  const result = db.prepare(`
    INSERT INTO post_submissions (influencer_id, campaign_id, platform, post_url, screenshot_path, date_posted, impressions, notes)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(
    influencer_id, campaign_id || null, platform, post_url || '',
    screenshot_path, date_posted || new Date().toISOString().split('T')[0],
    parseInt(impressions) || 0, notes || ''
  );
  res.json({ success: true, id: result.lastInsertRowid });
});

app.put('/api/posts/:id', authMiddleware, teamOnly, (req, res) => {
  const post = db.prepare('SELECT * FROM post_submissions WHERE id=?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });
  const { status, impressions, notes } = req.body;
  db.prepare(`UPDATE post_submissions SET status=?, impressions=?, notes=?, updated_at=datetime('now') WHERE id=?`).run(
    status ?? post.status, parseInt(impressions) ?? post.impressions, notes ?? post.notes, req.params.id
  );
  // Update influencer stats when post status changes
  if (status) updateInfluencerStats(post.influencer_id);
  res.json({ success: true });
});

app.delete('/api/posts/:id', authMiddleware, (req, res) => {
  const post = db.prepare('SELECT * FROM post_submissions WHERE id=?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'influencer' && req.user.id !== post.influencer_id) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM post_submissions WHERE id=?').run(req.params.id);
  updateInfluencerStats(post.influencer_id);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════
// STATS ROUTES
// ═══════════════════════════════════════════════════════════════
app.get('/api/stats/overview', authMiddleware, teamOnly, (req, res) => {
  const totalInfluencers = db.prepare("SELECT COUNT(*) as c FROM influencers WHERE status='approved'").get().c;
  const pendingInfluencers = db.prepare("SELECT COUNT(*) as c FROM influencers WHERE status='pending'").get().c;
  const totalPosts = db.prepare("SELECT COUNT(*) as c FROM post_submissions WHERE status='approved'").get().c;
  const totalImpressions = db.prepare("SELECT COALESCE(SUM(impressions),0) as c FROM post_submissions WHERE status='approved'").get().c;
  const activeCampaigns = db.prepare("SELECT COUNT(*) as c FROM campaigns WHERE status_override='live' OR (status_override='' AND start_date <= date('now') AND (end_date >= date('now') OR end_date=''))").get().c;
  res.json({ totalInfluencers, pendingInfluencers, totalPosts, totalImpressions, activeCampaigns });
});

// ═══════════════════════════════════════════════════════════════
// SPA fallback — all non-API routes serve index.html
// ═══════════════════════════════════════════════════════════════
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Lovepop Ambassador Program running on http://localhost:${PORT}`);
  // Auto-seed if database is empty (first Railway deploy or fresh local start)
  try {
    const count = db.prepare('SELECT COUNT(*) as c FROM influencers').get().c;
    if (count === 0) {
      console.log('Database is empty — running seed...');
      require('./scripts/seed.js');
    }
  } catch (e) {
    console.error('Auto-seed failed:', e.message);
  }
});
