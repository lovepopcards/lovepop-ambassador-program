// Two kinds of user, two sessions (both httpOnly cookies scoped to BASE_PATH):
//   team        — Lovepop staff. GET /team runs the conan-edogawa SSO round trip (Google, Lovepop
//                 domains only) and sets `ambassador_team`. AUTH_MODE=dev signs in a local dev user
//                 instead, and is refused behind BASE_PATH or in production.
//   influencer  — outside creators. Email + bcrypt password (POST /api/auth/influencer-login) sets
//                 `ambassador_influencer`. They have no Lovepop Google account, so this stays in the app.
// Each session is signed with its own secret and carries its role, so one can never pass as the other.
import jwt from 'jsonwebtoken';

const TEAM_COOKIE = 'ambassador_team';
const INFLUENCER_COOKIE = 'ambassador_influencer';
const TEAM_SESSION_HOURS = 12;
const INFLUENCER_SESSION_DAYS = 7;
const DEV_SECRETS = { team: 'dev-only-team-session-secret', influencer: 'dev-only-influencer-session-secret' };
const MIN_SECRET_LENGTH = 32;
const DEFAULT_ALLOWED_DOMAINS = 'lovepopcards.com,lovepopvn.com,lovepop.com';
const SSO_SETTINGS = ['SSO_TICKET_SECRET', 'SSO_TICKET_AUDIENCE', 'SSO_AUTHORIZE_URL'];
const SESSION_SECRETS = ['TEAM_SESSION_SECRET', 'INFLUENCER_SESSION_SECRET'];

export const authModeOf = (env) => env.AUTH_MODE || (env.SSO_TICKET_SECRET ? 'sso' : 'dev');

// Behind admin.lovepop.com (BASE_PATH set) or in production only the SSO gate may run, with real
// secrets. Returns what is wrong; server/index.js refuses to start if anything is.
export function authConfigProblems(env = process.env) {
  const mode = authModeOf(env);
  const isDeployed = Boolean(env.BASE_PATH) || env.NODE_ENV === 'production';
  if (!isDeployed) return mode === 'sso' ? SSO_SETTINGS.filter((name) => !env[name]).map((name) => `${name} is not set`) : [];
  const problems = [];
  if (mode !== 'sso') problems.push(`AUTH_MODE is "${mode}", must be "sso" when deployed (BASE_PATH or NODE_ENV=production)`);
  for (const name of SSO_SETTINGS) if (!env[name]) problems.push(`${name} is not set`);
  for (const name of SESSION_SECRETS) {
    const value = env[name] || '';
    if (value.length < MIN_SECRET_LENGTH || Object.values(DEV_SECRETS).includes(value)) problems.push(`${name} is not set (needs ${MIN_SECRET_LENGTH}+ random characters)`);
  }
  if (env.TEAM_SESSION_SECRET && env.TEAM_SESSION_SECRET === env.INFLUENCER_SESSION_SECRET) problems.push('TEAM_SESSION_SECRET and INFLUENCER_SESSION_SECRET must differ');
  return problems;
}

export function authConfigFromEnv(env = process.env) {
  const basePath = env.BASE_PATH || '';
  return {
    mode: authModeOf(env),
    basePath,
    cookiePath: basePath || '/',
    secureCookies: Boolean(env.APP_URL?.startsWith('https')),
    publicOrigin: env.APP_URL ? new URL(env.APP_URL).origin : null,
    teamSecret: env.TEAM_SESSION_SECRET || DEV_SECRETS.team,
    influencerSecret: env.INFLUENCER_SESSION_SECRET || DEV_SECRETS.influencer,
    ticketSecret: env.SSO_TICKET_SECRET,
    ticketAudience: env.SSO_TICKET_AUDIENCE,
    authorizeUrl: env.SSO_AUTHORIZE_URL,
    allowedDomains: (env.ALLOWED_DOMAINS || DEFAULT_ALLOWED_DOMAINS).split(',').map((domain) => domain.trim().toLowerCase()),
  };
}

