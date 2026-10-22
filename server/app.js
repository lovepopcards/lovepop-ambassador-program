// The Express app: BASE_PATH strip, sessions, API routes, uploads and the single-page frontend.
// server/index.js boots it (config check, DB, listen); tests build it directly.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import express from 'express';
import multer from 'multer';
import { one, q } from './db.js';
import { authConfigFromEnv, createAuth, requireUser, teamOnly } from './auth.js';
import { parseUploadUrl, responseHeaders } from './mediaStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MIN_PASSWORD_LENGTH = 6;
const IMPRESSIONS_PER_POINT = 10000;
const TIER_THRESHOLDS = [['diamond', 150], ['platinum', 75], ['gold', 35], ['silver', 15]];
const PG_UNIQUE_VIOLATION = '23505';

// ── Pure helpers ──────────────────────────────────────────────
export function calculateTier(totalPosts, totalImpressions) {
  const score = totalPosts + totalImpressions / IMPRESSIONS_PER_POINT;
  return TIER_THRESHOLDS.find(([, min]) => score >= min)?.[0] || 'bronze';
}

function getCampaignStatus(campaign, now = new Date()) {
  if (campaign.status_override) return campaign.status_override;
  const start = campaign.start_date ? new Date(campaign.start_date) : null;
  const end = campaign.end_date ? new Date(campaign.end_date) : null;
  if (!start && !end) return 'coming_soon';
  if (start && now < start) return 'coming_soon';
  if (end && now > end) return 'closed';
  if (end && (end - now) / (1000 * 60 * 60 * 24) <= 7) return 'closing_soon';
  return 'live';
}

const parseList = (text) => JSON.parse(text || '[]');
/** parseInt that falls back when the input is missing or not a number (NaN would break a pg INTEGER). */
const intOr = (value, fallback) => { const n = parseInt(value, 10); return Number.isNaN(n) ? fallback : n; };

const withInfluencerLists = (row) => ({ ...row, lovepop_contacts: parseList(row.lovepop_contacts), notes: parseList(row.notes), contracts: parseList(row.contracts) });
const withCampaignLists = (row) => ({ ...row, computed_status: getCampaignStatus(row), product_bundles: parseList(row.product_bundles), image_assets: parseList(row.image_assets), sku_designations: parseList(row.sku_designations) });

async function updateInfluencerStats(influencerId) {
  const stats = await one(`
    SELECT COUNT(*)::int AS total_posts, COALESCE(SUM(impressions), 0)::int AS total_impressions
    FROM post_submissions WHERE influencer_id = $1 AND status = 'approved'`, [influencerId]);
  await q(`UPDATE influencers SET total_posts = $1, total_impressions = $2, tier = $3, updated_at = now() WHERE id = $4`,
    [stats.total_posts, stats.total_impressions, calculateTier(stats.total_posts, stats.total_impressions), influencerId]);
}

// Express 4 does not catch rejected promises: route every async handler's errors to next().
const route = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

