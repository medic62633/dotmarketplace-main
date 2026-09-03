/* Shared framework for the standalone seller / admin portals.
 *
 * One consistent toolkit: session handling, authed fetch, toasts, and small
 * UI primitives (stat grids, tables with search/filter/pagination, skeletons,
 * empty states). Each panel registers its tabs via PanelCommon.createPanel()
 * and renders through the same helpers, so both portals behave identically.
 */
(function () {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const fmt = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const dateStr = d => { const dt = d ? new Date(d) : null; return dt && !Number.isNaN(dt.getTime()) ? dt.toLocaleString() : '—'; };

  const CATS = [
    { id: 'all', label: 'All' },
    { id: 'accounts', label: 'Accounts' },
    { id: 'subscriptions', label: 'Subscriptions' },
    { id: 'software', label: 'Software' },
    { id: 'services', label: 'Services' },
    { id: 'digital', label: 'Digital' },
    { id: 'gaming', label: 'Gaming' },
  ];

  let AUTH = null;

  // Each portal (seller / admin) gets its own localStorage session keys so that
  // signing into one panel does not log out the marketplace (dk_token) or the
  // other panel. Keys are set per-boot via setSessionRole().
  let TOKEN_KEY = 'dk_token';
  let USER_KEY = 'dk_user';

  function setSessionRole(role) {
    if (role === 'seller' || role === 'admin') {
      TOKEN_KEY = 'dk_token_' + role;
      USER_KEY = 'dk_user_' + role;
    }
    // The shared dk_user/dk_token keys belong to the MARKETPLACE session —
    // panels must not touch them (visiting a panel used to sign the user out
    // of the storefront). Panels only ever read their scoped keys, so a stale
    // shared session can't leak into a portal.
  }

  function loadJSON(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }

  function getAuthToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }

  function hasApiSession() {
    return !!(AUTH && getAuthToken());
  }

  function authHeaders(json) {
    const token = getAuthToken();
    const h = token ? { Authorization: 'Bearer ' + token } : {};
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  function saveSession(user, token) {
    AUTH = user;
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      if (token) localStorage.setItem(TOKEN_KEY, token);
    } catch (e) {}
    updateUserHeader();
  }

  function clearSession() {
    AUTH = null;
    try {
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(TOKEN_KEY);
    } catch (e) {}
    updateUserHeader();
  }

  /* Authed JSON fetch — single implementation used by every panel request. */
  async function api(path, opts = {}) {
    const r = await fetch(path, {
      method: opts.method || (opts.body ? 'POST' : 'GET'),
      headers: { ...authHeaders(!!opts.body), ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.msg || data.error || ('Request failed (' + r.status + ')'));
    return data;
  }

  function toast(msg, kind = 'info') {
    const box = $('#toasts');
    if (!box) return;
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, 3400);
  }

  function updateUserHeader() {
    const el = $('#panelUser');
    if (!el) return;
    if (AUTH) {
      el.innerHTML = `<b>${esc(AUTH.name)}</b><span class="panel-user-email">${esc(AUTH.email)}</span>`;
      $('#btnSignOut')?.removeAttribute('hidden');
    } else {
      el.innerHTML = '<span>Not signed in</span>';
      $('#btnSignOut')?.setAttribute('hidden', '');
    }
  }

  async function fetchMe() {
    const r = await fetch('/api/me', { headers: authHeaders() });
    if (!r.ok) throw new Error('Session expired');
    const { user } = await r.json();
    saveSession(user);
    return user;
  }

  async function signIn(email, password) {
    const r = await fetch('/api/auth/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.msg || data.error || 'Sign in failed');
    saveSession(data.user, data.token);
    return data.user;
  }

  function showLogin() {
    $('#loginGate')?.removeAttribute('hidden');
    $('#panelMain')?.setAttribute('hidden', '');
  }

  function showApp() {
    $('#loginGate')?.setAttribute('hidden', '');
    $('#panelMain')?.removeAttribute('hidden');
  }

  function bindLoginForm(onSuccess) {
    const form = $('#loginForm');
    if (!form || form.dataset.bound) return;
    form.dataset.bound = '1';
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = $('#loginSubmit');
      const email = $('#loginEmail')?.value || '';
      const pass = $('#loginPass')?.value || '';
      const err = $('#loginErr');
      if (err) err.textContent = '';
      if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
      try {
        await signIn(email, pass);
        const user = await fetchMe();
        await onSuccess(user);
      } catch (ex) {
        if (err) err.textContent = ex.message;
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Sign in'; }
      }
    });
    $('#btnSignOut')?.addEventListener('click', () => {
      clearSession();
      showLogin();
    });
  }

  /* ------------------------------ UI primitives ------------------------------ */

  const ui = {
    /* Stat grid: items = [{ k, v, mono }] */
    stats(items) {
      return `<div class="seller-stats">${items.map(s =>
        `<div class="seller-stat"><span class="k">${esc(s.k)}</span><span class="v${s.mono ? ' mono' : ''}">${s.v}</span></div>`).join('')}</div>`;
    },

    banner(html, kind) {
      return `<div class="seller-banner${kind ? ' banner-' + kind : ''}">${html}</div>`;
    },

    /* Loading placeholders shown while a tab fetches. */
    skeleton(kind) {
      if (kind === 'stats') {
        return `<div class="seller-stats">${'<div class="seller-stat skel"><span class="skel-line w40"></span><span class="skel-line w70"></span></div>'.repeat(8)}</div>`;
      }
      if (kind === 'cards') {
        return `<div class="seller-listings">${'<div class="skel-card"><span class="skel-line w40"></span><span class="skel-line w90"></span><span class="skel-line w60"></span></div>'.repeat(6)}</div>`;
      }
      return `<div class="panel skel-table">${'<span class="skel-line"></span>'.repeat(6)}</div>`;
    },

    empty(title, sub) {
      return `<div class="empty"><b>${esc(title)}</b>${sub ? `<p>${esc(sub)}</p>` : ''}</div>`;
    },

    /* Consistent failure state with a retry button (wired by the caller). */
    errorBox(msg) {
      return `<div class="empty"><b>Something went wrong</b><p>${esc(msg)}</p><button class="btn btn-sec" style="margin-top:14px" data-retry>Retry</button></div>`;
    },

    statusBadge(status) {
      const s = String(status || '').toLowerCase();
      const ok = ['paid', 'completed', 'active', 'verified'];
      const warn = ['rejected', 'removed', 'failed', 'unverified'];
      const cls = ok.includes(s) ? 'ok' : warn.includes(s) ? 'warn' : '';
      return `<span class="badge ${cls}">${esc(status || '—')}</span>`;
    },

    /**
     * Styled in-app modal (replaces native prompt/confirm). Returns a Promise.
     *  ui.dialog({ title, body, input, placeholder, confirmText, danger })
     *    - confirm: resolves input value (string) or true; cancel: resolves null.
     *  Pass `input: 'textarea'|'text'` to collect free text; omit for a confirm box.
     */
    dialog({ title = '', body = '', input = null, placeholder = '', confirmText = 'Confirm', cancelText = 'Cancel', danger = false, required = false } = {}) {
      return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'pd-overlay';
        overlay.innerHTML = `
          <div class="pd-box" role="dialog" aria-modal="true" aria-label="${esc(title)}">
            <h3 class="pd-title">${esc(title)}</h3>
            ${body ? `<p class="pd-body">${body}</p>` : ''}
            ${input === 'textarea'
              ? `<textarea class="pd-input" rows="4" placeholder="${esc(placeholder)}"></textarea>`
              : input === 'text'
                ? `<input class="pd-input" type="text" placeholder="${esc(placeholder)}">`
                : ''}
            <div class="pd-actions">
              <button type="button" class="btn btn-ghost" data-cancel>${esc(cancelText)}</button>
              <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-pri'}" data-ok>${esc(confirmText)}</button>
            </div>
          </div>`;
        document.body.appendChild(overlay);
        const inputEl = overlay.querySelector('.pd-input');
        const done = val => { overlay.remove(); document.body.style.overflow = ''; resolve(val); };
        document.body.style.overflow = 'hidden';
        overlay.addEventListener('click', e => { if (e.target === overlay) done(null); });
        overlay.querySelector('[data-cancel]').addEventListener('click', () => done(null));
        overlay.addEventListener('keydown', e => { if (e.key === 'Escape') done(null); });
        overlay.querySelector('[data-ok]').addEventListener('click', () => {
          if (!inputEl) return done(true);
          const v = inputEl.value.trim();
          if (required && !v) { inputEl.focus(); inputEl.classList.add('pd-invalid'); return; }
          done(v);
        });
        if (inputEl) { inputEl.focus(); inputEl.addEventListener('input', () => inputEl.classList.remove('pd-invalid')); }
        else overlay.querySelector('[data-ok]').focus();
      });
    },

    /* Run an async render into root with skeleton → content / error conventions. */
    async into(root, skeletonKind, fn) {
      root.innerHTML = ui.skeleton(skeletonKind);
      try {
        await fn();
      } catch (err) {
        root.innerHTML = ui.errorBox(err.message || 'Could not load');
      }
    },
  };

  /**
   * Data table with search, chip filters and pagination — one reusable engine.
   *   mount(el, {
   *     columns: [{ label, value(row) -> html, thClass }],
   *     rows: [..],
   *     rowActions: (row) -> html,          // trailing actions cell
   *     searchText: (row) -> string,        // enables the search box
   *     filters: [{ id, label, match(row) }],
   *     pageSize: 10,
   *     emptyText,
   *   }) -> { el }   // listen for 'action' events: { type, id, row }
   */
  function table(mountEl, cfg) {
    const state = { q: '', filter: cfg.filters?.[0]?.id ?? null, page: 1 };
    const pageSize = cfg.pageSize || 10;

    function filtered() {
      let rows = cfg.rows || [];
      if (state.filter && cfg.filters) {
        const f = cfg.filters.find(x => x.id === state.filter);
        if (f?.match) rows = rows.filter(f.match);
      }
      if (state.q && cfg.searchText) {
        const q = state.q.toLowerCase();
        rows = rows.filter(r => cfg.searchText(r).toLowerCase().includes(q));
      }
      return rows;
    }

    function render() {
      const rows = filtered();
      const pages = Math.max(1, Math.ceil(rows.length / pageSize));
      state.page = Math.min(state.page, pages);
      const pageRows = rows.slice((state.page - 1) * pageSize, state.page * pageSize);
      const hasActs = !!cfg.rowActions;
      const span = cfg.columns.length + (hasActs ? 1 : 0);

      const toolbar = (cfg.searchText || cfg.filters?.length > 1) ? `
        <div class="tbl-bar">
          ${cfg.searchText ? `<input class="tbl-search" type="search" placeholder="Search…" value="${esc(state.q)}">` : '<span></span>'}
          ${cfg.filters?.length > 1 ? `<nav class="chips" style="margin:0">${cfg.filters.map(f =>
            `<button class="chip ${state.filter === f.id ? 'on' : ''}" data-filter="${f.id}">${esc(f.label)}</button>`).join('')}</nav>` : ''}
        </div>` : '';

      const body = pageRows.length ? pageRows.map(row => `
        <tr>
          ${cfg.columns.map(c => `<td${c.tdClass ? ` class="${c.tdClass}"` : ''}>${c.value(row)}</td>`).join('')}
          ${hasActs ? `<td class="admin-act">${cfg.rowActions(row)}</td>` : ''}
        </tr>`).join('')
        : `<tr><td colspan="${span}">${ui.empty(cfg.emptyText || 'Nothing here yet', state.q ? 'No results match your search.' : '')}</td></tr>`;

      const pager = pages > 1 ? `
        <div class="tbl-pager">
          <span class="muted">${rows.length} result${rows.length === 1 ? '' : 's'} · page ${state.page}/${pages}</span>
          <span class="tbl-pager-btns">
            <button class="btn btn-ghost btn-sm" data-page="prev" ${state.page <= 1 ? 'disabled' : ''}>← Prev</button>
            <button class="btn btn-ghost btn-sm" data-page="next" ${state.page >= pages ? 'disabled' : ''}>Next →</button>
          </span>
        </div>` : (rows.length ? `<div class="tbl-pager"><span class="muted">${rows.length} result${rows.length === 1 ? '' : 's'}</span></div>` : '');

      mountEl.innerHTML = `
        ${toolbar}
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead><tr>${cfg.columns.map(c => `<th${c.thClass ? ` class="${c.thClass}"` : ''}>${esc(c.label)}</th>`).join('')}${hasActs ? '<th></th>' : ''}</tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>
        ${pager}`;

      $('.tbl-search', mountEl)?.addEventListener('input', debounce(e => { state.q = e.target.value; state.page = 1; render(); }, 180));
      $$('[data-filter]', mountEl).forEach(b => b.addEventListener('click', () => { state.filter = b.dataset.filter; state.page = 1; render(); }));
      $$('[data-page]', mountEl).forEach(b => b.addEventListener('click', () => {
        state.page += b.dataset.page === 'next' ? 1 : -1;
        render();
      }));
      $$('[data-act]', mountEl).forEach(b => b.addEventListener('click', () => {
        const row = (cfg.rows || []).find(r => String(cfg.key ? cfg.key(r) : r.id) === b.dataset.id);
        mountEl.dispatchEvent(new CustomEvent('action', { detail: { type: b.dataset.act, id: b.dataset.id, row } }));
      }));
    }

    render();
    return { el: mountEl, rerender: render };
  }

  /* ------------------------------ Panel shell ------------------------------ */

  /**
   * createPanel({ role, tabs: [[id, label]], render: (tabId, ctx) })
   * Boots the portal: session, login gate, tab nav, role checks.
   * ctx = { root, api, ui, toast, user } — panels keep their own state in ctx.state.
   */
  async function createPanel({ role, tabs, render }) {
    setSessionRole(role);
    AUTH = loadJSON(USER_KEY, null);
    updateUserHeader();

    const ctx = {
      role,
      state: {},
      get root() { return $('#panelRoot'); },
      get user() { return AUTH; },
      api, ui, toast, fmt, esc, table, CATS,
      async refreshUser() { return fetchMe(); },
    };

    let currentTab = tabs[0][0];

    async function show(tabId) {
      currentTab = tabId;
      const tabsNav = $('#panelTabs');
      if (tabsNav) {
        tabsNav.innerHTML = tabs.map(([id, label]) =>
          `<button class="chip ${currentTab === id ? 'on' : ''}" data-tab="${id}">${label}</button>`).join('');
      }
      await render(currentTab, ctx);
    }

    ctx.showTab = show;
    ctx.currentTab = () => currentTab;

    function enterApp() {
      showApp();
      const tabsNav = $('#panelTabs');
      if (tabsNav && !tabsNav.dataset.bound) {
        tabsNav.dataset.bound = '1';
        tabsNav.addEventListener('click', e => {
          const b = e.target.closest('[data-tab]');
          if (b) show(b.dataset.tab);
        });
      }
      show(currentTab);
    }

    bindLoginForm(async user => {
      if (role === 'admin' && !user.isAdmin) {
        clearSession();
        throw new Error('Admin access required for this portal');
      }
      if (role === 'seller' && !user.isSeller && !user.seller) {
        const apply = confirm('No seller account on this email.\n\nApply to become a seller?');
        if (!apply) throw new Error('Seller account required');
        const data = await api('/api/seller/apply', { method: 'POST' });
        saveSession(data.user);
      }
      enterApp();
    });

    // One-time invite link lands on the seller login as ?invite=<token>. The
    // seller sets a password here; the server creates the verified account and
    // returns a session. The token is single-use.
    if (role === 'seller') bindInviteClaim();

    if (hasApiSession()) {
      try {
        const user = await fetchMe();
        if (role === 'admin' && !user.isAdmin) { clearSession(); showLogin(); return; }
        if (role === 'seller' && !user.isSeller && !user.seller) { clearSession(); showLogin(); return; }
        enterApp();
        return;
      } catch (e) {
        clearSession();
      }
    }
    showLogin();
  }

  /* Render a "set your password" form when the URL carries an invite token. */
  function bindInviteClaim() {
    let token = '';
    try {
      const url = new URL(window.location.href);
      token = url.searchParams.get('invite') || '';
    } catch (e) {}
    if (!token) return;
    const gate = $('#loginGate');
    if (!gate) return;
    gate.innerHTML = `
      <h1>Set up your seller account</h1>
      <p>This one-time invite creates your verified seller login. Choose a password to finish.</p>
      <form id="inviteForm">
        <label class="sf"><span>Your name</span>
          <input id="inviteName" type="text" autocomplete="name" placeholder="Display name (optional)">
        </label>
        <label class="sf"><span>Choose a password</span>
          <input id="invitePass" type="password" autocomplete="new-password" placeholder="At least 8 characters" minlength="8" required>
        </label>
        <p class="muted" id="inviteErr" style="color:var(--danger);font-size:13px;min-height:18px"></p>
        <button class="btn btn-pri" type="submit" id="inviteSubmit">Create account &amp; sign in</button>
      </form>`;
    showLogin();
    $('#inviteForm').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = $('#inviteSubmit');
      const err = $('#inviteErr');
      if (err) err.textContent = '';
      if (btn) { btn.disabled = true; btn.textContent = 'Creating account…'; }
      try {
        const r = await fetch('/api/seller-invite/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, name: $('#inviteName')?.value || '', password: $('#invitePass')?.value || '' }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.msg || data.error || 'Could not claim invite');
        saveSession(data.user, data.token);
        try { history.replaceState(null, '', window.location.pathname); } catch (e2) {}
        location.reload();
      } catch (ex) {
        if (err) err.textContent = ex.message;
        if (btn) { btn.disabled = false; btn.textContent = 'Create account & sign in'; }
      }
    });
  }

  Object.assign(window, { $, $$, fmt, esc, toast, CATS, api, authHeaders, hasApiSession, getAuthToken });
  Object.defineProperty(window, 'AUTH', {
    get() { return AUTH; },
    set(v) { AUTH = v; },
    configurable: true,
  });

  window.PanelCommon = {
    boot: createPanel,          // new canonical entry
    createPanel,
    saveSession, clearSession, fetchMe, showLogin, showApp,
    api, ui, table, toast, esc, fmt, CATS,
  };
})();