function verifySession(token, secret, role) {
  if (!token) return null;
  try {
    const claims = jwt.verify(String(token), secret, { algorithms: ['HS256'] });
    return claims.role === role ? claims : null;
  } catch { return null; }
}

// conan-edogawa signs the ticket (src/routes/sso-broker.ts): HS256, aud = this app's origin.
function verifyTicket(token, config) {
  try {
    const claims = jwt.verify(String(token), config.ticketSecret, { algorithms: ['HS256'], audience: config.ticketAudience });
    return typeof claims.email === 'string' && typeof claims.providerId === 'string' ? claims : null;
  } catch { return null; }
}

export function createAuth(config) {
  const cookieOptions = (maxAgeMs) => ({ httpOnly: true, secure: config.secureCookies, sameSite: 'lax', path: config.cookiePath, maxAge: maxAgeMs });
  const publicOriginOf = (req) => config.publicOrigin || `${req.protocol}://${req.get('host')}`;

  function setTeamSession(res, { email, name }) {
    const token = jwt.sign({ role: 'team', email, name }, config.teamSecret, { algorithm: 'HS256', expiresIn: `${TEAM_SESSION_HOURS}h` });
    res.cookie(TEAM_COOKIE, token, cookieOptions(TEAM_SESSION_HOURS * 3600 * 1000));
  }

  function setInfluencerSession(res, influencer) {
    const token = jwt.sign({ role: 'influencer', id: influencer.id, name: influencer.name, email: influencer.email }, config.influencerSecret, { algorithm: 'HS256', expiresIn: `${INFLUENCER_SESSION_DAYS}d` });
    res.cookie(INFLUENCER_COOKIE, token, cookieOptions(INFLUENCER_SESSION_DAYS * 24 * 3600 * 1000));
  }

  function clearSessions(res) {
    res.clearCookie(TEAM_COOKIE, { path: config.cookiePath });
    res.clearCookie(INFLUENCER_COOKIE, { path: config.cookiePath });
  }

  /** Attaches req.user from whichever session cookie is valid (team first); never rejects. */
  function attachUser(req, _res, next) {
    const team = verifySession(req.cookies?.[TEAM_COOKIE], config.teamSecret, 'team');
    if (team) {
      req.user = { role: 'team', name: team.name || team.email, email: team.email };
      return next();
    }
    const influencer = verifySession(req.cookies?.[INFLUENCER_COOKIE], config.influencerSecret, 'influencer');
    req.user = influencer ? { role: 'influencer', id: influencer.id, name: influencer.name, email: influencer.email } : null;
    next();
  }

  /** GET /team — the team's way in. Lands on the app root with a team session. */
  function teamSignIn(req, res) {
    const home = `${config.basePath}/`;
    if (req.user?.role === 'team') return res.redirect(home);
    if (config.mode === 'dev') {
      setTeamSession(res, { email: 'dev@lovepopcards.com', name: 'Local Dev' });
      return res.redirect(home);
    }
    const claims = req.query.sso_ticket ? verifyTicket(req.query.sso_ticket, config) : null;
    if (claims) {
      const domain = claims.email.toLowerCase().split('@')[1];
      if (!config.allowedDomains.includes(domain)) return res.status(403).send('This page is for the Lovepop team.');
      setTeamSession(res, { email: claims.email.toLowerCase(), name: claims.name });
      return res.redirect(home);
    }
    // No session, or a forged/expired ticket: start a fresh round trip through the broker.
    const returnTo = `${publicOriginOf(req)}${config.basePath}/team`;
    res.redirect(`${config.authorizeUrl}?return_to=${encodeURIComponent(returnTo)}`);
  }

  return { attachUser, teamSignIn, setInfluencerSession, clearSessions };
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

export function teamOnly(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.user.role !== 'team') return res.status(403).json({ error: 'Team access required' });
  next();
}
