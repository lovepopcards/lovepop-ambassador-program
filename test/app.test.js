// The app end to end on an embedded PGlite database, in the admin.lovepop.com/ambassador shape:
// BASE_PATH, team SSO tickets, influencer cookie sessions, uploads. Hermetic: no network.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { closeDb, initDb, one } from '../server/db.js';
import { createApp } from '../server/app.js';
import { authConfigProblems } from '../server/auth.js';
import { createMediaStore } from '../server/mediaStore.js';

const BASE = '/ambassador';
const TICKET_SECRET = 'test-ticket-secret';
const AUDIENCE = 'https://admin.lovepop.com';
const AUTHORIZE_URL = 'https://authentication.lovepopcards.com/sso/authorize';
const PROD_ENV = {
  NODE_ENV: 'production',
  BASE_PATH: BASE,
  AUTH_MODE: 'sso',
  APP_URL: `https://admin.lovepop.com${BASE}`,
  SSO_TICKET_SECRET: TICKET_SECRET,
  SSO_TICKET_AUDIENCE: AUDIENCE,
  SSO_AUTHORIZE_URL: AUTHORIZE_URL,
  TEAM_SESSION_SECRET: 't'.repeat(40),
  INFLUENCER_SESSION_SECRET: 'i'.repeat(40),
  APP_COMMIT: 'abc123',
};
// What anyone could sign with on Railway: the default secret that sat in server.js.
const LEAKED_DEFAULT_SECRET = 'lovepop-ambassador-secret-2024';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ambassador-test-'));
process.env.PGLITE_DIR = path.join(tmpDir, 'pglite');
delete process.env.DATABASE_URL;

const ticket = (claims = {}, { secret = TICKET_SECRET, audience = AUDIENCE, expiresIn = '60s' } = {}) =>
  jwt.sign({ email: 'pat@lovepopcards.com', providerId: 'google-123', name: 'Pat Team', ...claims }, secret, { algorithm: 'HS256', audience, expiresIn });

let server;
let origin;
const request = (urlPath, { cookie, headers = {}, ...opts } = {}) =>
  fetch(`${origin}${urlPath}`, { redirect: 'manual', ...opts, headers: { ...headers, ...(cookie ? { cookie } : {}) } });
const json = (urlPath, body, opts = {}) => request(urlPath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...opts });
const cookieOf = (res) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const returnToOf = (res) => new URL(res.headers.get('location')).searchParams.get('return_to');
const form = (fields, file) => {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  if (file) body.append(file.field, new Blob([file.bytes]), file.name);
  return body;
};

let teamCookie;
async function signInTeam() {
  const res = await request(`${BASE}/team?sso_ticket=${encodeURIComponent(ticket())}`);
  assert.equal(res.status, 302);
  return cookieOf(res);
}

async function createApprovedInfluencer(email, password) {
  const signup = await json(`${BASE}/api/signup`, { name: email.split('@')[0], email, instagram: '@x', instagram_followers: '1200' });
  assert.equal(signup.status, 200);
  const { id } = await signup.json();
  assert.equal((await json(`${BASE}/api/influencers/${id}/approve`, { password }, { cookie: teamCookie })).status, 200);
  const login = await json(`${BASE}/api/auth/influencer-login`, { email, password });
  assert.equal(login.status, 200);
  return { id, cookie: cookieOf(login) };
}