export function createApp({ env = process.env, mediaStore }) {
  const config = authConfigFromEnv(env);
  const auth = createAuth(config);
  const appCommit = env.APP_COMMIT || 'dev';
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });
  const indexHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8')
    .replaceAll('%BASE_PATH_JSON%', JSON.stringify(config.basePath))
    .replaceAll('%BASE_PATH%', config.basePath);

  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  // Strip BASE_PATH (/ambassador behind admin.lovepop.com); /healthz stays unprefixed for the ALB.
  if (config.basePath) app.use((req, _res, next) => { if (req.url === config.basePath || req.url.startsWith(`${config.basePath}/`)) req.url = req.url.slice(config.basePath.length) || '/'; next(); });

  app.get('/healthz', (_req, res) => res.json({ ok: true, auth: config.mode, commit: appCommit }));

  app.use(cookieParser());
  app.use(express.json({ limit: '10mb' }));
  app.use(auth.attachUser);
  // CloudFront sits in front of admin.lovepop.com: per-user answers must never be cached there.
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.param('id', (_req, res, next, id) => (/^\d+$/.test(id) ? next() : res.status(404).json({ error: 'Not found' })));

  const sendIndex = (_req, res) => res.set('Cache-Control', 'no-cache').type('html').send(indexHtml);
  app.get(['/', '/index.html'], sendIndex);
  app.use(express.static(PUBLIC_DIR, { index: false }));

  // ── Uploads (contracts are team-only) ───────────────────────
  app.get('/uploads/:kind/:file', route(async (req, res) => {
    const parsed = parseUploadUrl(`/uploads/${req.params.kind}/${req.params.file}`);
    if (!parsed) return res.status(404).json({ error: 'Not found' });
    const isPrivate = parsed.kind === 'contracts';
    if (isPrivate && !req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (isPrivate && req.user.role !== 'team') return res.status(403).json({ error: 'Team access required' });
    const body = await mediaStore.read(parsed.key);
    if (!body) return res.status(404).json({ error: 'Not found' });
    res.set(responseHeaders(parsed.key, { isPrivate })).send(body);
  }));

  // ── Auth ────────────────────────────────────────────────────
  app.get('/team', auth.teamSignIn);

  app.post('/api/auth/influencer-login', route(async (req, res) => {
    const { email, password } = req.body;
    const influencer = await one('SELECT * FROM influencers WHERE email = $1', [email]);
    if (!influencer) return res.status(401).json({ error: 'Invalid credentials' });
    if (influencer.status !== 'approved') return res.status(403).json({ error: 'Account pending approval' });
    if (!influencer.password_hash) return res.status(401).json({ error: 'Password not set. Please contact the Lovepop team.' });
    if (!bcrypt.compareSync(String(password || ''), influencer.password_hash)) return res.status(401).json({ error: 'Invalid credentials' });
    auth.setInfluencerSession(res, influencer);
    res.json({ name: influencer.name, role: 'influencer', id: influencer.id });
  }));

  app.post('/api/auth/logout', (_req, res) => { auth.clearSessions(res); res.json({ success: true }); });

  app.get('/api/auth/me', requireUser, (req, res) => res.json(req.user));

  // ── Signup (public) ─────────────────────────────────────────
  app.post('/api/signup', route(async (req, res) => {
    const {
      name, email, phone,
      instagram, tiktok, youtube, linkedin,
      instagram_followers, tiktok_followers, youtube_followers, linkedin_followers,
      why_lovepop, age_range, audience_description,
    } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
    const duplicate = { error: 'An application with this email already exists' };
    if (await one('SELECT id FROM influencers WHERE email = $1', [email])) return res.status(409).json(duplicate);
    try {
      const created = await one(`
        INSERT INTO influencers (name, email, phone, instagram, tiktok, youtube, linkedin,
          instagram_followers, tiktok_followers, youtube_followers, linkedin_followers,
          why_lovepop, age_range, audience_description, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending') RETURNING id`, [
        name, email, phone || '',
        instagram || '', tiktok || '', youtube || '', linkedin || '',
        intOr(instagram_followers, 0), intOr(tiktok_followers, 0), intOr(youtube_followers, 0), intOr(linkedin_followers, 0),
        why_lovepop || '', age_range || '', audience_description || '',
      ]);
      res.json({ success: true, id: created.id });
    } catch (error) {
      if (error.code === PG_UNIQUE_VIOLATION) return res.status(409).json(duplicate);
      throw error;
    }
  }));

  // ── Influencers (team manages) ──────────────────────────────
  app.get('/api/influencers', teamOnly, route(async (req, res) => {
    const { status, search } = req.query;
    let sql = 'SELECT * FROM influencers WHERE 1=1';
    const params = [];
    if (status && status !== 'all') { params.push(status); sql += ` AND status = $${params.length}`; }
    if (search) { params.push(`%${search}%`); sql += ` AND (name ILIKE $${params.length} OR email ILIKE $${params.length} OR instagram ILIKE $${params.length})`; }
    sql += ' ORDER BY created_at DESC, id DESC';
    res.json((await q(sql, params)).map(withInfluencerLists));
  }));

  app.get('/api/influencers/:id', requireUser, route(async (req, res) => {
    const id = Number(req.params.id);
    if (req.user.role === 'influencer' && req.user.id !== id) return res.status(403).json({ error: 'Forbidden' });
    const influencer = await one('SELECT * FROM influencers WHERE id = $1', [id]);
    if (!influencer) return res.status(404).json({ error: 'Not found' });
    const contacts = await q('SELECT * FROM influencer_contacts WHERE influencer_id = $1 ORDER BY id', [id]);
    res.json({ ...withInfluencerLists(influencer), contacts });
  }));

  app.put('/api/influencers/:id', teamOnly, route(async (req, res) => {
    const {
      name, email, phone, instagram, tiktok, youtube, linkedin,
      instagram_followers, tiktok_followers, youtube_followers, linkedin_followers,
      why_lovepop, age_range, audience_description, status, password,
      lovepop_contacts, notes, contracts, contacts,
    } = req.body;
    const id = Number(req.params.id);
    const influencer = await one('SELECT * FROM influencers WHERE id = $1', [id]);
    if (!influencer) return res.status(404).json({ error: 'Not found' });
    const passwordHash = password ? bcrypt.hashSync(password, 10) : influencer.password_hash;
    await q(`
      UPDATE influencers SET
        name=$1, email=$2, phone=$3, instagram=$4, tiktok=$5, youtube=$6, linkedin=$7,
        instagram_followers=$8, tiktok_followers=$9, youtube_followers=$10, linkedin_followers=$11,
        why_lovepop=$12, age_range=$13, audience_description=$14, status=$15, password_hash=$16,
        lovepop_contacts=$17, notes=$18, contracts=$19, updated_at=now()
      WHERE id=$20`, [
      name || influencer.name,
      email || influencer.email,
      phone ?? influencer.phone,
      instagram ?? influencer.instagram,
      tiktok ?? influencer.tiktok,
      youtube ?? influencer.youtube,
      linkedin ?? influencer.linkedin,
      intOr(instagram_followers, 0) || influencer.instagram_followers,
      intOr(tiktok_followers, 0) || influencer.tiktok_followers,
      intOr(youtube_followers, 0) || influencer.youtube_followers,
      intOr(linkedin_followers, 0) || influencer.linkedin_followers,
      why_lovepop ?? influencer.why_lovepop,
      age_range ?? influencer.age_range,
      audience_description ?? influencer.audience_description,
      status || influencer.status,
      passwordHash,
      JSON.stringify(lovepop_contacts || parseList(influencer.lovepop_contacts)),
      JSON.stringify(notes || parseList(influencer.notes)),
      JSON.stringify(contracts || parseList(influencer.contracts)),
      id,
    ]);
    if (contacts !== undefined) {
      await q('DELETE FROM influencer_contacts WHERE influencer_id = $1', [id]);
      for (const contact of contacts) {
        await q(`INSERT INTO influencer_contacts (influencer_id, name, email, phone, role, active) VALUES ($1,$2,$3,$4,$5,$6)`,
          [id, contact.name || '', contact.email || '', contact.phone || '', contact.role || '', contact.active ? 1 : 0]);
      }
    }
    res.json({ success: true });
  }));

  // Self-update profile (influencer updating their own record; team can edit anyone)
  app.put('/api/influencers/:id/profile', requireUser, route(async (req, res) => {
    const id = Number(req.params.id);
    const influencer = await one('SELECT * FROM influencers WHERE id = $1', [id]);
    if (!influencer) return res.status(404).json({ error: 'Not found' });
    if (req.user.role !== 'team' && req.user.id !== influencer.id) return res.status(403).json({ error: 'Forbidden' });
    const {
      name, email, phone,
      instagram, tiktok, youtube, linkedin,
      instagram_followers, tiktok_followers, youtube_followers, linkedin_followers,
      age_range, audience_description, why_lovepop,
      new_password,
    } = req.body;
    if (email && email !== influencer.email && await one('SELECT id FROM influencers WHERE email = $1 AND id <> $2', [email, id])) {
      return res.status(400).json({ error: 'That email is already in use.' });
    }
    const passwordHash = new_password && new_password.length >= MIN_PASSWORD_LENGTH ? bcrypt.hashSync(new_password, 10) : influencer.password_hash;
    const followers = (value, current) => { const n = intOr(value, -1); return n >= 0 ? n : current; };
    await q(`
      UPDATE influencers SET
        name=$1, email=$2, phone=$3,
        instagram=$4, tiktok=$5, youtube=$6, linkedin=$7,
        instagram_followers=$8, tiktok_followers=$9, youtube_followers=$10, linkedin_followers=$11,
        age_range=$12, audience_description=$13, why_lovepop=$14,
        password_hash=$15, updated_at=now()
      WHERE id=$16`, [
      name ?? influencer.name,
      email ?? influencer.email,
      phone ?? influencer.phone,
      instagram ?? influencer.instagram,
      tiktok ?? influencer.tiktok,
      youtube ?? influencer.youtube,
      linkedin ?? influencer.linkedin,
      followers(instagram_followers, influencer.instagram_followers),
      followers(tiktok_followers, influencer.tiktok_followers),
      followers(youtube_followers, influencer.youtube_followers),
      followers(linkedin_followers, influencer.linkedin_followers),
      age_range ?? influencer.age_range,
      audience_description ?? influencer.audience_description,
      why_lovepop ?? influencer.why_lovepop,
      passwordHash,
      id,
    ]);
    res.json({ success: true });
  }));

  app.post('/api/influencers/:id/approve', teamOnly, route(async (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required for approval' });
    await q(`UPDATE influencers SET status='approved', password_hash=$1, updated_at=now() WHERE id=$2`, [bcrypt.hashSync(password, 10), Number(req.params.id)]);
    res.json({ success: true });
  }));

  app.post('/api/influencers/:id/reject', teamOnly, route(async (req, res) => {
    await q(`UPDATE influencers SET status='rejected', updated_at=now() WHERE id=$1`, [Number(req.params.id)]);
    res.json({ success: true });
  }));

  app.post('/api/influencers/:id/contract', teamOnly, upload.single('file'), route(async (req, res) => {
    const id = Number(req.params.id);
    const influencer = await one('SELECT * FROM influencers WHERE id = $1', [id]);
    if (!influencer) return res.status(404).json({ error: 'Not found' });
    if (!req.file) return res.status(400).json({ error: 'File required' });
    const contracts = parseList(influencer.contracts);
    contracts.push({ filename: req.file.originalname, path: await mediaStore.save('contracts', req.file.originalname, req.file.buffer), uploaded_at: new Date().toISOString() });
    await q(`UPDATE influencers SET contracts=$1, updated_at=now() WHERE id=$2`, [JSON.stringify(contracts), id]);
    res.json({ success: true, contracts });
  }));

  app.post('/api/influencers/:id/notes', teamOnly, route(async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Note text required' });
    const id = Number(req.params.id);
    const influencer = await one('SELECT * FROM influencers WHERE id = $1', [id]);
    if (!influencer) return res.status(404).json({ error: 'Not found' });
    const notes = parseList(influencer.notes);
    notes.unshift({ text, author: req.user.name, timestamp: new Date().toISOString() });
    await q(`UPDATE influencers SET notes=$1, updated_at=now() WHERE id=$2`, [JSON.stringify(notes), id]);
    res.json({ success: true, notes });
  }));

  // ── Campaigns ───────────────────────────────────────────────
  app.get('/api/campaigns', requireUser, route(async (_req, res) => {
    res.json((await q('SELECT * FROM campaigns ORDER BY created_at DESC, id DESC')).map(withCampaignLists));
  }));

  app.get('/api/campaigns/:id', requireUser, route(async (req, res) => {
    const campaign = await one('SELECT * FROM campaigns WHERE id = $1', [Number(req.params.id)]);
    if (!campaign) return res.status(404).json({ error: 'Not found' });
    res.json(withCampaignLists(campaign));
  }));

  app.post('/api/campaigns', teamOnly, route(async (req, res) => {
    const { name, description, objectives, start_date, end_date, status_override, success_metrics, product_bundles, sku_designations } = req.body;
    if (!name) return res.status(400).json({ error: 'Campaign name required' });
    const created = await one(`
      INSERT INTO campaigns (name, description, objectives, start_date, end_date, status_override, success_metrics, product_bundles, sku_designations)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [
      name, description || '', objectives || '', start_date || '', end_date || '',
      status_override || '', success_metrics || '',
      JSON.stringify(product_bundles || []), JSON.stringify(sku_designations || []),
    ]);
    res.json({ success: true, id: created.id });
  }));

  app.put('/api/campaigns/:id', teamOnly, route(async (req, res) => {
    const id = Number(req.params.id);
    const campaign = await one('SELECT * FROM campaigns WHERE id = $1', [id]);
    if (!campaign) return res.status(404).json({ error: 'Not found' });
    const { name, description, objectives, start_date, end_date, status_override, success_metrics, product_bundles, sku_designations } = req.body;
    await q(`
      UPDATE campaigns SET name=$1, description=$2, objectives=$3, start_date=$4, end_date=$5,
        status_override=$6, success_metrics=$7, product_bundles=$8, sku_designations=$9, updated_at=now()
      WHERE id=$10`, [
      name ?? campaign.name, description ?? campaign.description, objectives ?? campaign.objectives,
      start_date ?? campaign.start_date, end_date ?? campaign.end_date, status_override ?? campaign.status_override,
      success_metrics ?? campaign.success_metrics,
      JSON.stringify(product_bundles ?? parseList(campaign.product_bundles)),
      JSON.stringify(sku_designations ?? parseList(campaign.sku_designations)),
      id,
    ]);
    res.json({ success: true });
  }));

  app.delete('/api/campaigns/:id', teamOnly, route(async (req, res) => {
    await q('DELETE FROM campaigns WHERE id = $1', [Number(req.params.id)]);
    res.json({ success: true });
  }));

  app.post('/api/campaigns/:id/images', teamOnly, upload.single('file'), route(async (req, res) => {
    const id = Number(req.params.id);
    const campaign = await one('SELECT * FROM campaigns WHERE id = $1', [id]);
    if (!campaign) return res.status(404).json({ error: 'Not found' });
    if (!req.file) return res.status(400).json({ error: 'File required' });
    const assets = parseList(campaign.image_assets);
    assets.push({ filename: req.file.originalname, path: await mediaStore.save('campaigns', req.file.originalname, req.file.buffer), uploaded_at: new Date().toISOString() });
    await q(`UPDATE campaigns SET image_assets=$1, updated_at=now() WHERE id=$2`, [JSON.stringify(assets), id]);
    res.json({ success: true, image_assets: assets });
  }));

  // ── Post submissions ────────────────────────────────────────
  app.get('/api/posts', requireUser, route(async (req, res) => {
    if (req.user.role === 'influencer') {
      return res.json(await q(`
        SELECT ps.*, c.name AS campaign_name FROM post_submissions ps LEFT JOIN campaigns c ON ps.campaign_id = c.id
        WHERE ps.influencer_id = $1 ORDER BY ps.created_at DESC, ps.id DESC`, [req.user.id]));
    }
    const { influencer_id, status } = req.query;
    let sql = `SELECT ps.*, i.name AS influencer_name, c.name AS campaign_name FROM post_submissions ps
      LEFT JOIN influencers i ON ps.influencer_id = i.id LEFT JOIN campaigns c ON ps.campaign_id = c.id WHERE 1=1`;
    const params = [];
    if (influencer_id) { params.push(intOr(influencer_id, 0)); sql += ` AND ps.influencer_id = $${params.length}`; }
    if (status) { params.push(status); sql += ` AND ps.status = $${params.length}`; }
    sql += ' ORDER BY ps.created_at DESC, ps.id DESC';
    res.json(await q(sql, params));
  }));

  app.post('/api/posts', requireUser, upload.single('screenshot'), route(async (req, res) => {
    const influencerId = req.user.role === 'influencer' ? req.user.id : intOr(req.body.influencer_id, null);
    const { campaign_id, platform, post_url, date_posted, impressions, notes } = req.body;
    if (!platform) return res.status(400).json({ error: 'Platform required' });
    const screenshotPath = req.file ? await mediaStore.save('posts', req.file.originalname, req.file.buffer) : '';
    const created = await one(`
      INSERT INTO post_submissions (influencer_id, campaign_id, platform, post_url, screenshot_path, date_posted, impressions, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [
      influencerId, intOr(campaign_id, null), platform, post_url || '',
      screenshotPath, date_posted || new Date().toISOString().split('T')[0],
      intOr(impressions, 0), notes || '',
    ]);
    res.json({ success: true, id: created.id });
  }));

  app.put('/api/posts/:id', teamOnly, route(async (req, res) => {
    const id = Number(req.params.id);
    const post = await one('SELECT * FROM post_submissions WHERE id = $1', [id]);
    if (!post) return res.status(404).json({ error: 'Not found' });
    const { status, impressions, notes } = req.body;
    await q(`UPDATE post_submissions SET status=$1, impressions=$2, notes=$3, updated_at=now() WHERE id=$4`,
      [status ?? post.status, intOr(impressions, post.impressions), notes ?? post.notes, id]);
    if (status) await updateInfluencerStats(post.influencer_id);
    res.json({ success: true });
  }));

  app.delete('/api/posts/:id', requireUser, route(async (req, res) => {
    const id = Number(req.params.id);
    const post = await one('SELECT * FROM post_submissions WHERE id = $1', [id]);
    if (!post) return res.status(404).json({ error: 'Not found' });
    if (req.user.role === 'influencer' && req.user.id !== post.influencer_id) return res.status(403).json({ error: 'Forbidden' });
    await q('DELETE FROM post_submissions WHERE id = $1', [id]);
    await updateInfluencerStats(post.influencer_id);
    res.json({ success: true });
  }));

  // ── Stats ───────────────────────────────────────────────────
  app.get('/api/stats/overview', teamOnly, route(async (_req, res) => {
    const today = `to_char(current_date, 'YYYY-MM-DD')`;
    const stats = await one(`
      SELECT
        (SELECT COUNT(*)::int FROM influencers WHERE status = 'approved') AS "totalInfluencers",
        (SELECT COUNT(*)::int FROM influencers WHERE status = 'pending') AS "pendingInfluencers",
        (SELECT COUNT(*)::int FROM post_submissions WHERE status = 'approved') AS "totalPosts",
        (SELECT COALESCE(SUM(impressions), 0)::int FROM post_submissions WHERE status = 'approved') AS "totalImpressions",
        (SELECT COUNT(*)::int FROM campaigns WHERE status_override = 'live'
           OR (status_override = '' AND start_date <= ${today} AND (end_date >= ${today} OR end_date = ''))) AS "activeCampaigns"`);
    res.json(stats);
  }));

  // ── SPA fallback: every non-API GET serves the page ─────────
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.get('*', sendIndex);

  app.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError) return res.status(400).json({ error: error.message });
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  });
  return app;
}
