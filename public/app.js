/* ============================================================
   Lovepop Ambassador Program — Frontend App
   ============================================================ */

const App = (() => {

  // ── State ──────────────────────────────────────────────────
  let token = localStorage.getItem('lp_token') || null;
  let currentUser = null;
  let influencers = [];
  let campaigns = [];
  let posts = [];
  let activeInfluencerFilter = 'all';
  let activePostFilter = 'all';
  let pendingApproveId = null;

  const TIER_THRESHOLDS = {
    bronze:   0,
    silver:   15,
    gold:     35,
    platinum: 75,
    diamond:  150
  };
  const TIER_ORDER = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];
  const TIER_GEMS  = { bronze: '🥉', silver: '🥈', gold: '🥇', platinum: '💎', diamond: '👑' };
  const TIER_LABELS = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum', diamond: 'Diamond' };

  // ── API helpers ────────────────────────────────────────────
  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
    if (res.status === 401 || res.status === 403) { logout(); return null; }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Request failed');
    return json;
  }

  async function apiForm(path, formData, method = 'POST') {
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(path, { method, headers, body: formData });
    if (res.status === 401) { logout(); return null; }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Request failed');
    return json;
  }

  // ── Toast ──────────────────────────────────────────────────
  function toast(msg, type = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `toast${type ? ' toast-' + type : ''}`;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 3500);
  }

  // ── Page navigation ────────────────────────────────────────
  function showPage(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    window.scrollTo(0, 0);
  }

  function showLanding() { showPage('page-landing'); }
  function showLogin()   {
    showPage('page-login');
    // Always reset to influencer tab when opening login
    setLoginType('influencer');
    document.getElementById('login-email').value = '';
    document.getElementById('login-password').value = '';
    document.getElementById('login-error').style.display = 'none';
  }

  function scrollToSignup() {
    document.getElementById('signup-section').scrollIntoView({ behavior: 'smooth' });
  }
  function scrollToHow() {
    document.getElementById('how-it-works').scrollIntoView({ behavior: 'smooth' });
  }

  // ── Auth ───────────────────────────────────────────────────
  let loginType = 'influencer';

  function setLoginType(type) {
    loginType = type;
    document.getElementById('btn-influencer-login').classList.toggle('active', type === 'influencer');
    document.getElementById('btn-team-login').classList.toggle('active', type === 'team');
    document.getElementById('team-username-group').style.display = type === 'team' ? 'block' : 'none';
    const emailGroup = document.getElementById('login-email').closest('.form-group');
    emailGroup.style.display = type === 'team' ? 'none' : 'block';
    // Remove required from hidden field to avoid native form validation blocking submit
    document.getElementById('login-email').required = type === 'influencer';
  }

  async function submitLogin(e) {
    e.preventDefault();
    const btn = document.getElementById('login-submit-btn');
    const errEl = document.getElementById('login-error');
    errEl.style.display = 'none';
    btn.disabled = true; btn.textContent = 'Signing in...';
    try {
      let data;
      if (loginType === 'team') {
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;
        data = await api('/api/auth/team-login', { method: 'POST', body: JSON.stringify({ username, password }) });
      } else {
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        data = await api('/api/auth/influencer-login', { method: 'POST', body: JSON.stringify({ email, password }) });
      }
      if (!data) return;
      token = data.token;
      currentUser = { role: data.role, name: data.name, id: data.id };
      localStorage.setItem('lp_token', token);
      if (data.role === 'team') {
        initTeamDashboard();
      } else {
        initInfluencerDashboard();
      }
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false; btn.textContent = 'Sign In';
    }
  }

  function logout() {
    token = null; currentUser = null; influencers = []; campaigns = []; posts = [];
    localStorage.removeItem('lp_token');
    showLanding();
  }

  async function checkAuth() {
    if (!token) return false;
    try {
      const user = await api('/api/auth/me');
      if (!user) return false;
      currentUser = user;
      return true;
    } catch { return false; }
  }

  // ── Signup ─────────────────────────────────────────────────
  async function submitSignup(e) {
    e.preventDefault();
    const form = e.target;
    const btn = document.getElementById('signup-submit-btn');
    const errEl = document.getElementById('signup-error');
    const successEl = document.getElementById('signup-success');
    errEl.style.display = 'none';
    successEl.style.display = 'none';
    btn.disabled = true; btn.textContent = 'Submitting...';

    const data = {};
    new FormData(form).forEach((v, k) => { data[k] = v; });

    try {
      await api('/api/signup', { method: 'POST', body: JSON.stringify(data) });
      form.style.display = 'none';
      successEl.style.display = 'block';
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Submit Application';
    }
  }

  // ═══════════════════════════════════════════════════════════
  // TEAM DASHBOARD
  // ═══════════════════════════════════════════════════════════
  async function initTeamDashboard() {
    showPage('page-team');

    // Wire up nav tabs
    document.querySelectorAll('[data-team-view]').forEach(btn => {
      btn.addEventListener('click', () => teamNav(btn.dataset.teamView));
    });

    await Promise.all([loadInfluencers(), loadCampaigns(), loadPosts()]);
    renderTeamOverview();
    teamNav('overview');
  }

  function teamNav(view, filterStatus = null) {
    document.querySelectorAll('[data-team-view]').forEach(b => b.classList.toggle('active', b.dataset.teamView === view));
    document.querySelectorAll('.team-view').forEach(v => v.classList.remove('active'));
    document.getElementById(`team-view-${view}`)?.classList.add('active');

    if (view === 'influencers') {
      if (filterStatus) {
        activeInfluencerFilter = filterStatus;
        document.querySelectorAll('#influencer-status-filter .filter-tab').forEach(b => {
          b.classList.toggle('active', b.dataset.status === filterStatus);
        });
      }
      renderInfluencerGrid();
    }
    if (view === 'campaigns') renderCampaignGrid('team');
    if (view === 'posts') renderPostsTable();
  }

  // ── Load data ─────────────────────────────────────────────
  async function loadInfluencers() {
    try { influencers = await api('/api/influencers') || []; } catch { influencers = []; }
  }
  async function loadCampaigns() {
    try { campaigns = await api('/api/campaigns') || []; } catch { campaigns = []; }
  }
  async function loadPosts(status = '') {
    try {
      const qs = status ? `?status=${status}` : '';
      posts = await api(`/api/posts${qs}`) || [];
    } catch { posts = []; }
  }

  // ── Overview ──────────────────────────────────────────────
  async function renderTeamOverview() {
    try {
      const stats = await api('/api/stats/overview');
      if (!stats) return;
      document.getElementById('overview-stats').innerHTML = `
        <div class="stat-card">
          <span class="stat-num">${stats.totalInfluencers}</span>
          <span class="stat-label">Active Ambassadors</span>
        </div>
        <div class="stat-card">
          <span class="stat-num stat-accent">${stats.pendingInfluencers}</span>
          <span class="stat-label">Pending Review</span>
        </div>
        <div class="stat-card">
          <span class="stat-num">${stats.totalPosts}</span>
          <span class="stat-label">Approved Posts</span>
        </div>
        <div class="stat-card">
          <span class="stat-num">${fmtNum(stats.totalImpressions)}</span>
          <span class="stat-label">Total Impressions</span>
        </div>
        <div class="stat-card">
          <span class="stat-num">${stats.activeCampaigns}</span>
          <span class="stat-label">Active Campaigns</span>
        </div>
      `;
    } catch {}

    // Pending influencers
    const pending = influencers.filter(i => i.status === 'pending');
    const pendingEl = document.getElementById('pending-influencers-list');
    if (pending.length === 0) {
      pendingEl.innerHTML = '<p class="text-muted" style="font-size:13px;padding:8px 0">No pending applications.</p>';
    } else {
      pendingEl.innerHTML = pending.slice(0, 5).map(i => `
        <div class="pending-mini-card" onclick="App.openInfluencer(${i.id})">
          <div class="tile-avatar" style="width:36px;height:36px;font-size:13px">${initials(i.name)}</div>
          <div>
            <div class="pending-mini-name">${esc(i.name)}</div>
            <div class="pending-mini-meta">${esc(i.email)} · ${platformsSummary(i)}</div>
          </div>
          <div class="pending-mini-actions">
            <button class="btn-primary btn-sm" onclick="event.stopPropagation(); App.initiateApprove(${i.id}, '${esc(i.email)}')">Approve</button>
            <button class="btn-danger btn-sm" onclick="event.stopPropagation(); App.rejectInfluencer(${i.id})">Reject</button>
          </div>
        </div>
      `).join('');
    }

    // Active campaigns
    const active = campaigns.filter(c => ['live','closing_soon'].includes(c.computed_status));
    const activeEl = document.getElementById('active-campaigns-list');
    if (active.length === 0) {
      activeEl.innerHTML = '<p class="text-muted" style="font-size:13px;padding:8px 0">No active campaigns.</p>';
    } else {
      activeEl.innerHTML = active.slice(0, 4).map(c => `
        <div class="pending-mini-card" onclick="App.openCampaign(${c.id})">
          <div style="font-size:24px">📣</div>
          <div>
            <div class="pending-mini-name">${esc(c.name)}</div>
            <div class="pending-mini-meta">${formatDateRange(c.start_date, c.end_date)}</div>
          </div>
          <div style="margin-left:auto">${campaignStatusBadge(c.computed_status)}</div>
        </div>
      `).join('');
    }
  }

  // ── Influencer Grid ───────────────────────────────────────
  function renderInfluencerGrid() {
    const search = (document.getElementById('influencer-search')?.value || '').toLowerCase();
    let list = influencers;
    if (activeInfluencerFilter !== 'all') list = list.filter(i => i.status === activeInfluencerFilter);
    if (search) list = list.filter(i => (i.name + i.email + (i.instagram||'')).toLowerCase().includes(search));

    const grid = document.getElementById('influencer-grid');
    const empty = document.getElementById('influencer-empty');
    document.getElementById('influencer-count-badge').textContent = list.length;

    if (list.length === 0) { grid.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    grid.innerHTML = list.map(i => influencerTile(i)).join('');
  }

  function influencerTile(i) {
    const platforms = [];
    if (i.instagram) platforms.push(`<span class="platform-tag"><span class="platform-icon platform-icon-ig" style="width:14px;height:14px;font-size:8px;border-radius:3px">IG</span><span class="ptag-handle">${esc(i.instagram)}</span><span class="ptag-count">${fmtNum(i.instagram_followers)}</span></span>`);
    if (i.tiktok)    platforms.push(`<span class="platform-tag"><span class="platform-icon platform-icon-tt" style="width:14px;height:14px;font-size:8px;border-radius:3px">TT</span><span class="ptag-handle">${esc(i.tiktok)}</span><span class="ptag-count">${fmtNum(i.tiktok_followers)}</span></span>`);
    if (i.youtube)   platforms.push(`<span class="platform-tag"><span class="platform-icon platform-icon-yt" style="width:14px;height:14px;font-size:8px;border-radius:3px">YT</span><span class="ptag-handle">${esc(i.youtube)}</span><span class="ptag-count">${fmtNum(i.youtube_followers)}</span></span>`);
    if (i.linkedin)  platforms.push(`<span class="platform-tag"><span class="platform-icon platform-icon-li" style="width:14px;height:14px;font-size:8px;border-radius:3px">LI</span><span class="ptag-handle">${esc(i.linkedin)}</span><span class="ptag-count">${fmtNum(i.linkedin_followers)}</span></span>`);

    return `
      <div class="influencer-tile" onclick="App.openInfluencer(${i.id})">
        <div class="tile-header">
          <div class="tile-avatar">${initials(i.name)}</div>
          <div class="tile-name-block">
            <div class="tile-name">${esc(i.name)}</div>
            <div class="tile-email">${esc(i.email)}</div>
          </div>
          <span class="status-badge status-${i.status}">${cap(i.status)}</span>
        </div>
        <div class="tile-platforms">${platforms.join('')}</div>
        <div class="tile-meta">
          <div class="tile-tier">
            <span class="tier-pip tier-pip-${i.tier}"></span>
            <span class="tier-label">${TIER_LABELS[i.tier] || cap(i.tier)}</span>
          </div>
          <div class="tile-date">Joined ${formatDate(i.created_at)}</div>
        </div>
      </div>
    `;
  }

  function setInfluencerFilter(btn) {
    activeInfluencerFilter = btn.dataset.status;
    document.querySelectorAll('#influencer-status-filter .filter-tab').forEach(b => b.classList.toggle('active', b === btn));
    renderInfluencerGrid();
  }
  function filterInfluencers() { renderInfluencerGrid(); }

  // ── Influencer Detail Modal ───────────────────────────────
  async function openInfluencer(id) {
    const modal = document.getElementById('influencer-modal');
    const body = document.getElementById('inf-modal-body');
    const title = document.getElementById('inf-modal-title');
    body.innerHTML = '<div style="text-align:center;padding:40px"><div class="spinner"></div></div>';
    openModal('influencer-modal');

    try {
      const inf = await api(`/api/influencers/${id}`);
      if (!inf) return;
      title.textContent = inf.name;
      body.innerHTML = renderInfluencerModal(inf);
      body.querySelectorAll('.modal-tab').forEach(t => {
        t.addEventListener('click', () => switchModalTab(t, body));
      });
    } catch (err) {
      body.innerHTML = `<p class="text-muted">Error loading influencer: ${esc(err.message)}</p>`;
    }
  }

  function renderInfluencerModal(inf) {
    const contacts = (inf.contacts || []);
    const notes = (inf.notes || []);
    const contracts = (inf.contracts || []);
    const lpContacts = (inf.lovepop_contacts || []);

    // Build platform rows
    const platformRows = [
      { key: 'instagram', label: 'Instagram', icon: 'platform-icon-ig', short: 'IG', countKey: 'instagram_followers' },
      { key: 'tiktok', label: 'TikTok', icon: 'platform-icon-tt', short: 'TT', countKey: 'tiktok_followers' },
      { key: 'youtube', label: 'YouTube', icon: 'platform-icon-yt', short: 'YT', countKey: 'youtube_followers' },
      { key: 'linkedin', label: 'LinkedIn', icon: 'platform-icon-li', short: 'LI', countKey: 'linkedin_followers' }
    ].filter(p => inf[p.key]).map(p => `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <span class="platform-icon ${p.icon}" style="flex-shrink:0">${p.short}</span>
        <span style="font-weight:600;font-size:13px">${esc(inf[p.key])}</span>
        <span class="text-muted" style="font-size:12px">${fmtNum(inf[p.countKey])} followers</span>
      </div>
    `).join('');

    return `
      <!-- Tabs -->
      <div class="modal-tabs">
        <button class="modal-tab active" data-tab="info">Profile</button>
        <button class="modal-tab" data-tab="contacts">Contacts (${contacts.length})</button>
        <button class="modal-tab" data-tab="notes">Notes (${notes.length})</button>
        <button class="modal-tab" data-tab="contracts">Contracts (${contracts.length})</button>
        <button class="modal-tab" data-tab="edit">Edit</button>
      </div>

      <!-- Info Tab -->
      <div class="modal-tab-content" id="tab-info">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px">
          <div class="tile-avatar" style="width:56px;height:56px;font-size:20px">${initials(inf.name)}</div>
          <div>
            <div style="font-family:'Playfair Display',serif;font-size:20px;font-weight:700;color:var(--navy)">${esc(inf.name)}</div>
            <div style="font-size:13px;color:var(--gray)">${esc(inf.email)}${inf.phone ? ' · ' + esc(inf.phone) : ''}</div>
            <div style="margin-top:6px;display:flex;gap:8px;align-items:center">
              <span class="status-badge status-${inf.status}">${cap(inf.status)}</span>
              <span class="status-badge" style="background:var(--coral-light);color:var(--coral);border-color:var(--coral-border)">${TIER_GEMS[inf.tier] || ''} ${TIER_LABELS[inf.tier] || cap(inf.tier)}</span>
            </div>
          </div>
          <div style="margin-left:auto;display:flex;gap:8px;flex-direction:column;align-items:flex-end">
            ${inf.status === 'pending' ? `
              <button class="btn-primary btn-sm" onclick="App.initiateApprove(${inf.id}, '${esc(inf.email)}')">Approve</button>
              <button class="btn-danger btn-sm" onclick="App.rejectInfluencer(${inf.id})">Reject</button>
            ` : ''}
          </div>
        </div>

        <div class="modal-form-section">
          <div class="modal-form-section-title">Platforms</div>
          ${platformRows || '<p class="text-muted" style="font-size:13px">No platforms listed.</p>'}
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="modal-form-section">
            <div class="modal-form-section-title">Stats</div>
            <div style="font-size:13px;color:var(--navy)">
              <div style="margin-bottom:4px"><strong>${inf.total_posts}</strong> approved posts</div>
              <div style="margin-bottom:4px"><strong>${fmtNum(inf.total_impressions)}</strong> total impressions</div>
              <div>Score: <strong>${calcScore(inf.total_posts, inf.total_impressions).toFixed(1)}</strong></div>
            </div>
          </div>
          <div class="modal-form-section">
            <div class="modal-form-section-title">Info</div>
            <div style="font-size:13px;color:var(--navy)">
              ${inf.age_range ? `<div style="margin-bottom:4px">Age range: <strong>${inf.age_range}</strong></div>` : ''}
              <div>Joined: <strong>${formatDate(inf.created_at)}</strong></div>
              ${lpContacts.length ? `<div style="margin-top:4px">LP Contact: <strong>${lpContacts.join(', ')}</strong></div>` : ''}
            </div>
          </div>
        </div>

        ${inf.audience_description ? `
          <div class="modal-form-section" style="margin-top:12px">
            <div class="modal-form-section-title">Audience</div>
            <p style="font-size:13px;color:var(--navy);line-height:1.6">${esc(inf.audience_description)}</p>
          </div>
        ` : ''}
        ${inf.why_lovepop ? `
          <div class="modal-form-section">
            <div class="modal-form-section-title">Why Lovepop</div>
            <p style="font-size:13px;color:var(--navy);line-height:1.6">${esc(inf.why_lovepop)}</p>
          </div>
        ` : ''}
      </div>

      <!-- Contacts Tab -->
      <div class="modal-tab-content hidden" id="tab-contacts">
        <div class="contacts-list" id="contacts-display">
          ${contacts.length === 0
            ? '<p class="text-muted" style="font-size:13px">No contacts added yet.</p>'
            : contacts.map(c => `
              <div class="contact-item">
                <div>
                  <div class="contact-name">${esc(c.name)}</div>
                  <div class="contact-role">${esc(c.role)}</div>
                  ${c.email ? `<div class="contact-email">${esc(c.email)}</div>` : ''}
                  ${c.phone ? `<div style="font-size:12px;color:var(--gray)">${esc(c.phone)}</div>` : ''}
                </div>
                <span class="contact-active ${c.active ? 'yes' : 'no'}">${c.active ? 'Active' : 'Inactive'}</span>
              </div>
            `).join('')
          }
        </div>
        <div style="margin-top:16px">
          <div class="modal-form-section-title">Add Contact</div>
          <div id="new-contact-form" style="display:flex;flex-direction:column;gap:8px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <input type="text" class="form-input" id="nc-name" placeholder="Name" />
              <input type="text" class="form-input" id="nc-role" placeholder="Role / Title" />
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <input type="email" class="form-input" id="nc-email" placeholder="Email" />
              <input type="tel" class="form-input" id="nc-phone" placeholder="Phone" />
            </div>
            <button class="btn-secondary" onclick="App.addContact(${inf.id})">Add Contact</button>
          </div>
        </div>
      </div>

      <!-- Notes Tab -->
      <div class="modal-tab-content hidden" id="tab-notes">
        <div class="note-add-row">
          <input type="text" class="form-input" id="new-note-input" placeholder="Add a note about this partnership..." />
          <button class="btn-primary" onclick="App.addNote(${inf.id})">Add Note</button>
        </div>
        <div class="notes-list" id="notes-list">
          ${notes.length === 0
            ? '<p class="text-muted" style="font-size:13px;margin-top:12px">No notes yet.</p>'
            : notes.map(n => `
              <div class="note-item">
                <div class="note-text">${esc(n.text)}</div>
                <div class="note-meta">${esc(n.author)} · ${formatDateTime(n.timestamp)}</div>
              </div>
            `).join('')
          }
        </div>
      </div>

      <!-- Contracts Tab -->
      <div class="modal-tab-content hidden" id="tab-contracts">
        <div class="contracts-list">
          ${contracts.length === 0
            ? '<p class="text-muted" style="font-size:13px">No contracts uploaded yet.</p>'
            : contracts.map(c => `
              <div class="contract-item">
                <span class="contract-icon">📄</span>
                <span class="contract-name">${esc(c.filename)}</span>
                <span class="contract-date">${formatDate(c.uploaded_at)}</span>
                <a href="${c.path}" target="_blank" class="contract-link">Download</a>
              </div>
            `).join('')
          }
        </div>
        <div style="margin-top:16px">
          <div class="modal-form-section-title">Upload Contract</div>
          <input type="file" id="contract-file-input" accept=".pdf,.doc,.docx" style="display:none" onchange="App.uploadContract(${inf.id}, this)" />
          <button class="btn-secondary" onclick="document.getElementById('contract-file-input').click()">+ Upload Contract / Agreement</button>
        </div>
      </div>

      <!-- Edit Tab -->
      <div class="modal-tab-content hidden" id="tab-edit">
        <form onsubmit="App.saveInfluencer(event, ${inf.id})">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Name</label>
              <input type="text" name="name" class="form-input" value="${esc(inf.name)}" />
            </div>
            <div class="form-group">
              <label class="form-label">Email</label>
              <input type="email" name="email" class="form-input" value="${esc(inf.email)}" />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Phone</label>
              <input type="text" name="phone" class="form-input" value="${esc(inf.phone || '')}" />
            </div>
            <div class="form-group">
              <label class="form-label">Status</label>
              <select name="status" class="form-input">
                <option value="pending" ${inf.status==='pending'?'selected':''}>Pending</option>
                <option value="approved" ${inf.status==='approved'?'selected':''}>Approved</option>
                <option value="rejected" ${inf.status==='rejected'?'selected':''}>Rejected</option>
              </select>
            </div>
          </div>
          <div class="modal-form-section-title" style="margin-top:8px">Platform Handles &amp; Follower Counts</div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Instagram</label>
              <input type="text" name="instagram" class="form-input" value="${esc(inf.instagram||'')}" placeholder="@handle" />
            </div>
            <div class="form-group">
              <label class="form-label">Followers</label>
              <input type="number" name="instagram_followers" class="form-input" value="${inf.instagram_followers||0}" />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">TikTok</label>
              <input type="text" name="tiktok" class="form-input" value="${esc(inf.tiktok||'')}" placeholder="@handle" />
            </div>
            <div class="form-group">
              <label class="form-label">Followers</label>
              <input type="number" name="tiktok_followers" class="form-input" value="${inf.tiktok_followers||0}" />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">YouTube</label>
              <input type="text" name="youtube" class="form-input" value="${esc(inf.youtube||'')}" placeholder="Channel name" />
            </div>
            <div class="form-group">
              <label class="form-label">Subscribers</label>
              <input type="number" name="youtube_followers" class="form-input" value="${inf.youtube_followers||0}" />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">LinkedIn</label>
              <input type="text" name="linkedin" class="form-input" value="${esc(inf.linkedin||'')}" placeholder="Handle or URL" />
            </div>
            <div class="form-group">
              <label class="form-label">Followers</label>
              <input type="number" name="linkedin_followers" class="form-input" value="${inf.linkedin_followers||0}" />
            </div>
          </div>
          <div class="modal-form-section-title" style="margin-top:8px">Lovepop Contacts (comma-separated)</div>
          <div class="form-group">
            <input type="text" name="lp_contacts_str" class="form-input" value="${esc((inf.lovepop_contacts||[]).join(', '))}" placeholder="Sarah Mitchell, James Rodriguez" />
          </div>
          <div class="modal-form-section-title" style="margin-top:8px">Set / Reset Password</div>
          <div class="form-group">
            <input type="text" name="password" class="form-input" placeholder="Leave blank to keep existing password" />
          </div>
          <div id="edit-influencer-error" class="form-error" style="display:none"></div>
          <div class="form-actions">
            <button type="button" class="btn-secondary" onclick="App.closeModal('influencer-modal')">Cancel</button>
            <button type="submit" class="btn-primary">Save Changes</button>
          </div>
        </form>
      </div>
    `;
  }

  function switchModalTab(tab, body) {
    body.querySelectorAll('.modal-tab').forEach(t => t.classList.toggle('active', t === tab));
    body.querySelectorAll('.modal-tab-content').forEach(c => c.classList.toggle('hidden', c.id !== `tab-${tab.dataset.tab}`));
  }

  async function addNote(influencerId) {
    const input = document.getElementById('new-note-input');
    const text = input.value.trim();
    if (!text) return;
    try {
      const res = await api(`/api/influencers/${influencerId}/notes`, { method: 'POST', body: JSON.stringify({ text }) });
      input.value = '';
      const list = document.getElementById('notes-list');
      list.innerHTML = (res.notes || []).map(n => `
        <div class="note-item">
          <div class="note-text">${esc(n.text)}</div>
          <div class="note-meta">${esc(n.author)} · ${formatDateTime(n.timestamp)}</div>
        </div>
      `).join('');
      // Update local data
      const idx = influencers.findIndex(i => i.id === influencerId);
      if (idx >= 0) influencers[idx].notes = res.notes;
      toast('Note added', 'success');
    } catch (err) { toast(err.message, 'error'); }
  }

  async function addContact(influencerId) {
    const name = document.getElementById('nc-name').value.trim();
    const role = document.getElementById('nc-role').value.trim();
    const email = document.getElementById('nc-email').value.trim();
    const phone = document.getElementById('nc-phone').value.trim();
    if (!name) { toast('Contact name required', 'error'); return; }

    // Get current contacts for this influencer and add
    const inf = await api(`/api/influencers/${influencerId}`);
    const contacts = [...(inf.contacts || []), { name, role, email, phone, active: 1 }];
    try {
      await api(`/api/influencers/${influencerId}`, { method: 'PUT', body: JSON.stringify({ contacts }) });
      toast('Contact added', 'success');
      openInfluencer(influencerId); // Refresh modal
    } catch (err) { toast(err.message, 'error'); }
  }

  async function uploadContract(influencerId, input) {
    const file = input.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await apiForm(`/api/influencers/${influencerId}/contract`, fd);
      toast('Contract uploaded', 'success');
      openInfluencer(influencerId);
    } catch (err) { toast(err.message, 'error'); }
  }

  async function saveInfluencer(e, id) {
    e.preventDefault();
    const form = e.target;
    const errEl = document.getElementById('edit-influencer-error');
    errEl.style.display = 'none';
    const data = {};
    new FormData(form).forEach((v, k) => { data[k] = v; });
    // Parse lp_contacts
    data.lovepop_contacts = data.lp_contacts_str.split(',').map(s => s.trim()).filter(Boolean);
    delete data.lp_contacts_str;
    if (!data.password) delete data.password;

    try {
      await api(`/api/influencers/${id}`, { method: 'PUT', body: JSON.stringify(data) });
      toast('Changes saved!', 'success');
      await loadInfluencers();
      renderInfluencerGrid();
      openInfluencer(id);
    } catch (err) {
      errEl.textContent = err.message; errEl.style.display = 'block';
    }
  }

  // ── Approve / Reject ──────────────────────────────────────
  function initiateApprove(id, email) {
    pendingApproveId = id;
    document.getElementById('approve-email-preview').textContent = email;
    document.getElementById('approve-password').value = '';
    document.getElementById('approve-error').style.display = 'none';
    openModal('approve-modal');
  }

  async function confirmApprove() {
    const password = document.getElementById('approve-password').value.trim();
    const errEl = document.getElementById('approve-error');
    errEl.style.display = 'none';
    if (!password || password.length < 6) {
      errEl.textContent = 'Password must be at least 6 characters';
      errEl.style.display = 'block'; return;
    }
    try {
      await api(`/api/influencers/${pendingApproveId}/approve`, { method: 'POST', body: JSON.stringify({ password }) });
      toast('Ambassador approved!', 'success');
      closeModal('approve-modal');
      closeModal('influencer-modal');
      await loadInfluencers();
      renderInfluencerGrid();
      renderTeamOverview();
    } catch (err) { errEl.textContent = err.message; errEl.style.display = 'block'; }
  }

  async function rejectInfluencer(id) {
    if (!confirm('Reject this application?')) return;
    try {
      await api(`/api/influencers/${id}/reject`, { method: 'POST' });
      toast('Application rejected', '');
      closeModal('influencer-modal');
      await loadInfluencers();
      renderInfluencerGrid();
      renderTeamOverview();
    } catch (err) { toast(err.message, 'error'); }
  }

  // ── Campaign Grid ─────────────────────────────────────────
  function renderCampaignGrid(mode) {
    const grid = document.getElementById(mode === 'team' ? 'campaign-grid' : 'inf-campaign-grid');
    const empty = document.getElementById(mode === 'team' ? 'campaign-empty' : 'inf-campaign-empty');
    if (!grid) return;

    let list = campaigns;
    if (mode === 'influencer') {
      list = campaigns.filter(c => ['live','closing_soon','coming_soon'].includes(c.computed_status));
    }

    document.getElementById(mode === 'team' ? 'campaign-count-badge' : null)
      && (document.getElementById('campaign-count-badge').textContent = list.length);

    if (list.length === 0) { grid.innerHTML = ''; empty && (empty.style.display = 'block'); return; }
    empty && (empty.style.display = 'none');
    grid.innerHTML = list.map(c => campaignTile(c, mode)).join('');
  }

  function campaignTile(c, mode) {
    const bundles = c.product_bundles || [];
    return `
      <div class="campaign-tile" onclick="App.openCampaign(${c.id}, '${mode}')">
        <div class="campaign-tile-header">
          <div class="campaign-tile-top">
            <div class="campaign-tile-name">${esc(c.name)}</div>
            ${campaignStatusBadge(c.computed_status)}
          </div>
          <div class="campaign-tile-desc">${esc(c.description)}</div>
        </div>
        <div class="campaign-tile-body">
          <div class="campaign-tile-dates">${formatDateRange(c.start_date, c.end_date)}</div>
          <div class="campaign-tile-bundles">
            ${bundles.map(b => `<span class="bundle-chip">🎁 ${esc(b.name)}</span>`).join('')}
          </div>
        </div>
      </div>
    `;
  }

  function campaignStatusBadge(status) {
    const labels = { coming_soon: 'Coming Soon', live: 'Live', closing_soon: 'Closing Soon', closed: 'Closed' };
    return `<span class="campaign-status-badge campaign-status-${status}">${labels[status] || status}</span>`;
  }

  // ── Campaign Modal ────────────────────────────────────────
  async function openCampaign(id, mode = 'team') {
    const campaign = campaigns.find(c => c.id === id);
    if (!campaign) return;
    const body = document.getElementById('camp-modal-body');
    const title = document.getElementById('camp-modal-title');
    title.textContent = campaign.name;

    if (mode === 'influencer') {
      body.innerHTML = renderCampaignView(campaign);
      openModal('inf-campaign-modal');
      document.getElementById('inf-camp-modal-title').textContent = campaign.name;
      document.getElementById('inf-camp-modal-body').innerHTML = renderCampaignView(campaign);
    } else {
      body.innerHTML = renderCampaignEdit(campaign);
      body.querySelector('form')?.addEventListener('submit', (e) => saveCampaign(e, id));
      openModal('campaign-modal');
      body.querySelectorAll('.modal-tab').forEach(t => t.addEventListener('click', () => switchModalTab(t, body)));
    }
  }

  function renderCampaignView(c) {
    const bundles = c.product_bundles || [];
    const assets = c.image_assets || [];
    const skus = c.sku_designations || [];
    return `
      ${assets.length > 0 ? `<img src="${assets[0].path}" class="camp-detail-image" alt="Campaign image" onerror="this.style.display='none'" />` : ''}
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
        ${campaignStatusBadge(c.computed_status)}
        <span style="font-size:12px;color:var(--gray)">${formatDateRange(c.start_date, c.end_date)}</span>
      </div>
      <div class="camp-detail-section">
        <div class="camp-detail-label">About This Campaign</div>
        <div class="camp-detail-text">${esc(c.description)}</div>
      </div>
      <div class="camp-detail-section">
        <div class="camp-detail-label">Objectives &amp; What to Create</div>
        <div class="camp-detail-text">${esc(c.objectives)}</div>
      </div>
      ${bundles.length > 0 ? `
        <div class="camp-detail-section">
          <div class="camp-detail-label">Available Product Bundles</div>
          <div class="bundle-list">
            ${bundles.map(b => `
              <div class="bundle-item">
                <div class="bundle-item-name">🎁 ${esc(b.name)}</div>
                <div class="bundle-item-contents">${Array.isArray(b.items) ? b.items.map(i => `• ${esc(i)}`).join('  ') : esc(b.items || '')}</div>
                ${b.value ? `<div class="bundle-item-value">Value: ${esc(b.value)}</div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
      ${skus.length > 0 ? `
        <div class="camp-detail-section">
          <div class="camp-detail-label">Featured Product Lines</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${skus.map(s => `<span class="bundle-chip">${esc(s)}</span>`).join('')}
          </div>
        </div>
      ` : ''}
      ${assets.length > 1 ? `
        <div class="camp-detail-section">
          <div class="camp-detail-label">Marketing Assets</div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            ${assets.map(a => `<a href="${a.path}" target="_blank" style="font-size:12px;color:var(--coral);font-weight:600">📎 ${esc(a.filename)}</a>`).join('')}
          </div>
        </div>
      ` : ''}
      <div class="form-actions">
        <button class="btn-primary" onclick="App.infNav('submit')">Submit a Post for This Campaign</button>
      </div>
    `;
  }

  function renderCampaignEdit(c) {
    const bundles = c.product_bundles || [];
    const assets = c.image_assets || [];
    const skus = c.sku_designations || [];
    const bundleJSON = JSON.stringify(bundles).replace(/'/g, '&#39;');

    return `
      <div class="modal-tabs">
        <button class="modal-tab active" data-tab="camp-details">Details</button>
        <button class="modal-tab" data-tab="camp-bundles">Bundles &amp; SKUs</button>
        <button class="modal-tab" data-tab="camp-assets">Assets</button>
      </div>

      <div class="modal-tab-content" id="tab-camp-details">
        <form onsubmit="App.saveCampaign(event, ${c.id})">
          <div class="form-group">
            <label class="form-label">Campaign Name</label>
            <input type="text" name="name" class="form-input" value="${esc(c.name)}" required />
          </div>
          <div class="form-group">
            <label class="form-label">Description</label>
            <textarea name="description" class="form-input form-textarea" rows="3">${esc(c.description)}</textarea>
          </div>
          <div class="form-group">
            <label class="form-label">Objectives / What Creators Should Do</label>
            <textarea name="objectives" class="form-input form-textarea" rows="3">${esc(c.objectives)}</textarea>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Start Date</label>
              <input type="date" name="start_date" class="form-input" value="${c.start_date}" />
            </div>
            <div class="form-group">
              <label class="form-label">End Date</label>
              <input type="date" name="end_date" class="form-input" value="${c.end_date}" />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Status Override <span class="text-muted" style="font-weight:400">(leave blank for auto)</span></label>
              <select name="status_override" class="form-input">
                <option value="">Auto-calculate from dates</option>
                <option value="coming_soon" ${c.status_override==='coming_soon'?'selected':''}>Coming Soon</option>
                <option value="live" ${c.status_override==='live'?'selected':''}>Live</option>
                <option value="closing_soon" ${c.status_override==='closing_soon'?'selected':''}>Closing Soon</option>
                <option value="closed" ${c.status_override==='closed'?'selected':''}>Closed</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Success Metrics</label>
            <textarea name="success_metrics" class="form-input form-textarea" rows="2">${esc(c.success_metrics)}</textarea>
          </div>
          <div id="camp-edit-error" class="form-error" style="display:none"></div>
          <div class="form-actions">
            <button type="button" class="btn-danger" onclick="App.deleteCampaign(${c.id})">Delete Campaign</button>
            <button type="submit" class="btn-primary">Save Changes</button>
          </div>
        </form>
      </div>

      <div class="modal-tab-content hidden" id="tab-camp-bundles">
        <div class="modal-form-section-title">Product Bundles</div>
        <div id="bundles-editor">
          ${bundles.map((b, idx) => renderBundleEditor(b, idx)).join('')}
        </div>
        <button class="btn-secondary" style="margin-top:8px" onclick="App.addBundleEditor()">+ Add Bundle</button>
        <hr class="divider" style="margin:20px 0" />
        <div class="modal-form-section-title">SKU / Product Designations</div>
        <div id="sku-editor">
          ${skus.map((s, i) => `
            <div style="display:flex;gap:8px;margin-bottom:8px" id="sku-row-${i}">
              <input type="text" class="form-input sku-input" value="${esc(s)}" />
              <button class="btn-icon" onclick="this.parentElement.remove()">✕</button>
            </div>
          `).join('')}
        </div>
        <button class="btn-secondary" style="margin-top:4px" onclick="App.addSkuRow()">+ Add SKU / Product Line</button>
        <div class="form-actions" style="margin-top:20px">
          <button class="btn-primary" onclick="App.saveBundlesAndSkus(${c.id})">Save Bundles &amp; SKUs</button>
        </div>
      </div>

      <div class="modal-tab-content hidden" id="tab-camp-assets">
        <div class="modal-form-section-title">Marketing Assets / Images</div>
        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px">
          ${assets.map(a => `
            <div style="text-align:center">
              <img src="${a.path}" style="width:80px;height:80px;object-fit:cover;border-radius:8px;border:1px solid var(--sand-mid)" onerror="this.style.display='none'" />
              <div style="font-size:10px;color:var(--gray);margin-top:4px;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.filename)}</div>
            </div>
          `).join('')}
        </div>
        <input type="file" id="camp-asset-input" accept="image/*,.pdf" style="display:none" onchange="App.uploadCampaignAsset(${c.id}, this)" />
        <button class="btn-secondary" onclick="document.getElementById('camp-asset-input').click()">+ Upload Asset</button>
      </div>
    `;
  }

  function renderBundleEditor(b, idx) {
    const items = Array.isArray(b.items) ? b.items.join('\n') : (b.items || '');
    return `
      <div class="bundle-editor-item" id="bundle-item-${idx}">
        <div style="display:grid;grid-template-columns:1fr 100px auto;gap:8px;margin-bottom:8px">
          <input type="text" class="form-input bundle-name" placeholder="Bundle name" value="${esc(b.name || '')}" />
          <input type="text" class="form-input bundle-value" placeholder="Value ($)" value="${esc(b.value || '')}" />
          <button class="btn-icon" onclick="document.getElementById('bundle-item-${idx}').remove()">✕</button>
        </div>
        <textarea class="form-input bundle-items" rows="3" placeholder="Items (one per line)">${esc(items)}</textarea>
      </div>
    `;
  }

  let bundleEditorCount = 100;
  function addBundleEditor() {
    const editor = document.getElementById('bundles-editor');
    const idx = bundleEditorCount++;
    const div = document.createElement('div');
    div.innerHTML = renderBundleEditor({}, idx);
    editor.appendChild(div.firstElementChild);
  }

  function addSkuRow() {
    const editor = document.getElementById('sku-editor');
    const idx = Date.now();
    editor.insertAdjacentHTML('beforeend', `
      <div style="display:flex;gap:8px;margin-bottom:8px" id="sku-row-${idx}">
        <input type="text" class="form-input sku-input" placeholder="e.g. Holiday Collection" />
        <button class="btn-icon" onclick="this.parentElement.remove()">✕</button>
      </div>
    `);
  }

  async function saveBundlesAndSkus(campaignId) {
    const bundleItems = document.querySelectorAll('.bundle-editor-item');
    const product_bundles = [];
    bundleItems.forEach(el => {
      const name = el.querySelector('.bundle-name')?.value.trim();
      const value = el.querySelector('.bundle-value')?.value.trim();
      const itemsRaw = el.querySelector('.bundle-items')?.value.trim();
      const items = itemsRaw ? itemsRaw.split('\n').map(s => s.trim()).filter(Boolean) : [];
      if (name) product_bundles.push({ name, value, items });
    });

    const skuInputs = document.querySelectorAll('.sku-input');
    const sku_designations = Array.from(skuInputs).map(i => i.value.trim()).filter(Boolean);

    try {
      await api(`/api/campaigns/${campaignId}`, { method: 'PUT', body: JSON.stringify({ product_bundles, sku_designations }) });
      toast('Bundles & SKUs saved!', 'success');
      await loadCampaigns();
    } catch (err) { toast(err.message, 'error'); }
  }

  async function uploadCampaignAsset(campaignId, input) {
    const file = input.files[0];
    if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    try {
      await apiForm(`/api/campaigns/${campaignId}/images`, fd);
      toast('Asset uploaded!', 'success');
      await loadCampaigns();
      openCampaign(campaignId);
    } catch (err) { toast(err.message, 'error'); }
  }

  async function saveCampaign(e, id) {
    e.preventDefault();
    const form = e.target;
    const errEl = document.getElementById('camp-edit-error');
    errEl && (errEl.style.display = 'none');
    const data = {};
    new FormData(form).forEach((v, k) => { data[k] = v; });
    try {
      if (id) {
        await api(`/api/campaigns/${id}`, { method: 'PUT', body: JSON.stringify(data) });
      } else {
        await api('/api/campaigns', { method: 'POST', body: JSON.stringify(data) });
      }
      toast('Campaign saved!', 'success');
      closeModal('campaign-modal');
      await loadCampaigns();
      renderCampaignGrid('team');
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.style.display = 'block'; }
      else toast(err.message, 'error');
    }
  }

  async function deleteCampaign(id) {
    if (!confirm('Delete this campaign? This cannot be undone.')) return;
    try {
      await api(`/api/campaigns/${id}`, { method: 'DELETE' });
      toast('Campaign deleted', '');
      closeModal('campaign-modal');
      await loadCampaigns();
      renderCampaignGrid('team');
    } catch (err) { toast(err.message, 'error'); }
  }

  function openCreateCampaign() {
    const body = document.getElementById('camp-modal-body');
    const title = document.getElementById('camp-modal-title');
    title.textContent = 'New Campaign';
    body.innerHTML = `
      <form onsubmit="App.createCampaign(event)">
        <div class="form-group">
          <label class="form-label">Campaign Name <span class="required">*</span></label>
          <input type="text" name="name" class="form-input" placeholder="Mother's Day Magic 2026" required />
        </div>
        <div class="form-group">
          <label class="form-label">Description</label>
          <textarea name="description" class="form-input form-textarea" rows="3" placeholder="What is this campaign about?"></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Objectives / Creator Brief</label>
          <textarea name="objectives" class="form-input form-textarea" rows="3" placeholder="What should creators focus on? What content works best?"></textarea>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Start Date</label>
            <input type="date" name="start_date" class="form-input" />
          </div>
          <div class="form-group">
            <label class="form-label">End Date</label>
            <input type="date" name="end_date" class="form-input" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Status Override</label>
          <select name="status_override" class="form-input">
            <option value="">Auto-calculate from dates</option>
            <option value="coming_soon">Coming Soon</option>
            <option value="live">Live</option>
            <option value="closing_soon">Closing Soon</option>
            <option value="closed">Closed</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Success Metrics</label>
          <textarea name="success_metrics" class="form-input form-textarea" rows="2" placeholder="How will you measure success for this campaign?"></textarea>
        </div>
        <div id="create-camp-error" class="form-error" style="display:none"></div>
        <div class="form-actions">
          <button type="button" class="btn-secondary" onclick="App.closeModal('campaign-modal')">Cancel</button>
          <button type="submit" class="btn-primary">Create Campaign</button>
        </div>
      </form>
    `;
    openModal('campaign-modal');
  }

  async function createCampaign(e) {
    e.preventDefault();
    const form = e.target;
    const errEl = document.getElementById('create-camp-error');
    errEl.style.display = 'none';
    const data = {};
    new FormData(form).forEach((v, k) => { data[k] = v; });
    try {
      const res = await api('/api/campaigns', { method: 'POST', body: JSON.stringify(data) });
      toast('Campaign created!', 'success');
      closeModal('campaign-modal');
      await loadCampaigns();
      renderCampaignGrid('team');
    } catch (err) { errEl.textContent = err.message; errEl.style.display = 'block'; }
  }

  // ── Posts Table ───────────────────────────────────────────
  async function renderPostsTable() {
    const qs = activePostFilter !== 'all' ? `?status=${activePostFilter}` : '';
    const plist = await api(`/api/posts${qs}`) || [];
    const container = document.getElementById('posts-table-container');

    if (plist.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📱</div><div class="empty-title">No posts found</div></div>';
      return;
    }

    container.innerHTML = `
      <div class="posts-table-wrap">
        <table class="posts-table">
          <thead>
            <tr>
              <th>Screenshot</th>
              <th>Ambassador</th>
              <th>Platform</th>
              <th>Campaign</th>
              <th>Date Posted</th>
              <th>Impressions</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${plist.map(p => `
              <tr>
                <td>
                  ${p.screenshot_path
                    ? `<img src="${p.screenshot_path}" class="post-screenshot-thumb" alt="screenshot" />`
                    : `<div class="no-screenshot">📱</div>`
                  }
                </td>
                <td>${esc(p.influencer_name || '—')}</td>
                <td>${esc(p.platform)}</td>
                <td>${esc(p.campaign_name || '—')}</td>
                <td>${formatDate(p.date_posted)}</td>
                <td>${fmtNum(p.impressions)}</td>
                <td><span class="status-badge ${p.status === 'approved' ? 'status-approved' : p.status === 'rejected' ? 'status-rejected' : 'status-pending'}">${cap(p.status)}</span></td>
                <td>
                  <div style="display:flex;gap:6px">
                    ${p.status !== 'approved' ? `<button class="btn-primary btn-sm" onclick="App.updatePost(${p.id}, 'approved')">Approve</button>` : ''}
                    ${p.status !== 'rejected' ? `<button class="btn-danger btn-sm" onclick="App.updatePost(${p.id}, 'rejected')">Reject</button>` : ''}
                    ${p.post_url ? `<a href="${esc(p.post_url)}" target="_blank" class="btn-secondary btn-sm" style="text-decoration:none">View</a>` : ''}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  async function updatePost(id, status) {
    try {
      await api(`/api/posts/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
      toast(`Post ${status}`, 'success');
      renderPostsTable();
    } catch (err) { toast(err.message, 'error'); }
  }

  function setPostFilter(btn) {
    activePostFilter = btn.dataset.postStatus;
    document.querySelectorAll('[data-post-status]').forEach(b => b.classList.toggle('active', b === btn));
    renderPostsTable();
  }

  // ═══════════════════════════════════════════════════════════
  // INFLUENCER DASHBOARD
  // ═══════════════════════════════════════════════════════════
  async function initInfluencerDashboard() {
    showPage('page-influencer');
    document.getElementById('inf-user-name').textContent = currentUser.name;

    document.querySelectorAll('[data-inf-view]').forEach(btn => {
      btn.addEventListener('click', () => infNav(btn.dataset.infView));
    });

    await Promise.all([loadCampaigns(), loadInfluencerProfile()]);

    // Set avatar initials
    const initials = (currentUser.name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const avatarEl = document.getElementById('inf-avatar-initials');
    if (avatarEl) avatarEl.textContent = initials;

    renderInfluencerDashboard();
    infNav('dashboard');
  }

  let myProfile = null;

  async function loadInfluencerProfile() {
    if (!currentUser.id) return;
    try { myProfile = await api(`/api/influencers/${currentUser.id}`); } catch {}
  }

  function infNav(view) {
    document.querySelectorAll('[data-inf-view]').forEach(b => b.classList.toggle('active', b.dataset.infView === view));
    document.querySelectorAll('.inf-view').forEach(v => v.classList.remove('active'));
    document.getElementById(`inf-view-${view}`)?.classList.add('active');

    if (view === 'dashboard') renderInfluencerDashboard();
    if (view === 'campaigns') {
      renderCampaignGrid('influencer');
      // Wire up campaign click for influencer
      document.querySelectorAll('#inf-campaign-grid .campaign-tile').forEach(t => {
        const id = parseInt(t.getAttribute('onclick').match(/\d+/)[0]);
        t.onclick = () => {
          const c = campaigns.find(x => x.id === id);
          if (!c) return;
          document.getElementById('inf-camp-modal-title').textContent = c.name;
          document.getElementById('inf-camp-modal-body').innerHTML = renderCampaignView(c);
          openModal('inf-campaign-modal');
        };
      });
    }
    if (view === 'posts') renderMyPosts();
    if (view === 'submit') setupSubmitForm();
    if (view === 'profile') populateProfileForm();
  }

  // ── Profile Edit ────────────────────────────────────────────
  function populateProfileForm() {
    if (!myProfile) return;
    const p = myProfile;

    // Hero card
    const initials = (p.name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const heroAvatar = document.getElementById('profile-hero-avatar');
    if (heroAvatar) heroAvatar.textContent = initials;
    const heroName = document.getElementById('profile-hero-name');
    if (heroName) heroName.textContent = p.name || '';
    const heroTier = document.getElementById('profile-hero-tier');
    if (heroTier) heroTier.textContent = `${TIER_GEMS[p.tier || 'bronze']} ${TIER_LABELS[p.tier || 'bronze']} Ambassador`;
    const heroSince = document.getElementById('profile-hero-since');
    if (heroSince && p.created_at) {
      const d = new Date(p.created_at);
      heroSince.textContent = `Partner since ${d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
    }

    // Personal info
    setVal('profile-name', p.name);
    setVal('profile-email', p.email);
    setVal('profile-phone', p.phone);
    setVal('profile-age-range', p.age_range);
    setVal('profile-audience', p.audience_description);
    setVal('profile-why', p.why_lovepop);

    // Handles
    setVal('profile-instagram', p.instagram);
    setVal('profile-instagram-followers', p.instagram_followers || '');
    setVal('profile-tiktok', p.tiktok);
    setVal('profile-tiktok-followers', p.tiktok_followers || '');
    setVal('profile-youtube', p.youtube);
    setVal('profile-youtube-followers', p.youtube_followers || '');
    setVal('profile-linkedin', p.linkedin);
    setVal('profile-linkedin-followers', p.linkedin_followers || '');

    // Clear password fields and messages
    setVal('profile-new-password', '');
    setVal('profile-confirm-password', '');
    const errEl = document.getElementById('profile-save-error');
    const okEl  = document.getElementById('profile-save-success');
    if (errEl) errEl.style.display = 'none';
    if (okEl)  okEl.style.display  = 'none';
  }

  function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val == null ? '' : val;
  }

  async function saveProfile(e) {
    e.preventDefault();
    const errEl = document.getElementById('profile-save-error');
    const okEl  = document.getElementById('profile-save-success');
    const btn   = document.getElementById('profile-save-btn');
    errEl.style.display = 'none';
    okEl.style.display  = 'none';

    const newPw  = document.getElementById('profile-new-password').value;
    const confPw = document.getElementById('profile-confirm-password').value;
    if (newPw && newPw !== confPw) {
      errEl.textContent = 'Passwords do not match.';
      errEl.style.display = 'block';
      return;
    }

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const payload = {
        name:                 document.getElementById('profile-name').value.trim(),
        email:                document.getElementById('profile-email').value.trim(),
        phone:                document.getElementById('profile-phone').value.trim(),
        age_range:            document.getElementById('profile-age-range').value,
        audience_description: document.getElementById('profile-audience').value.trim(),
        why_lovepop:          document.getElementById('profile-why').value.trim(),
        instagram:            document.getElementById('profile-instagram').value.trim(),
        instagram_followers:  parseInt(document.getElementById('profile-instagram-followers').value) || 0,
        tiktok:               document.getElementById('profile-tiktok').value.trim(),
        tiktok_followers:     parseInt(document.getElementById('profile-tiktok-followers').value) || 0,
        youtube:              document.getElementById('profile-youtube').value.trim(),
        youtube_followers:    parseInt(document.getElementById('profile-youtube-followers').value) || 0,
        linkedin:             document.getElementById('profile-linkedin').value.trim(),
        linkedin_followers:   parseInt(document.getElementById('profile-linkedin-followers').value) || 0,
      };
      if (newPw) payload.new_password = newPw;

      const updated = await api(`/api/influencers/${currentUser.id}/profile`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      if (!updated) return;

      // Refresh local profile + header name
      myProfile = { ...myProfile, ...payload };
      currentUser.name = payload.name;
      document.getElementById('inf-user-name').textContent = payload.name;
      const initials = payload.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
      const avatarEl = document.getElementById('inf-avatar-initials');
      if (avatarEl) avatarEl.textContent = initials;
      populateProfileForm(); // refresh hero card

      okEl.style.display = 'flex';
      okEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      errEl.textContent = err.message || 'Failed to save. Please try again.';
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false; btn.textContent = 'Save Changes';
    }
  }

  function renderInfluencerDashboard() {
    if (!myProfile) return;
    const tier = myProfile.tier || 'bronze';
    const posts = myProfile.total_posts || 0;
    const impressions = myProfile.total_impressions || 0;
    const score = calcScore(posts, impressions);

    // Tier hero
    const nextTier = TIER_ORDER[TIER_ORDER.indexOf(tier) + 1];
    const nextThreshold = nextTier ? TIER_THRESHOLDS[nextTier] : null;
    const progress = nextThreshold ? Math.min(100, (score / nextThreshold) * 100) : 100;

    document.getElementById('inf-tier-hero').innerHTML = `
      <div class="tier-hero tier-hero-${tier}">
        <div class="tier-hero-content">
          <div class="tier-hero-label">Your Current Tier</div>
          <div class="tier-hero-name">${TIER_GEMS[tier]} ${TIER_LABELS[tier]}</div>
          <div class="tier-hero-sub">Welcome back, ${esc(myProfile.name.split(' ')[0])}!</div>
          <div class="tier-hero-progress">
            <div class="progress-bar-wrap">
              <div class="progress-bar-fill" style="width:${progress}%"></div>
            </div>
            <div class="progress-label">
              ${nextTier
                ? `${score.toFixed(1)} / ${nextThreshold} points toward ${TIER_LABELS[nextTier]}`
                : `${score.toFixed(1)} points — Diamond tier achieved! 👑`
              }
            </div>
          </div>
        </div>
        <div class="tier-hero-gem">${TIER_GEMS[tier]}</div>
      </div>
    `;

    // Stats row
    document.getElementById('inf-stats-row').innerHTML = `
      <div class="inf-stat-card">
        <span class="inf-stat-num">${posts}</span>
        <span class="inf-stat-label">Approved Posts</span>
      </div>
      <div class="inf-stat-card">
        <span class="inf-stat-num">${fmtNum(impressions)}</span>
        <span class="inf-stat-label">Total Impressions</span>
      </div>
      <div class="inf-stat-card">
        <span class="inf-stat-num">${score.toFixed(0)}</span>
        <span class="inf-stat-label">Ambassador Score</span>
      </div>
    `;

    // Tiers grid
    const tierBenefits = {
      bronze:   ['Welcome product bundle', 'Campaign briefs access', 'Ambassador dashboard', 'Early product news'],
      silver:   ['Everything in Bronze', 'Expanded product bundles', 'Monthly product drops', 'Priority campaign access'],
      gold:     ['Everything in Silver', 'Custom stash bundles', '1:1 partnership calls', 'Co-created content'],
      platinum: ['Everything in Gold', 'Performance bonuses', 'Exclusive product previews', 'Lovepop HQ visits'],
      diamond:  ['Everything in Platinum', 'Affiliate commission', 'Paid partnership deals', 'Product co-design input']
    };
    const tierIdx = TIER_ORDER.indexOf(tier);
    document.getElementById('inf-tiers-display').innerHTML = TIER_ORDER.map((t, i) => `
      <div class="inf-tier-card ${t === tier ? 'current-tier' : ''} ${i > tierIdx ? 'locked' : ''}">
        <div class="tier-gem">${TIER_GEMS[t]}</div>
        <div class="tier-name">${TIER_LABELS[t]}</div>
        ${t === tier ? '<div style="font-size:10px;color:var(--coral);font-weight:700;margin-bottom:4px">YOUR TIER</div>' : ''}
        <div class="tier-threshold" style="font-size:11px;color:var(--gray);margin-bottom:10px">${TIER_THRESHOLDS[t] === 0 ? 'Starting tier' : TIER_THRESHOLDS[t] + '+ pts'}</div>
        <ul class="tier-benefits">
          ${tierBenefits[t].map(b => `<li>${b}</li>`).join('')}
        </ul>
      </div>
    `).join('');
  }

  async function renderMyPosts() {
    const myPosts = await api('/api/posts') || [];
    const container = document.getElementById('inf-posts-list');
    const empty = document.getElementById('inf-posts-empty');
    if (myPosts.length === 0) { container.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';

    container.innerHTML = `<div class="posts-list">${myPosts.map(p => `
      <div class="post-card">
        ${p.screenshot_path
          ? `<img src="${p.screenshot_path}" class="post-card-thumb" alt="Post screenshot" />`
          : `<div class="post-card-no-thumb">📱</div>`
        }
        <div class="post-card-info">
          <div class="post-card-platform">${esc(p.platform)}</div>
          <div class="post-card-date">${formatDate(p.date_posted)}</div>
          ${p.campaign_name ? `<div class="post-card-campaign">${esc(p.campaign_name)}</div>` : ''}
          ${p.post_url ? `<a href="${esc(p.post_url)}" target="_blank" class="post-card-url">${esc(p.post_url)}</a>` : ''}
          <div class="post-card-meta">
            ${p.impressions ? `<span class="post-card-impressions">👁 ${fmtNum(p.impressions)} impressions</span>` : ''}
          </div>
        </div>
        <div class="post-card-status-wrap">
          <span class="status-badge ${p.status === 'approved' ? 'status-approved' : p.status === 'rejected' ? 'status-rejected' : 'status-pending'}">${cap(p.status)}</span>
        </div>
      </div>
    `).join('')}</div>`;
  }

  function setupSubmitForm() {
    // Set today as default date
    const dateInput = document.querySelector('#post-submit-form [name="date_posted"]');
    if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().split('T')[0];

    // Populate campaigns
    const select = document.getElementById('post-campaign-select');
    if (select && select.options.length <= 1) {
      campaigns.filter(c => ['live','closing_soon'].includes(c.computed_status)).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id; opt.textContent = c.name;
        select.appendChild(opt);
      });
    }

    // Reset success/error
    document.getElementById('post-submit-error').style.display = 'none';
    document.getElementById('post-submit-success').style.display = 'none';
  }

  function handleScreenshotSelect(input) {
    const file = input.files[0];
    if (!file) return;
    const preview = document.getElementById('screenshot-preview');
    const reader = new FileReader();
    reader.onload = (e) => {
      preview.style.display = 'block';
      preview.innerHTML = `<img src="${e.target.result}" style="max-width:100%;max-height:200px;border-radius:8px;margin-top:8px;border:1px solid var(--sand-mid)" />`;
    };
    reader.readAsDataURL(file);
    document.getElementById('screenshot-upload-area').style.background = 'var(--green-bg)';
    document.getElementById('screenshot-upload-area').style.borderColor = 'var(--green-border)';
  }

  async function submitPost(e) {
    e.preventDefault();
    const form = e.target;
    const btn = document.getElementById('post-submit-btn');
    const errEl = document.getElementById('post-submit-error');
    const successEl = document.getElementById('post-submit-success');
    errEl.style.display = 'none';
    successEl.style.display = 'none';

    const screenshotFile = document.getElementById('screenshot-file').files[0];
    if (!screenshotFile) {
      errEl.textContent = 'Please upload a screenshot of your post.';
      errEl.style.display = 'block'; return;
    }

    btn.disabled = true; btn.textContent = 'Submitting...';

    const fd = new FormData(form);
    if (screenshotFile) fd.set('screenshot', screenshotFile);

    try {
      await apiForm('/api/posts', fd);
      form.reset();
      document.getElementById('screenshot-preview').style.display = 'none';
      document.getElementById('screenshot-upload-area').style = '';
      successEl.style.display = 'block';
      // Refresh profile stats
      await loadInfluencerProfile();
    } catch (err) {
      errEl.textContent = err.message; errEl.style.display = 'block';
    } finally {
      btn.disabled = false; btn.textContent = 'Submit Post';
    }
  }

  // ═══════════════════════════════════════════════════════════
  // MODALS
  // ═══════════════════════════════════════════════════════════
  function openModal(id) {
    const el = document.getElementById(id);
    el.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeModal(id) {
    document.getElementById(id)?.classList.remove('open');
    document.body.style.overflow = '';
  }

  // Close on ESC
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.open').forEach(m => {
        m.classList.remove('open'); document.body.style.overflow = '';
      });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════
  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function cap(str) { return str ? str.charAt(0).toUpperCase() + str.slice(1) : ''; }

  function initials(name) {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
  }

  function fmtNum(n) {
    n = parseInt(n) || 0;
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toLocaleString();
  }

  function formatDate(str) {
    if (!str) return '—';
    try { return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch { return str; }
  }

  function formatDateTime(str) {
    if (!str) return '—';
    try { return new Date(str).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    catch { return str; }
  }

  function formatDateRange(start, end) {
    if (!start && !end) return 'No dates set';
    if (start && end) return `${formatDate(start)} – ${formatDate(end)}`;
    if (start) return `From ${formatDate(start)}`;
    return `Until ${formatDate(end)}`;
  }

  function platformsSummary(i) {
    const p = [];
    if (i.instagram) p.push('IG');
    if (i.tiktok)    p.push('TT');
    if (i.youtube)   p.push('YT');
    if (i.linkedin)  p.push('LI');
    return p.join(' · ') || 'No platforms';
  }

  function calcScore(posts, impressions) {
    return (parseInt(posts) || 0) + ((parseInt(impressions) || 0) / 10000);
  }

  // ═══════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════
  async function init() {
    // Check if already logged in
    if (token) {
      const authed = await checkAuth();
      if (authed && currentUser) {
        if (currentUser.role === 'team') {
          await initTeamDashboard();
          return;
        } else if (currentUser.role === 'influencer') {
          await initInfluencerDashboard();
          return;
        }
      } else {
        localStorage.removeItem('lp_token'); token = null;
      }
    }
    showLanding();
  }

  // Public API
  return {
    init,
    showLanding, showLogin, showPage,
    scrollToSignup, scrollToHow,
    submitSignup, submitLogin,
    setLoginType, logout,
    teamNav, infNav,
    renderInfluencerGrid, setInfluencerFilter, filterInfluencers,
    openInfluencer, saveInfluencer,
    addNote, addContact, uploadContract,
    initiateApprove, confirmApprove, rejectInfluencer,
    renderCampaignGrid,
    openCampaign, openCreateCampaign, saveCampaign, createCampaign, deleteCampaign,
    addBundleEditor, addSkuRow, saveBundlesAndSkus, uploadCampaignAsset,
    renderPostsTable, updatePost, setPostFilter,
    handleScreenshotSelect, submitPost,
    saveProfile,
    openModal, closeModal
  };
})();

// Start the app
App.init();