before(async () => {
  await initDb();
  server = createApp({ env: PROD_ENV, mediaStore: createMediaStore({ dir: path.join(tmpDir, 'uploads') }) }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  teamCookie = await signInTeam();
});
after(async () => {
  server?.close();
  await closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('authConfigProblems (refuses to start open when deployed)', () => {
  test('local dev needs nothing', () => assert.deepEqual(authConfigProblems({}), []));
  test('the full production config passes', () => assert.deepEqual(authConfigProblems(PROD_ENV), []));
  test('dev mode is refused behind BASE_PATH and in production', () => {
    assert.match(authConfigProblems({ ...PROD_ENV, AUTH_MODE: 'dev' }).join(), /must be "sso"/);
    assert.match(authConfigProblems({ NODE_ENV: 'production' }).join(), /must be "sso"/);
  });
  test('each missing setting is reported', () => {
    for (const name of ['SSO_TICKET_SECRET', 'SSO_TICKET_AUDIENCE', 'SSO_AUTHORIZE_URL', 'TEAM_SESSION_SECRET', 'INFLUENCER_SESSION_SECRET']) {
      assert.ok(authConfigProblems({ ...PROD_ENV, [name]: '' }).some((p) => p.startsWith(name)), name);
    }
  });
  test('short, built-in or shared session secrets are refused', () => {
    assert.ok(authConfigProblems({ ...PROD_ENV, TEAM_SESSION_SECRET: 'short' }).length);
    assert.ok(authConfigProblems({ ...PROD_ENV, INFLUENCER_SESSION_SECRET: 'dev-only-influencer-session-secret' }).length);
    assert.match(authConfigProblems({ ...PROD_ENV, INFLUENCER_SESSION_SECRET: PROD_ENV.TEAM_SESSION_SECRET }).join(), /must differ/);
  });
});

describe('public pages', () => {
  test('/healthz is public and unprefixed (ALB target check)', async () => {
    const res = await request('/healthz');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, auth: 'sso', commit: 'abc123' });
  });
  test('the landing page is public and every asset URL carries BASE_PATH', async () => {
    for (const urlPath of [`${BASE}/`, BASE, `${BASE}/some/deep/link`]) {
      const res = await request(urlPath);
      assert.equal(res.status, 200, urlPath);
      const html = await res.text();
      assert.ok(html.includes(`href="${BASE}/style.css"`));
      assert.ok(html.includes(`src="${BASE}/app.js"`));
      assert.ok(html.includes(`window.BASE_PATH = "${BASE}"`));
      assert.ok(html.includes(`href="${BASE}/team"`));
      assert.ok(!html.includes('%BASE_PATH'));
    }
  });
  test('static assets are served under BASE_PATH', async () => {
    assert.equal((await request(`${BASE}/app.js`)).status, 200);
    assert.equal((await request(`${BASE}/style.css`)).status, 200);
  });
  test('a fresh database is empty: no demo data is seeded on boot', async () => {
    assert.equal((await one('SELECT COUNT(*)::int AS n FROM campaigns')).n, 0);
  });
});

describe('team sign-in (conan SSO)', () => {
  test('/team without a session goes to the broker with the public return URL', async () => {
    const res = await request(`${BASE}/team`);
    assert.equal(res.status, 302);
    assert.ok(res.headers.get('location').startsWith(`${AUTHORIZE_URL}?return_to=`));
    assert.equal(returnToOf(res), `https://admin.lovepop.com${BASE}/team`);
  });
  test('a valid ticket sets an httpOnly team cookie on BASE_PATH and lands on the app', async () => {
    const res = await request(`${BASE}/team?sso_ticket=${encodeURIComponent(ticket())}`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), `${BASE}/`);
    const setCookie = res.headers.getSetCookie().join(';');
    assert.match(setCookie, /ambassador_team=/);
    assert.match(setCookie, new RegExp(`Path=${BASE}`));
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /Secure/);
  });
  test('the team session reaches team routes and names the person', async () => {
    const me = await request(`${BASE}/api/auth/me`, { cookie: teamCookie });
    assert.deepEqual(await me.json(), { role: 'team', name: 'Pat Team', email: 'pat@lovepopcards.com' });
    assert.equal((await request(`${BASE}/api/influencers`, { cookie: teamCookie })).status, 200);
    assert.equal((await request(`${BASE}/api/stats/overview`, { cookie: teamCookie })).status, 200);
  });
  test('forged, expired and wrong-audience tickets go back to the broker', async () => {
    for (const bad of [ticket({}, { secret: 'wrong' }), ticket({}, { expiresIn: '-1s' }), ticket({}, { audience: 'https://evil.example' })]) {
      const res = await request(`${BASE}/team?sso_ticket=${encodeURIComponent(bad)}`);
      assert.equal(res.status, 302);
      assert.ok(res.headers.get('location').startsWith(AUTHORIZE_URL));
      assert.equal(res.headers.getSetCookie().length, 0);
    }
  });
  test('a ticket for a non-Lovepop account is refused', async () => {
    const res = await request(`${BASE}/team?sso_ticket=${encodeURIComponent(ticket({ email: 'someone@gmail.com' }))}`);
    assert.equal(res.status, 403);
    assert.equal(res.headers.getSetCookie().length, 0);
  });
  test('the old team password login is gone', async () => {
    assert.equal((await json(`${BASE}/api/auth/team-login`, { username: 'admin', password: 'lovepop2024' })).status, 404);
  });
});

describe('the Railway exploit is closed', () => {
  const forged = jwt.sign({ role: 'team', name: 'Admin User', username: 'admin' }, LEAKED_DEFAULT_SECRET);
  test('a team token signed with the leaked default secret is refused as a bearer token', async () => {
    assert.equal((await request(`${BASE}/api/influencers`, { headers: { authorization: `Bearer ${forged}` } })).status, 401);
  });
  test('…and as either session cookie', async () => {
    for (const name of ['ambassador_team', 'ambassador_influencer']) {
      assert.equal((await request(`${BASE}/api/influencers`, { cookie: `${name}=${forged}` })).status, 401, name);
    }
  });
  test('an influencer cookie can never act as the team', async () => {
    const teamClaimsWithInfluencerSecret = jwt.sign({ role: 'team', email: 'x@lovepopcards.com' }, PROD_ENV.INFLUENCER_SESSION_SECRET);
    assert.equal((await request(`${BASE}/api/influencers`, { cookie: `ambassador_team=${teamClaimsWithInfluencerSecret}` })).status, 401);
  });
  test('every team route refuses an anonymous caller', async () => {
    for (const urlPath of ['/api/influencers', '/api/stats/overview', '/api/posts', '/api/campaigns', '/api/auth/me']) {
      const res = await request(`${BASE}${urlPath}`);
      assert.equal(res.status, 401, urlPath);
      assert.equal(res.headers.get('cache-control'), 'no-store');
    }
  });
});

describe('influencer journey', () => {
  let influencer;
  before(async () => { influencer = await createApprovedInfluencer('ava@example.com', 'secret-ava'); });

  test('signup is public; a duplicate email is refused', async () => {
    const res = await json(`${BASE}/api/signup`, { name: 'Ava', email: 'ava@example.com' });
    assert.equal(res.status, 409);
    assert.equal((await json(`${BASE}/api/signup`, { name: '' })).status, 400);
  });
  test('a pending applicant cannot sign in; a wrong password is refused', async () => {
    await json(`${BASE}/api/signup`, { name: 'Pending', email: 'pending@example.com' });
    assert.equal((await json(`${BASE}/api/auth/influencer-login`, { email: 'pending@example.com', password: 'x' })).status, 403);
    assert.equal((await json(`${BASE}/api/auth/influencer-login`, { email: 'ava@example.com', password: 'nope' })).status, 401);
  });
  test('the login sets an httpOnly cookie, not a token in the body', async () => {
    const res = await json(`${BASE}/api/auth/influencer-login`, { email: 'ava@example.com', password: 'secret-ava' });
    const body = await res.json();
    assert.equal(body.token, undefined);
    assert.equal(body.role, 'influencer');
    assert.match(res.headers.getSetCookie().join(';'), /ambassador_influencer=.*HttpOnly/);
  });
  test('an influencer sees their own profile, not someone else’s, and no team routes', async () => {
    const other = await createApprovedInfluencer('ben@example.com', 'secret-ben');
    assert.equal((await request(`${BASE}/api/influencers/${influencer.id}`, { cookie: influencer.cookie })).status, 200);
    assert.equal((await request(`${BASE}/api/influencers/${other.id}`, { cookie: influencer.cookie })).status, 403);
    assert.equal((await request(`${BASE}/api/influencers`, { cookie: influencer.cookie })).status, 403);
    assert.equal((await request(`${BASE}/api/stats/overview`, { cookie: influencer.cookie })).status, 403);
  });
  test('a non-numeric id is a 404, not a database error', async () => {
    assert.equal((await request(`${BASE}/api/influencers/abc`, { cookie: teamCookie })).status, 404);
  });
  test('post with screenshot → team approves → stats and tier update', async () => {
    const created = await request(`${BASE}/api/posts`, {
      method: 'POST', cookie: influencer.cookie,
      body: form({ platform: 'Instagram', post_url: 'https://instagram.com/p/1', impressions: '250000' }, { field: 'screenshot', name: 'shot.png', bytes: PNG }),
    });
    assert.equal(created.status, 200);
    const posts = await (await request(`${BASE}/api/posts`, { cookie: influencer.cookie })).json();
    assert.equal(posts.length, 1);
    assert.match(posts[0].screenshot_path, /^\/uploads\/posts\/\d+-[0-9a-f]{16}\.png$/);

    // The frontend sends only { status }; impressions must survive (parseInt(undefined) is NaN).
    assert.equal((await request(`${BASE}/api/posts/${posts[0].id}`, { method: 'PUT', cookie: teamCookie, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'approved' }) })).status, 200);
    const [approved] = await (await request(`${BASE}/api/posts?influencer_id=${influencer.id}`, { cookie: teamCookie })).json();
    assert.equal(approved.status, 'approved');
    assert.equal(approved.impressions, 250000);
    const profile = await (await request(`${BASE}/api/influencers/${influencer.id}`, { cookie: teamCookie })).json();
    assert.equal(profile.total_posts, 1);
    assert.equal(profile.total_impressions, 250000);
    assert.equal(profile.tier, 'silver');
    const stats = await (await request(`${BASE}/api/stats/overview`, { cookie: teamCookie })).json();
    assert.equal(stats.totalPosts, 1);
    assert.equal(stats.totalImpressions, 250000);

    const screenshot = await request(`${BASE}${posts[0].screenshot_path}`);
    assert.equal(screenshot.status, 200);
    assert.equal(screenshot.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await screenshot.arrayBuffer()), PNG);
  });
  test('an influencer edits their own profile; search is case-insensitive', async () => {
    const res = await request(`${BASE}/api/influencers/${influencer.id}/profile`, { method: 'PUT', cookie: influencer.cookie, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '555-0100', tiktok_followers: '9000' }) });
    assert.equal(res.status, 200);
    const [found] = await (await request(`${BASE}/api/influencers?search=AVA`, { cookie: teamCookie })).json();
    assert.equal(found.phone, '555-0100');
    assert.equal(found.tiktok_followers, 9000);
    assert.equal(found.instagram_followers, 1200);
  });
  test('logout clears both session cookies', async () => {
    const res = await request(`${BASE}/api/auth/logout`, { method: 'POST', cookie: influencer.cookie });
    const cleared = res.headers.getSetCookie().join(';');
    assert.match(cleared, /ambassador_team=;/);
    assert.match(cleared, /ambassador_influencer=;/);
  });
});

describe('campaigns and notes', () => {
  test('team creates, edits and deletes a campaign; notes carry the SSO name', async () => {
    const { id } = await (await json(`${BASE}/api/campaigns`, { name: 'Spring', start_date: '2020-01-01', end_date: '', product_bundles: [{ name: 'B' }] }, { cookie: teamCookie })).json();
    const list = await (await request(`${BASE}/api/campaigns`, { cookie: teamCookie })).json();
    assert.equal(list[0].computed_status, 'live');
    assert.deepEqual(list[0].product_bundles, [{ name: 'B' }]);
    assert.equal((await request(`${BASE}/api/campaigns/${id}`, { method: 'PUT', cookie: teamCookie, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status_override: 'closed' }) })).status, 200);
    assert.equal((await (await request(`${BASE}/api/campaigns/${id}`, { cookie: teamCookie })).json()).computed_status, 'closed');
    assert.equal((await request(`${BASE}/api/campaigns/${id}`, { method: 'DELETE', cookie: teamCookie })).status, 200);
    assert.equal((await request(`${BASE}/api/campaigns/${id}`, { cookie: teamCookie })).status, 404);

    const { id: influencerId } = await (await json(`${BASE}/api/signup`, { name: 'Noted', email: 'noted@example.com' })).json();
    const { notes } = await (await json(`${BASE}/api/influencers/${influencerId}/notes`, { text: 'hello' }, { cookie: teamCookie })).json();
    assert.equal(notes[0].author, 'Pat Team');
  });
  test('a campaign image is public; an influencer cannot create campaigns', async () => {
    const { id } = await (await json(`${BASE}/api/campaigns`, { name: 'With image' }, { cookie: teamCookie })).json();
    const res = await request(`${BASE}/api/campaigns/${id}/images`, { method: 'POST', cookie: teamCookie, body: form({}, { field: 'file', name: 'hero.PNG', bytes: PNG }) });
    const { image_assets } = await res.json();
    assert.match(image_assets[0].path, /^\/uploads\/campaigns\/.+\.png$/);
    const image = await request(`${BASE}${image_assets[0].path}`);
    assert.equal(image.status, 200);
    assert.match(image.headers.get('cache-control'), /public/);
    const influencer = await createApprovedInfluencer('cara@example.com', 'secret-cara');
    assert.equal((await json(`${BASE}/api/campaigns`, { name: 'Nope' }, { cookie: influencer.cookie })).status, 403);
  });
});

describe('contracts and unsafe uploads', () => {
  let contractPath;
  let influencer;
  before(async () => {
    influencer = await createApprovedInfluencer('dan@example.com', 'secret-dan');
    const res = await request(`${BASE}/api/influencers/${influencer.id}/contract`, { method: 'POST', cookie: teamCookie, body: form({}, { field: 'file', name: 'Agreement.pdf', bytes: Buffer.from('%PDF-1.4') }) });
    contractPath = (await res.json()).contracts[0].path;
  });
  test('a contract is stored under contracts/ with an unguessable name', () => {
    assert.match(contractPath, /^\/uploads\/contracts\/\d+-[0-9a-f]{16}\.pdf$/);
  });
  test('only the team can read a contract, and it is never cacheable', async () => {
    assert.equal((await request(`${BASE}${contractPath}`)).status, 401);
    assert.equal((await request(`${BASE}${contractPath}`, { cookie: influencer.cookie })).status, 403);
    const res = await request(`${BASE}${contractPath}`, { cookie: teamCookie });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
  });
  test('an uploaded HTML or SVG file downloads instead of rendering', async () => {
    for (const name of ['evil.html', 'evil.svg']) {
      const created = await request(`${BASE}/api/posts`, { method: 'POST', cookie: influencer.cookie, body: form({ platform: 'TikTok' }, { field: 'screenshot', name, bytes: Buffer.from('<script>alert(1)</script>') }) });
      assert.equal(created.status, 200);
    }
    const posts = await (await request(`${BASE}/api/posts`, { cookie: influencer.cookie })).json();
    for (const post of posts.filter((p) => /\.(html|svg)$/.test(p.screenshot_path))) {
      const res = await request(`${BASE}${post.screenshot_path}`);
      assert.equal(res.headers.get('content-type'), 'application/octet-stream');
      assert.match(res.headers.get('content-disposition'), /^attachment/);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    }
  });
  test('upload paths outside the store are 404', async () => {
    for (const urlPath of ['/uploads/posts/..%2F..%2Fpackage.json', '/uploads/other/1-0123456789abcdef.png', '/uploads/posts/notours.png', '/uploads/posts/1-0123456789abcdef.png']) {
      assert.equal((await request(`${BASE}${urlPath}`, { cookie: teamCookie })).status, 404, urlPath);
    }
  });
});
