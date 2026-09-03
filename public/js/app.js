/* ================= data ================= */
const CATS = [
  { id: 'all',           label: 'All' },
  { id: 'accounts',      label: 'Accounts' },
  { id: 'subscriptions', label: 'Subscriptions' },
  { id: 'software',      label: 'Software' },
  { id: 'services',      label: 'Services' },
  { id: 'digital',       label: 'Digital' },
  { id: 'gaming',        label: 'Gaming' },
];
const CATGRAD = {
  accounts:      ['#5b6cff', '#8e54e9'],
  subscriptions: ['#e0457a', '#f27a4d'],
  software:      ['#0ea5a4', '#3ecf8e'],
  services:      ['#f5b544', '#f27a4d'],
  digital:       ['#7a5af8', '#c94fd8'],
  gaming:        ['#3a86ff', '#37d5ee'],
};
const CATTAGS = {
  accounts:      ['Full access', '48h inspection'],
  subscriptions: ['Instant delivery', 'Auto-renew'],
  software:      ['Lifetime updates', 'Source included'],
  services:      ['Milestones', 'Portfolio ready'],
  digital:       ['Instant delivery', 'Free updates'],
  gaming:        ['Face-to-face', 'Rank checked'],
};
const RINGS = '<svg width="150" height="150" viewBox="0 0 150 150" fill="none" aria-hidden="true"><circle cx="75" cy="75" r="70" stroke="#fff" stroke-width="1.4"/><circle cx="75" cy="75" r="50" stroke="#fff" stroke-width="1.4"/><circle cx="75" cy="75" r="30" stroke="#fff" stroke-width="1.4"/></svg>';
const ICONS = {
  accounts:      '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="8" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>',
  subscriptions: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9.5 4.5 2.5-4.5 2.5v-5Z" fill="#fff" stroke="none"/></svg>',
  software:      '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m8 8-4 4 4 4M16 8l4 4-4 4M13 5l-2 14"/></svg>',
  services:      '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7.5" width="18" height="12" rx="3"/><path d="M9 7.5V6a3 3 0 0 1 6 0v1.5M3 13h18"/></svg>',
  digital:       '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v10m0 0 3.5-3.5M12 13 8.5 9.5"/><path d="M4 15v3a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-3"/></svg>',
  gaming:        '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 8h10a5 5 0 0 1 5 5v1.5a3.5 3.5 0 0 1-6.2 2.2L14.5 15h-5l-1.3 1.7A3.5 3.5 0 0 1 2 14.5V13a5 5 0 0 1 5-5Z"/><path d="M8 11v3M6.5 12.5h3"/><circle cx="16" cy="11.5" r=".9" fill="#fff"/><circle cx="18" cy="13.5" r=".9" fill="#fff"/></svg>',
};
const AVAHUE = n => {
  const tones = ['#3f3f46', '#52525b', '#404040', '#4b5563', '#57534e', '#44403c'];
  let i = 0; for (const c of n) i = (i * 31 + c.charCodeAt(0)) % tones.length;
  return `background:${tones[i]};color:#fafafa`;
};
const initials = n => esc(String(n || '').split(/[\s.]+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase());
const fmt = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const VFY = '<svg class="s-vfy" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-label="Verified seller"><path d="M12 2 14.6 4.1l3.3-.3.7 3.2 2.9 1.7-1.4 3 1.4 3-2.9 1.7-.7 3.2-3.3-.3L12 22l-2.6-2.1-3.3.3-.7-3.2-2.9-1.7 1.4-3-1.4-3 2.9-1.7.7-3.2 3.3.3L12 2Z" opacity=".25"/><path d="M12 2 14.6 4.1l3.3-.3.7 3.2 2.9 1.7-1.4 3 1.4 3-2.9 1.7-.7 3.2-3.3-.3L12 22l-2.6-2.1-3.3.3-.7-3.2-2.9-1.7 1.4-3-1.4-3 2.9-1.7.7-3.2 3.3.3L12 2Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m8.8 12.2 2.2 2.2 4.2-4.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const LISTINGS_SEED = [];

let LISTINGS = LISTINGS_SEED.map(l => ({
  ...l,
  sellerEmail: l.sellerEmail || (() => {
    const slug = String(l.seller?.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
    return (slug || 'seller') + '@sellers.dot.market';
  })(),
}));

async function loadListings() {
  try {
    const r = await fetch('/api/listings');
    if (!r.ok) return;
    const { listings } = await r.json();
    LISTINGS = (listings || []).map(l => ({
      ...l,
      age: l.age ?? l.ageDays ?? 0,
      sellerEmail: l.sellerEmail || '',
    }));
    renderGrid();
    renderChips();
    renderTopSellers();
    renderHero();
    renderPopular();
  } catch (e) { /* keep current listings */ }
}

function loadJSON(k, dflt) {
  try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? dflt : v; } catch (e) { return dflt; }
}
function skey(base) { return base + '@' + (AUTH ? AUTH.email : 'guest'); }
function saveState() {
  try {
    localStorage.setItem(skey('dk_deals'), JSON.stringify(DEALS));
    localStorage.setItem(skey('dk_bal'), String(BAL));
    localStorage.setItem(skey('dk_txs'), JSON.stringify(TXS));
  } catch (e) {}
  pushState();
}
function loadState(freshAccount) {
  remoteReady = false;
  const hasSaved = (k) => { try { return localStorage.getItem(skey(k)) != null; } catch (e) { return false; } };
  if (!AUTH) {
    DEALS = []; TXS = []; CHATS = [];
  } else {
    DEALS = loadJSON(skey('dk_deals'), []);
    TXS = loadJSON(skey('dk_txs'), []);
    CHATS = [];
  }
  const b = AUTH ? parseFloat(loadJSON(skey('dk_bal'), NaN)) : 0;
  BAL = isNaN(b) ? WALLET_SEED : b;
  S.chat = null; S.dealTab = 'all';
}
function refreshUserViews() {
  renderDeals(); renderDealTabs(); renderDealsPage();
  renderTxs(); paintBal(); paintLocked();
  renderChatList(); renderThread(); paintChatBadge();
  renderGrid();
  saveState();
}
let pushTimer = null;
let remoteReady = false;
function pushState() {
  // Always cancel a pending push first — a timer scheduled just before
  // sign-out / account-switch must never fire with the old session's token
  // (it would overwrite that account's server-side state with the reset one).
  clearTimeout(pushTimer);
  pushTimer = null;
  let token = null;
  try { token = localStorage.getItem('dk_token'); } catch (e) {}
  if (!token || !remoteReady) return;
  pushTimer = setTimeout(() => {
    let current = null;
    try { current = localStorage.getItem('dk_token'); } catch (e) {}
    if (!current || current !== token) return; // signed out or switched account
    fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ state: { deals: DEALS, bal: BAL, txs: TXS } }),
    }).catch(() => {});
  }, 700);
}
function applyRemoteState(st) {
  DEALS = Array.isArray(st.deals) ? st.deals : [];
  TXS = Array.isArray(st.txs) ? st.txs : [];
  CHATS = [];
  const b = parseFloat(st.bal);
  BAL = isNaN(b) ? 0 : b;
  S.chat = null; S.dealTab = 'all';
  try {
    localStorage.setItem(skey('dk_deals'), JSON.stringify(DEALS));
    localStorage.setItem(skey('dk_bal'), String(BAL));
    localStorage.setItem(skey('dk_txs'), JSON.stringify(TXS));
  } catch (e) {}
  refreshUserViews();
}
// Clear a stale/expired session (e.g. server restarted on the in-memory store)
// so the UI stops pretending to be signed in.
function handleSessionExpired() {
  try { localStorage.removeItem('dk_user'); localStorage.removeItem('dk_token'); } catch (e) {}
  AUTH = null;
  remoteReady = false;
  paintAuth();
  loadState(false);
  refreshUserViews();
}

async function syncFromServer() {
  let token = null;
  try { token = localStorage.getItem('dk_token'); } catch (e) {}
  if (!token || !AUTH) return;
  try {
    const meR = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + token } });
    if (meR.status === 401) {
      handleSessionExpired();
      toast('Session expired — please sign in again', 'info');
      return;
    }
    if (meR.ok) {
      const { user } = await meR.json();
      if (user) {
        AUTH = { name: user.name, email: user.email, isSeller: user.isSeller, isAdmin: user.isAdmin, seller: user.seller };
        try { localStorage.setItem('dk_user', JSON.stringify(AUTH)); } catch (e) {}
        paintAuth();
      }
    }
    const r = await fetch('/api/state', { headers: { Authorization: 'Bearer ' + token } });
    if (r.ok) {
      const { state } = await r.json();
      remoteReady = true;
      if (state) applyRemoteState(state);
      else pushState();
      await syncChatInbox();
      syncDealStates();
      loadListings();
    }
  } catch (e) { /* offline — local cache keeps working */ }
}
/* Reconcile local deal cards with the server-side escrow state, so outcomes the
 * buyer didn't trigger (admin release / refund after a dispute) show up. */
const ESCROW_TO_DEAL = {
  held:      { status: 'escrow',  steps: 2, note: 'Held in escrow until you confirm delivery' },
  delivered: { status: 'escrow',  steps: 3, note: 'Seller marked delivered — confirm to release funds' },
  dispute:   { status: 'dispute', steps: 3, note: 'Disputed — awaiting admin arbitration' },
  released:  { status: 'done',    steps: 4, note: 'Released to seller' },
  refunded:  { status: 'cancelled', steps: 4, note: 'Refunded to your wallet by admin' },
};
async function syncDealStates() {
  if (!hasApiSession()) return;
  try {
    const r = await fetch('/api/buyer/orders', { headers: authHeaders() });
    if (!r.ok) return;
    const { orders } = await r.json();
    let changed = false;
    let refundedAny = false;
    for (const o of orders || []) {
      const d = DEALS.find(x => x.id === o.orderId);
      if (!d) continue;
      // Payment-level cancellation / expiry: the checkout died unpaid, so the
      // local "awaiting payment" deal can never complete — cancel it locally so
      // the listing is buyable again.
      if (['cancelled', 'expired'].includes(o.status) && d.status === 'wait') {
        d.status = 'cancelled';
        d.steps = 4;
        d.note = o.status === 'expired' ? 'Checkout expired unpaid' : 'Checkout cancelled';
        if (!d.completedAt) d.completedAt = new Date().toISOString();
        changed = true;
        continue;
      }
      if (!o.escrowStatus) continue;
      const map = ESCROW_TO_DEAL[o.escrowStatus];
      if (!map) continue;
      const wasRefund = o.escrowStatus === 'refunded' && d.status !== 'cancelled';
      if (d.status !== map.status || d.steps !== map.steps) {
        d.status = map.status;
        d.steps = map.steps;
        d.note = map.note;
        if (map.status === 'done' || map.status === 'cancelled') {
          if (!d.completedAt) d.completedAt = new Date().toISOString();
        }
        if (wasRefund) refundedAny = true;
        changed = true;
      }
    }
    if (refundedAny) await refreshWalletBalance();
    if (changed) {
      saveState();
      renderDeals(); renderDealTabs(); renderDealsPage(); paintLocked(); renderGrid();
    }
  } catch (e) { /* offline */ }
}

function migrateLegacy() {
  try {
    ['dk_deals', 'dk_bal', 'dk_txs', 'dk_chats'].forEach(k => {
      const v = localStorage.getItem(k);
      if (v != null) {
        if (localStorage.getItem(k + '@guest') == null) localStorage.setItem(k + '@guest', v);
        localStorage.removeItem(k);
      }
    });
  } catch (e) {}
}
let DEALS = [];
let CHATS = [];
const DEALMETA = {
  wait:    { cls: 'wait',    lbl: 'Awaiting payment' },
  escrow:  { cls: 'escrow',  lbl: 'In escrow' },
  dispute: { cls: 'dispute', lbl: 'Dispute' },
  done:    { cls: 'done',    lbl: 'Completed' },
  cancelled: { cls: 'cancel', lbl: 'Cancelled' },
};

/* ================= state ================= */
const S = { cat: 'all', q: '', sort: 'new', vfy: false };

/* ================= market ================= */
const $ = s => document.querySelector(s);
const grid = $('#grid'), chipsEl = $('#chips');

function catCount(id) { return id === 'all' ? LISTINGS.length : LISTINGS.filter(l => l.cat === id).length; }

function renderChips() {
  chipsEl.innerHTML = CATS.map(c => {
    const dot = c.id === 'all' ? '' : `<span class="cdot" style="background:${CATGRAD[c.id][0]}"></span>`;
    return `<button class="chip ${S.cat === c.id ? 'on' : ''}" data-cat="${c.id}">${dot}${c.label}<span class="n">${catCount(c.id)}</span></button>`;
  }).join('');
}

const POP_LABELS = {
  accounts: 'Popular Accounts',
  subscriptions: 'Popular Subscriptions',
  software: 'Popular Software',
  services: 'Popular Services',
  digital: 'Popular Digital Goods',
  gaming: 'Popular Gaming',
};

function renderHero() {
  const el = $('#hero');
  if (!el) return;
  const featured = LISTINGS.find(l => l.featured) || LISTINGS[0];
  const cta = featured
    ? `<button class="hero-btn" data-hero-open="${featured.id}">Browse the market <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>`
    : `<button class="hero-btn" data-go="market">Browse the market <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>`;
  el.innerHTML = `
    <div class="hero-in">
      <div class="hero-txt">
        <span class="hero-badge"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 5.8v5.4c0 4.3 3 7.4 7 9 4-1.6 7-4.7 7-9V5.8L12 3Z"/><path d="m9 11.6 2.2 2.2L15.4 9.6"/></svg>Escrow on every deal</span>
        <h1>Buy &amp; sell digital goods, <em>risk-free.</em></h1>
        <p>Every payment locks in escrow until you confirm delivery. Sellers get paid on proof, not promises — and a dispute freezes the funds, never your patience.</p>
        <div class="hero-ctas">
          ${cta}
          <a class="hero-btn-ghost" href="/seller/">Start selling</a>
        </div>
        <div class="hero-stats">
          <div class="hero-stat"><b>312</b><span>deals this week</span></div>
          <span class="hero-stat-div"></span>
          <div class="hero-stat"><b>$84k</b><span>held in escrow</span></div>
          <span class="hero-stat-div"></span>
          <div class="hero-stat"><b>98.2%</b><span>completed clean</span></div>
        </div>
      </div>
      <div class="hero-art" aria-hidden="true">
        <div class="hcard-wrap">
          <div class="hcard">
            <div class="hcard-top">
              <span class="hcard-ava"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9h4M8 7v4M15.5 8.5h.01M17.5 11h.01"/><path d="M17.3 5H6.7a4.7 4.7 0 0 0-4.6 3.9L1 16.5A2.6 2.6 0 0 0 3.6 19.5c.8 0 1.6-.4 2.1-1L7.5 16h9l1.8 2.5c.5.6 1.3 1 2.1 1a2.6 2.6 0 0 0 2.6-3l-1.1-7.6A4.7 4.7 0 0 0 17.3 5Z"/></svg></span>
              <span class="hcard-meta"><b>Steam account · 120+ games</b><span>@dusk_trader · ★ 4.9 · verified</span></span>
              <span class="hcard-price mono">49.00<i>USDT</i></span>
            </div>
            <div class="hcard-steps">
              <span class="on">Paid</span><i class="on"></i><span class="on">Delivered</span><i class="on"></i><span class="now">In escrow</span><i></i><span>Released</span>
            </div>
            <div class="hcard-bar"><span></span></div>
            <div class="hcard-foot">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 5.8v5.4c0 4.3 3 7.4 7 9 4-1.6 7-4.7 7-9V5.8L12 3Z"/><path d="m9 11.6 2.2 2.2L15.4 9.6"/></svg>
              <span>Funds locked in escrow</span>
              <b class="mono">49.00 USDT</b>
            </div>
          </div>
          <div class="hchip hchip-1"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m4.5 12.5 5 5 10-11"/></svg>Delivered in deal chat</div>
          <div class="hchip hchip-2"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>Escrow held · 2h 14m</div>
          <div class="hcoin mono">₮</div>
        </div>
      </div>
    </div>`;
}

function renderPopular() {
  const wrap = $('#popularWrap');
  if (!wrap) return;
  const cats = CATS.filter(c => c.id !== 'all');
  wrap.innerHTML = `
    <section class="cat-section" aria-label="Browse categories">
      <div class="cat-scroll-head">
        <div class="cat-scroll-title">
          <h2>Browse categories</h2>
          <p>Explore listings by type</p>
        </div>
        <button class="cat-scroll-all" type="button" data-cat="all">View all</button>
      </div>
      <div class="cat-grid">${cats.map(c => {
        const count = LISTINGS.filter(l => l.cat === c.id).length;
        const active = S.cat === c.id ? ' on' : '';
        const icon = (ICONS[c.id] || '')
          .replace(/stroke="#fff"/g, 'stroke="currentColor"')
          .replace(/fill="#fff"/g, 'fill="currentColor"');
        return `
        <button class="cat-tile${active}" data-cat="${c.id}" type="button" aria-pressed="${S.cat === c.id}">
          <span class="cat-tile-icon" style="--cat-a:${CATGRAD[c.id][0]};--cat-b:${CATGRAD[c.id][1]}">
            <span class="cat-tile-svg">${icon}</span>
          </span>
          <span class="cat-tile-body">
            <span class="cat-tile-name">${c.label}</span>
            <span class="cat-tile-count">${count || 'No'} listing${count === 1 ? '' : 's'}</span>
          </span>
        </button>`;
      }).join('')}
      </div>
    </section>`;
}

function filtered() {
  let out = LISTINGS.filter(l =>
    (S.cat === 'all' || l.cat === S.cat) &&
    (!S.vfy || l.seller.vfy) &&
    (!S.q || (l.title + ' ' + l.seller.name).toLowerCase().includes(S.q))
  );
  const by = {
    new:  (a, b) => a.age - b.age,
    plo:  (a, b) => a.price - b.price,
    phi:  (a, b) => b.price - a.price,
    rate: (a, b) => b.seller.rate - a.seller.rate,
  }[S.sort] || ((a, b) => a.age - b.age);
  return out.sort(by);
}

function skeletons() {
  grid.innerHTML = Array.from({ length: 8 }, () =>
    '<div class="sk" aria-hidden="true"><div class="a"></div><div class="b"></div><div class="c"></div></div>').join('');
}

function escChip() {
  return `<span class="esc-chip"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 5.8v5.4c0 4.3 3 7.4 7 9 4-1.6 7-4.7 7-9V5.8L12 3Z"/><path d="m9 11.6 2.2 2.2L15.4 9.6"/></svg>Escrow</span>`;
}

const ACTIVE_LBL = { wait: 'Awaiting payment', escrow: 'In escrow', dispute: 'In dispute' };
function activeDealFor(lid) {
  return DEALS.find(d => d.lid === lid && ACTIVE_LBL[d.status]);
}
function renderGrid() {
  const list = filtered();
  $('#mkCount').textContent = list.length + (list.length === 1 ? ' listing' : ' listings');
  if (!list.length) {
    grid.innerHTML = LISTINGS.length
      ? `<div class="empty"><b>Nothing matches</b>Try another category, or clear the search and filters.</div>`
      : `<div class="empty"><b>No listings yet</b>New listings will appear here once sellers post them.</div>`;
    return;
  }
  grid.innerHTML = list.map((l) => {
    const catLabel = (CATS.find(c => c.id === l.cat) || { label: l.cat || 'Other' }).label;
    const hasImg = !!l.image;
    return `
    <button class="card" data-open="${l.id}" aria-label="${esc(l.title)} — ${fmt(l.price)} USDT">
      <span class="thumb thumb-cat-${l.cat}${hasImg ? ' has-img' : ''}">
        <span class="cat-tag">${catLabel}</span>
        ${hasImg ? `<img class="thumb-img card-img" src="${esc(l.image)}" alt="${esc(l.title)}" loading="lazy">` : `<span class="tile">${ICONS[l.cat] || ''}</span>`}
        ${escChip()}
      </span>
      <span class="card-body" style="display:block">
        <span class="card-title" style="display:-webkit-box">${esc(l.title)}</span>
        <span class="card-price">${l.variants?.length ? '<span class="from">From</span> ' : ''}<span class="p mono">${fmt(l.price)}</span><span class="c">USDT</span></span>
        <span class="card-seller">
          <span class="s-ava" style="${AVAHUE(l.seller.name)}">${initials(l.seller.name)}</span>
          <span class="s-name seller-link" data-seller-profile="${esc(l.sellerEmail)}" data-seller-name="${esc(l.seller.name)}" role="link" tabindex="0">${esc(l.seller.name)}</span>${l.seller.vfy ? VFY : ''}
          <span class="s-meta"><span class="st">★</span>${l.seller.rate.toFixed(1)} · ${l.seller.deals} deals</span>
        </span>
        <span class="card-tags" style="display:flex">${activeDealFor(l.id) ? `<span class="ctag active">${ACTIVE_LBL[activeDealFor(l.id).status]}</span>` : ''}${(CATTAGS[l.cat] || []).map(t => `<span class="ctag">${t}</span>`).join('')}</span>
      </span>
    </button>`;
  }).join('');
}

function refresh() { skeletons(); setTimeout(renderGrid, S.q || S.cat !== 'all' ? 120 : 200); }

/* ================= escrow desk ================= */
function renderDeals() {
  if (!DEALS.length) {
    $('#deals').innerHTML = `<div class="deal-note" style="padding:6px 2px">${AUTH
      ? 'No deals yet — buy anything and your escrow appears here.'
      : 'Sign in and your escrows will appear here.'}</div>`;
    return;
  }
  $('#deals').innerHTML = DEALS.slice(0, 3).map(d => {
    const m = DEALMETA[d.status] || { cls: 'wait', lbl: d.status || 'Unknown' };
    return `
    <div class="deal">
      <div class="deal-top"><span class="deal-id mono">${esc(d.id)}</span><span class="pill ${m.cls}">${m.lbl}</span></div>
      <div class="deal-title">${esc(d.title)}</div>
      <div class="deal-amt mono">${fmt(d.amt)} USDT</div>
      <div class="deal-steps">${[1,2,3,4].map(i =>
        `<span class="dstep ${i < d.steps ? 'full' : i === d.steps ? (d.status === 'done' ? 'full' : d.status === 'dispute' ? '' : 'now') : ''}" ${d.status === 'dispute' && i === d.steps ? 'style="background:var(--danger)"' : ''}></span>`).join('')}</div>
      <div class="deal-note">${esc(d.note)}</div>
    </div>`;
  }).join('');
}

function renderTopSellers() {
  const seen = new Map();
  LISTINGS.forEach(l => seen.set(l.seller.name, l.seller));
  const top = [...seen.values()].sort((a, b) => b.rate - a.rate || b.deals - a.deals).slice(0, 4);
  $('#topSellers').innerHTML = top.map(s => `
    <div class="seller-row">
      <span class="s-ava" style="${AVAHUE(s.name)}">${initials(s.name)}</span>
      <span><span class="nm">${esc(s.name)} ${s.vfy ? VFY : ''}</span><span class="mt">${s.deals} deals · since ${esc(s.since)}</span></span>
      <span class="rt"><span class="st">★</span>${s.rate.toFixed(1)}</span>
    </div>`).join('');
}

/* ================= fees ================= */
let FEES = {
  platformFeePercent: 2.5,
  gatewayFeePercent: 0,
  provider: '',
  gatewayFeePaidBy: null,
  buyerPaysGatewayFee: false,
};
let PAY_CFG = { configured: false, sandbox: false, provider: '' };

// Crypto checkout runs on whichever single native chain the server has
// configured (PAYMENT_PROVIDER) — there is no buyer-facing network choice.
function isCryptoPayMethod(method) {
  return method === 'crypto';
}

function calcLocalFees(listingAmount, method = 'wallet') {
  const listing = parseFloat(listingAmount) || 0;
  const pf = (FEES.platformFeePercent || 2.5) / 100;
  const platformFee = Math.round(listing * pf * 100) / 100;
  const sellerNet = Math.round((listing - platformFee) * 100) / 100;
  return {
    listingAmount: listing,
    amount: listing,
    buyerTotal: listing,
    platformFee,
    gatewayFee: 0,
    gatewayFeePercent: 0,
    sellerNet,
    platformFeePercent: FEES.platformFeePercent,
  };
}

function paintFeeLabels() {
  const pct = FEES.platformFeePercent ?? 2.5;
  const el = $('#escrowFeePct');
  if (el) el.textContent = pct + '% of the deal';
  const gwEl = $('#escrowGatewayFee');
  if (gwEl) gwEl.textContent = 'No processing fee — paid directly to the seller\'s wallet';
}

async function loadFeeConfig() {
  try {
    const r = await fetch('/api/payments/config');
    if (!r.ok) return;
    const data = await r.json();
    if (data.fees) FEES = { ...FEES, ...data.fees };
    if (data.provider) FEES.provider = data.provider;
    PAY_CFG = {
      configured: !!data.configured,
      sandbox: !!data.sandbox,
      provider: data.provider || FEES.provider,
    };
    paintFeeLabels();
  } catch (e) {}
}

function setPayError(msg) {
  const el = $('#payError');
  if (!el) return;
  if (msg) {
    el.textContent = msg;
    el.hidden = false;
  } else {
    el.textContent = '';
    el.hidden = true;
  }
}

/* ================= modal ================= */
const overlay = $('#overlay'), sheet = $('#sheet');
let lastFocus = null;

function sellerInboxEmail(name) {
  const slug = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
  return (slug || 'seller') + '@sellers.dot.market';
}

function openListing(id) {
  const l = LISTINGS.find(x => x.id === id);
  if (!l) return;
  const hasVariants = !!l.variants?.length;
  // Multi-price listing (e.g. one "Apple Gift Card" listing with $10/$50/$100
  // options) — default to the first/cheapest option until the buyer picks one.
  let selected = hasVariants ? l.variants[0] : null;
  lastFocus = document.activeElement;
  const hasImg = !!l.image;

  function priceBlockHtml() {
    const price = selected ? selected.price : l.price;
    const fees = calcLocalFees(price);
    const picker = hasVariants ? `
      <div class="variant-picker" role="group" aria-label="Choose a price option">
        ${l.variants.map(v => `
          <button type="button" class="variant-opt ${selected.id === v.id ? 'on' : ''}" data-variant-opt="${esc(v.id)}">
            <span class="vp-label">${esc(v.label)}</span><span class="vp-price mono">${fmt(v.price)}</span>
          </button>`).join('')}
      </div>` : '';
    return `
      ${picker}
      <div class="sheet-price"><span class="p mono">${fmt(price)}</span><span class="c">USDT</span></div>
      <div class="fees">
        <div class="fee-row"><span class="k">Item price</span><span class="mono">${fmt(price)} USDT</span></div>
        <div class="fee-row total"><span class="k">You pay</span><span class="mono">${fmt(fees.buyerTotal)} USDT</span></div>
      </div>
      <p class="fee-note">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 5.8v5.4c0 4.3 3 7.4 7 9 4-1.6 7-4.7 7-9V5.8L12 3Z"/><path d="m9 11.6 2.2 2.2L15.4 9.6"/></svg>
        No added processing fee, whether you pay with Dot Wallet or crypto.
      </p>`;
  }

  function bindVariantPicker() {
    if (!hasVariants) return;
    sheet.querySelectorAll('[data-variant-opt]').forEach(btn => {
      btn.addEventListener('click', () => {
        selected = l.variants.find(v => v.id === btn.dataset.variantOpt) || selected;
        const block = $('#sheetPriceBlock');
        if (block) block.innerHTML = priceBlockHtml();
        bindVariantPicker();
        const buyBtn = sheet.querySelector('[data-buy]');
        if (buyBtn) buyBtn.dataset.variant = selected.id;
      });
    });
  }

  sheet.innerHTML = `
  <button class="sheet-x" data-close aria-label="Close">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l14 14M19 5 5 19"/></svg>
  </button>
  <div class="sheet-scroll">
    <div class="sheet-grid">
      <div class="sheet-media thumb-cat-${l.cat}${hasImg ? ' has-img' : ''}">
        <span class="cat-tag">${(CATS.find(c => c.id === l.cat) || { label: l.cat || 'Other' }).label}</span>
        ${hasImg ? `<img class="thumb-img" src="${esc(l.image)}" alt="${esc(l.title)}" loading="lazy">` : `<span class="tile">${ICONS[l.cat] || ''}</span>`}
      </div>
      <div class="sheet-info">
        <h3>${esc(l.title)}</h3>
        <div id="sheetPriceBlock">${priceBlockHtml()}</div>
        <p class="sheet-desc">${esc(l.desc)}</p>
        <div class="sheet-seller">
          <span class="s-ava" style="${AVAHUE(l.seller.name)}">${initials(l.seller.name)}</span>
          <span><span class="nm seller-link" data-seller-profile="${esc(l.sellerEmail)}" data-seller-name="${esc(l.seller.name)}" role="link" tabindex="0">${esc(l.seller.name)}</span> ${l.seller.vfy ? VFY : ''}<span class="mt">★ ${l.seller.rate.toFixed(1)} · ${l.seller.deals} deals · since ${esc(l.seller.since)}</span></span>
          <button class="msg" data-msg="${esc(l.seller.name)}" data-lid="${esc(l.id)}">Message</button>
        </div>
      </div>
    </div>
  </div>
  <div class="sheet-footer">
    <div class="buybar">
      ${activeDealFor(l.id)
        ? `<button class="btn btn-pri done" data-godeal>Deal in progress — view deal</button>`
        : `<button class="btn btn-pri" data-buy="${l.id}" data-variant="${selected ? esc(selected.id) : ''}">Buy with escrow</button>`}
      <button class="btn btn-sec" data-demo>Make an offer</button>
    </div>
  </div>`;
  bindVariantPicker();
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  sheet.querySelector('[data-close]').focus();
}

function closeListing() {
  overlay.classList.remove('open');
  document.body.style.overflow = '';
  if (lastFocus) lastFocus.focus();
}

function newDealId() {
  let id;
  do { id = 'DK-' + (1000 + Math.floor(Math.random() * 9000)); }
  while (DEALS.some(d => d.id === id));
  return id;
}

function buy(id, variantId) {
  const l = LISTINGS.find(x => x.id === id);
  if (!l) return;
  if (!AUTH) { openAuth('up', () => buy(id, variantId)); toast('Sign up to start your first escrow deal', 'info'); return; }
  if (activeDealFor(l.id)) {
    toast('You already have an active deal on this listing', 'info');
    return;
  }
  openPaymentModal({ listingId: id, variantId });
}

/* ================= payment ================= */
let payCtx = null;

// The server accepts exactly one crypto network at a time (whatever
// PAYMENT_PROVIDER selects) — there is no buyer-facing network picker.
const PAY_METHODS = [
  { id: 'wallet', label: 'Dot Wallet', desc: 'Pay from your USDT balance', badge: 'Instant', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h.01"/></svg>' },
  { id: 'crypto', label: 'Pay with crypto', desc: 'Send directly on-chain to the seller\'s escrow address', badge: '', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8"/></svg>' },
];

const PAY_METHOD_LABELS = Object.fromEntries(PAY_METHODS.map(m => [m.id, m.label]));

function openPaymentModal({ listingId, dealId, variantId }) {
  if (!AUTH) {
    openAuth('up', () => openPaymentModal({ listingId, dealId, variantId }));
    toast('Sign in to pay with escrow', 'info');
    return;
  }
  if (!hasApiSession()) {
    openAuth('in', () => openPaymentModal({ listingId, dealId, variantId }));
    toast('Sign in again to pay', 'info');
    return;
  }

  void (async () => {
  let deal = null;
  let listing = null;
  if (dealId) {
    deal = DEALS.find(d => d.id === dealId);
    if (!deal || deal.status !== 'wait' || deal.role !== 'buyer') return;
    listing = LISTINGS.find(l => l.id === deal.lid);
  } else if (listingId) {
    listing = LISTINGS.find(l => l.id === listingId);
    if (!listing) return;
    if (activeDealFor(listingId)) {
      toast('You already have an active deal on this listing', 'info');
      return;
    }
  } else return;

  await loadFeeConfig();

  // Resuming a pending deal carries its variant on the deal itself; starting
  // fresh from a listing carries it via the variantId argument (from the
  // buyer's selection in the listing sheet).
  const variant = listing?.variants?.length
    ? listing.variants.find(v => v.id === (deal?.variantId ?? variantId)) || null
    : null;

  const amount = deal?.amt ?? (variant ? variant.price : listing?.price);
  let method = BAL >= amount ? 'wallet' : 'crypto';
  if (isCryptoPayMethod(method) && !PAY_CFG.configured) method = 'wallet';

  payCtx = {
    listingId: listing?.id || deal?.lid,
    deal,
    listing,
    amount,
    variantId: deal?.variantId ?? variant?.id ?? null,
    title: deal?.title ?? (variant ? `${listing.title} — ${variant.label}` : listing?.title),
    sellerName: deal?.who ?? listing?.seller?.name,
    sellerEmail: deal?.sellerEmail ?? listing?.sellerEmail ?? '',
    method,
  };

  renderPaymentModal();
  $('#payOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  })();
}

function closePaymentModal() {
  $('#payOverlay').classList.remove('open');
  document.body.style.overflow = overlay.classList.contains('open') ? 'hidden' : '';
  payCtx = null;
}

function renderPaymentModal() {
  const c = payCtx;
  if (!c) return;
  if (isCryptoPayMethod(c.method) && !PAY_CFG.configured) {
    c.method = 'wallet';
  }
  const walletLow = c.method === 'wallet' && BAL < c.amount;
  const fees = calcLocalFees(c.amount, c.method);
  const isCrypto = c.method !== 'wallet';
  const payTotal = fees.buyerTotal;
  const feeRows = isCrypto ? `
      <div class="row"><span>Item price</span><span class="mono">${fmt(fees.listingAmount)} USDT</span></div>
      <div class="row"><span>Escrow amount</span><span class="mono">${fmt(fees.listingAmount)} USDT</span></div>
      <div class="row"><span>Seller receives</span><span class="mono">${fmt(fees.sellerNet)} USDT</span></div>
      <p class="muted" style="font-size:12px;margin-top:8px">${fees.platformFeePercent}% platform fee (${fmt(fees.platformFee)} USDT) is deducted from the seller when you confirm delivery.</p>` : '';
  const cryptoNotice = !PAY_CFG.configured
    ? `<p class="pay-notice">Crypto checkout is unavailable on this server. Use <b>Dot Wallet</b>, or ask the admin to configure <span class="mono">PAYMENT_PROVIDER</span> in <span class="mono">.env</span> and restart.</p>`
    : '';
  const methodsHtml = PAY_METHODS.map(m => {
    const disabled = isCryptoPayMethod(m.id) && !PAY_CFG.configured;
    return `
    <button type="button" class="pay-method ${c.method === m.id ? 'on' : ''}" data-pay-method="${m.id}" ${disabled ? 'disabled' : ''}>
      <span class="ico">${m.icon}</span>
      <span class="body"><b>${m.label}</b><span>${disabled ? 'Not available — server not configured' : m.desc}</span></span>
      <span class="badge">${m.badge}</span>
      <span class="radio" aria-hidden="true"></span>
    </button>`;
  }).join('');

  $('#payCard').innerHTML = `
    <button class="pay-x" id="payClose" aria-label="Close">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l14 14M19 5 5 19"/></svg>
    </button>
    <div class="pay-head">
      <h3>Choose payment method</h3>
      <p>Funds are locked in escrow until you confirm delivery.</p>
    </div>
    <div class="pay-summary">
      <div class="t">${esc(c.title)}</div>
      <div class="row"><span>Seller</span><span>${esc(c.sellerName)}</span></div>
      <div class="row total"><span>You pay</span><span class="mono">${fmt(payTotal)} USDT</span></div>
      ${feeRows}
    </div>
    ${cryptoNotice}
    <div class="pay-methods">
      <h4>Payment method</h4>
      ${methodsHtml}
    </div>
    <div class="pay-foot">
      <p class="pay-error" id="payError" hidden></p>
      ${c.method === 'wallet' ? `<p class="pay-bal ${walletLow ? 'low' : ''}">Wallet balance: <span class="mono">${fmt(BAL)}</span> USDT${walletLow ? ` · need ${fmt(payTotal - BAL)} more` : ''}</p>` : ''}
      <button class="btn btn-pri pay-confirm" id="payConfirm" ${walletLow ? 'disabled' : ''}>Pay ${fmt(payTotal)} USDT</button>
    </div>`;

  $('#payClose').addEventListener('click', closePaymentModal);
  $('#payCard').querySelectorAll('[data-pay-method]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      payCtx.method = btn.dataset.payMethod;
      setPayError('');
      renderPaymentModal();
    });
  });
  $('#payConfirm')?.addEventListener('click', confirmPayment);
}

async function confirmPayment() {
  const c = payCtx;
  if (!c) return;
  const btn = $('#payConfirm');
  if (!btn || btn.disabled) return;

  if (c.method === 'wallet' && BAL < c.amount) {
    toast(`Insufficient balance — top up ${fmt(c.amount - BAL)} USDT`, 'info');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Processing payment…';
  setPayError('');

  if (c.method === 'wallet') {
    const delay = 700;
    await new Promise(r => setTimeout(r, delay));
    let deal = c.deal;
    if (!deal) {
      deal = await createDealFromPayCtx(c);
      c.deal = deal;
    }

    if (hasApiSession() && deal.sellerEmail) {
      // Server-authoritative wallet: debit + escrow hold happen atomically.
      const pay = await walletPay(deal);
      if (pay.unauthorized) {
        closePaymentModal();
        handleSessionExpired();
        openAuth('in');
        toast('Your session expired — sign in again to pay', 'info');
        return;
      }
      if (pay.cryptoPending) {
        // A pending crypto invoice already exists for this deal. Re-open the
        // crypto checkout flow so the buyer completes it instead of paying twice.
        toast('This deal already has a pending crypto payment — complete it below', 'info');
        c.method = c.method === 'wallet' ? 'crypto' : c.method;
        await processCryptoPayment(c, btn);
        return;
      }
      if (pay.insufficient || pay.error) {
        if (pay.balance != null) { BAL = pay.balance; paintBal(); }
        renderPaymentModal();
        setPayError(pay.insufficient
          ? `Insufficient balance — top up ${fmt(Math.max(0, deal.amt - (pay.balance ?? BAL)))} USDT`
          : (pay.error || 'Payment failed'));
        return;
      }
      if (pay.balance != null) BAL = pay.balance;
      await completeEscrowPayment(deal, 'wallet', { skipWalletDebit: true, skipEscrowHold: true });
    } else {
      // Guest / offline fallback keeps the demo usable without an account.
      await completeEscrowPayment(deal, 'wallet');
    }

    closePaymentModal();
    closeListing();
    toast(`Payment successful · ${deal.id} in escrow`, 'ok');
    go('deals');
    return;
  }

  await processCryptoPayment(c, btn);
}

async function walletPay(deal) {
  try {
    const r = await fetch('/api/wallet/pay', {
      method: 'POST', headers: authHeaders(true),
      body: JSON.stringify({ dealId: deal.id, listingId: deal.lid, title: deal.title, variantId: deal.variantId || null }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) return { unauthorized: true };
    if (r.status === 402) return { insufficient: true, balance: d.balance };
    if (r.status === 409) return { cryptoPending: true, error: d.msg || d.error };
    if (!r.ok) return { error: d.msg || d.error || 'Payment failed' };
    return { balance: d.wallet?.balance };
  } catch (e) {
    return { error: 'Network error — try again' };
  }
}

async function createDealFromPayCtx(c) {
  const dealId = newDealId();
  const deal = {
    id: dealId, lid: c.listing.id, title: c.title, amt: c.amount,
    status: 'wait', role: 'buyer', who: c.sellerName,
    sellerEmail: c.listing.sellerEmail || c.sellerEmail || '',
    variantId: c.variantId || null,
    note: 'Waiting for payment', steps: 1,
  };
  DEALS.unshift(deal);
  const chat = await ensureDealChat(deal);
  await sysMsg(chat, 'deal_created', { dealId, amt: c.amount });
  saveState();
  return deal;
}

/* ================= crypto payment gateway ================= */
// Shared "pending on-chain payment" screen for both escrow checkout and
// wallet top-up — network, live status, one-tap copy on the amount and
// address, and an expiry countdown, the way a real hosted crypto checkout
// looks. lib/payments/index.js's NATIVE_NETWORK_LABELS is the source for
// network/currency; lib/payment-routes.js's paymentProgress()/the topup
// status route report seen-on-chain/confirming progress for the status text.
const COPY_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const COPY_CHECK_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const PGW_CHAIN_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8"/></svg>';
const PGW_WARN_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z"/></svg>';

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
}

function copyToClipboard(text, btn) {
  const flash = () => {
    if (!btn) return;
    const original = btn.innerHTML;
    btn.classList.add('copied');
    btn.innerHTML = COPY_CHECK_ICON;
    setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = original; }, 1400);
  };
  const done = () => { flash(); toast('Copied to clipboard', 'ok'); };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => {
      try { fallbackCopy(text); done(); } catch (e) { toast('Could not copy — select and copy manually', 'info'); }
    });
  } else {
    try { fallbackCopy(text); done(); } catch (e) { toast('Could not copy — select and copy manually', 'info'); }
  }
}

function fmtCountdown(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '00:00';
  const total = Math.floor(ms / 1000);
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}

function paymentGatewayHtml({ network, currency, amount, address, expiresAt }) {
  const netLabel = network || 'this network';
  const cur = currency || 'USDT';
  return `
    <div class="pgw">
      <div class="pgw-top">
        <span class="pgw-network">${PGW_CHAIN_ICON} ${esc(netLabel)}</span>
        ${expiresAt ? `<span class="pgw-timer" id="pgwTimer">--:--</span>` : ''}
      </div>
      <div class="pgw-status" id="pgwStatus">
        <span class="pgw-dot"></span>
        <span id="pgwStatusText">Waiting for payment…</span>
      </div>
      <div class="pgw-block">
        <span class="pgw-lbl">Amount to send</span>
        <div class="pgw-field amount">
          <span class="val mono">${esc(amount)}<span class="cur">${esc(cur)}</span></span>
          <button type="button" class="pgw-copy" data-copy-val="${esc(String(amount))}" aria-label="Copy amount" title="Copy amount">${COPY_ICON}</button>
        </div>
      </div>
      <div class="pgw-block">
        <span class="pgw-lbl">Send to this address</span>
        <div class="pgw-field">
          <span class="val mono">${esc(address)}</span>
          <button type="button" class="pgw-copy" data-copy-val="${esc(address)}" aria-label="Copy address" title="Copy address">${COPY_ICON}</button>
        </div>
      </div>
      <p class="pgw-warn">${PGW_WARN_ICON}<span>Send only ${esc(cur)} on the ${esc(netLabel)} network, for the exact amount shown. A different asset, network, or amount may result in permanent loss of funds.</span></p>
    </div>`;
}

let pgwTimerInterval = null;
function initPaymentGateway(root, { expiresAt }) {
  (root || document).querySelectorAll('[data-copy-val]').forEach(btn => {
    btn.addEventListener('click', () => copyToClipboard(btn.dataset.copyVal, btn));
  });
  if (pgwTimerInterval) { clearInterval(pgwTimerInterval); pgwTimerInterval = null; }
  if (!expiresAt) return;
  const end = new Date(expiresAt).getTime();
  const tick = () => {
    const el = $('#pgwTimer');
    if (!el) { clearInterval(pgwTimerInterval); pgwTimerInterval = null; return; }
    const left = end - Date.now();
    el.textContent = left > 0 ? fmtCountdown(left) : 'Expired';
    el.classList.toggle('low', left > 0 && left < 5 * 60 * 1000);
    if (left <= 0) { clearInterval(pgwTimerInterval); pgwTimerInterval = null; }
  };
  tick();
  pgwTimerInterval = setInterval(tick, 1000);
}

// Reflects the latest poll result in the status strip: "waiting" (default)
// while nothing has been seen yet, "seen" once a matching transfer is
// observed on-chain but its confirm window hasn't elapsed (real progress
// instead of a static spinner for the whole wait), then "paid".
function setGatewayStatus(state, detail) {
  const strip = $('#pgwStatus');
  const text = $('#pgwStatusText');
  if (!strip || !text) return;
  strip.classList.remove('seen', 'paid');
  if (state === 'paid') {
    strip.classList.add('paid');
    text.textContent = 'Payment confirmed';
  } else if (state === 'seen') {
    strip.classList.add('seen');
    text.textContent = Number.isFinite(detail)
      ? `Payment detected — confirming (${detail}s)`
      : 'Payment detected — confirming…';
  } else {
    text.textContent = detail || 'Waiting for payment…';
  }
}

function renderCryptoPaymentPending(c, payment, deal, sandbox, onPaid) {
  const fees = calcLocalFees(c.amount, c.method);
  const total = payment.payAmount ?? payment.buyerTotal ?? fees.buyerTotal;
  const network = payment.networkLabel || payment.payNetwork || 'the selected network';
  const currency = payment.payCurrency || 'USDT';
  const link = payment.payUrl
    ? `<a class="btn btn-sec pay-link" href="${esc(payment.payUrl)}" target="_blank" rel="noopener">Open payment page</a>`
    : '';

  async function tryCompletePaid() {
    try {
      const r = await fetch('/api/payments/status/' + encodeURIComponent(deal.id), { headers: authHeaders() });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.payment?.status === 'paid') {
        if (data.payment.payNetwork) deal.payNetwork = data.payment.payNetwork;
        setGatewayStatus('paid');
        if (onPaid) await onPaid();
        return true;
      }
      if (r.ok && data.progress) {
        setGatewayStatus('seen', data.progress.confirmSecondsLeft);
      }
    } catch (e) {}
    return false;
  }

  $('#payCard').innerHTML = `
    <button class="pay-x" id="payClose" aria-label="Close">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l14 14M19 5 5 19"/></svg>
    </button>
    <div class="pay-head">
      <h3>Complete your payment</h3>
      <p>Deal <span class="mono">${esc(deal.id)}</span> · escrow order</p>
    </div>
    <div class="pay-crypto-pending">
      ${payment.payAddress
        ? paymentGatewayHtml({ network, currency, amount: fmt(payment.payAmount ?? total), address: payment.payAddress, expiresAt: payment.expiresAt })
        : `<p class="muted" style="font-size:13px">Waiting for a payment link…</p>`}
      ${link}
      <div class="pgw-actions">
        <button class="btn btn-sec" id="payCheckNow" type="button">Check payment now</button>
      </div>
    </div>`;

  initPaymentGateway($('#payCard'), { expiresAt: payment.expiresAt });
  $('#payClose').addEventListener('click', closePaymentModal);
  $('#payCheckNow')?.addEventListener('click', async () => {
    const btn = $('#payCheckNow');
    if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
    const paid = await tryCompletePaid();
    if (!paid) setGatewayStatus('waiting', 'Still waiting — send the payment, then check again.');
    if (btn) { btn.disabled = false; btn.textContent = 'Check payment now'; }
  });

  return tryCompletePaid;
}

async function processCryptoPayment(c, btn) {
  let deal = c.deal;
  if (!deal) {
    deal = await createDealFromPayCtx(c);
    c.deal = deal;
  }

  try {
    const r = await fetch('/api/payments/escrow', {
      method: 'POST', headers: authHeaders(true),
      body: JSON.stringify({
        orderId: deal.id,
        amount: deal.amt,
        title: deal.title,
        listingId: deal.lid,
        variantId: deal.variantId || null,
        sellerEmail: deal.sellerEmail,
        sellerName: deal.who,
        method: c.method,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(data.msg || data.error || 'Could not create payment');
    }

    const payment = data.payment;
    const finishPaid = async () => {
      try {
        const sr = await fetch('/api/payments/status/' + encodeURIComponent(deal.id), { headers: authHeaders() });
        const sd = await sr.json().catch(() => ({}));
        if (sd.payment?.payNetwork) deal.payNetwork = sd.payment.payNetwork;
      } catch (e) {}
      await completeEscrowPayment(deal, c.method, { skipEscrowHold: true });
      closePaymentModal();
      closeListing();
      toast(`Payment successful · ${deal.id} in escrow`, 'ok');
      go('deals');
    };

    if (payment.status === 'paid') {
      await finishPaid();
      return;
    }

    let showSandbox = false;
    try {
      const cfgR = await fetch('/api/payments/config');
      const cfg = await cfgR.json().catch(() => ({}));
      showSandbox = !!cfg.sandbox;
    } catch (e) { showSandbox = true; }

    const checkPaid = renderCryptoPaymentPending(c, payment, deal, showSandbox, finishPaid);

    if (payment.payUrl) window.open(payment.payUrl, '_blank', 'noopener');

    // Status text during this loop is driven by checkPaid() itself (it
    // updates the gateway's status strip from the server's reported
    // progress) rather than a local elapsed-time counter here.
    let paid = false;
    const max = 120;
    for (let i = 0; i < max; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 3000));
      if (!$('#payOverlay').classList.contains('open')) return;
      paid = await checkPaid();
      if (paid) break;
    }

    if (paid) {
      return;
    } else {
      btn.disabled = false;
      const fees = calcLocalFees(c.amount, c.method);
      btn.textContent = `Pay ${fmt(fees.buyerTotal)} USDT`;
      toast('Payment still pending — complete transfer or try again', 'info');
    }
  } catch (e) {
    btn.disabled = false;
    const fees = calcLocalFees(c.amount, c.method);
    btn.textContent = `Pay ${fmt(fees.buyerTotal)} USDT`;
    setPayError(e.message || 'Payment failed');
  }
}

async function completeEscrowPayment(deal, method, opts = {}) {
  const methodLabel = deal.payNetwork || PAY_METHOD_LABELS[method] || method;
  deal.status = 'escrow';
  deal.steps = 2;
  deal.note = 'Held in escrow until you confirm delivery';
  deal.payMethod = method;

  if (method === 'wallet' && !opts.skipWalletDebit) BAL -= deal.amt;
  const payFees = calcLocalFees(deal.amt, method);
  paintBal();
  TXS.unshift({
    k: 'hold',
    lbl: `Escrow hold · ${deal.id} (${methodLabel})`,
    amt: method === 'wallet' ? -deal.amt : -(payFees.buyerTotal || deal.amt),
    t: 'just now',
  });

  const chat = await ensureDealChat(deal);
  await sysMsg(chat, 'escrow_held', { amt: deal.amt, method });
  if (chat) await postChatMessage(chat, { text: paymentNotifyText(deal) }, { silent: true });

  if (deal.sellerEmail && hasApiSession() && !opts.skipEscrowHold) {
    fetch('/api/seller/escrow-hold', {
      method: 'POST', headers: authHeaders(true),
      body: JSON.stringify({ dealId: deal.id, amount: deal.amt, sellerEmail: deal.sellerEmail, listingTitle: deal.title, method }),
    }).catch(() => {});
  }

  saveState();
  renderGrid();
  renderDeals();
  renderDealTabs();
  renderDealsPage();
  renderTxs();
  paintLocked();
  renderChatList();
  paintChatBadge();
}

/* ================= toasts ================= */
let lastToast = { msg: '', t: 0 };
function toast(msg, kind = 'info') {
  const now = Date.now();
  if (msg === lastToast.msg && now - lastToast.t < 4000) return;
  lastToast = { msg, t: now };
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, 3400);
}

/* ================= events ================= */
chipsEl.addEventListener('click', e => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  S.cat = b.dataset.cat;
  renderChips(); renderPopular(); refresh();
});
$('#q').addEventListener('input', e => { S.q = e.target.value.trim().toLowerCase(); refresh(); });
$('#sort').addEventListener('change', e => { S.sort = e.target.value; refresh(); });
$('#vfy').addEventListener('change', e => { S.vfy = e.target.checked; refresh(); });
$('#reset').addEventListener('click', () => {
  S.cat = 'all'; S.q = ''; S.sort = 'new'; S.vfy = false;
  $('#q').value = ''; $('#sort').value = 'new'; $('#vfy').checked = false;
  renderChips(); renderPopular(); refresh();
});
grid.addEventListener('click', e => {
  const c = e.target.closest('[data-open]');
  if (c) openListing(c.dataset.open);
});
const popularWrap = $('#popularWrap');
if (popularWrap) {
  popularWrap.addEventListener('click', e => {
    const c = e.target.closest('[data-open]');
    if (c) { openListing(c.dataset.open); return; }
    const b = e.target.closest('[data-cat]');
    if (b) {
      S.cat = b.dataset.cat;
      renderChips();
      renderPopular();
      refresh();
      $('#grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const all = e.target.closest('.cat-scroll-all');
    if (all) {
      S.cat = 'all';
      renderChips();
      renderPopular();
      refresh();
      $('#grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
}
overlay.addEventListener('click', e => {
  if (e.target === overlay || e.target.closest('[data-close]')) closeListing();
  const b = e.target.closest('[data-buy]');
  if (b) buy(b.dataset.buy, b.dataset.variant || null);
  if (e.target.closest('[data-godeal]')) { closeListing(); go('deals'); }
  const mb = e.target.closest('[data-msg]');
  if (mb) {
    closeListing();
    openMessageSeller(mb.dataset.msg, mb.dataset.lid || null);
  }
  if (e.target.closest('[data-demo]')) { e.preventDefault(); toast('Demo UI — this action is not wired up', 'info'); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && overlay.classList.contains('open')) closeListing();
  if (e.key === 'Escape' && $('#payOverlay').classList.contains('open')) closePaymentModal();
  if (e.key === 'Escape' && $('#receiptOverlay').classList.contains('open')) closeReceipt();
});
$('#payOverlay').addEventListener('click', e => {
  if (e.target === $('#payOverlay')) closePaymentModal();
});
$('#receiptOverlay').addEventListener('click', e => {
  if (e.target === $('#receiptOverlay')) closeReceipt();
});
document.querySelector('.rail').addEventListener('click', e => {
  if (e.target.closest('[data-demo]')) { e.preventDefault(); toast('Demo UI — full deal history lives here', 'info'); }
});
document.querySelector('.tabbar').addEventListener('click', e => {
  const t = e.target.closest('.tab');
  if (!t) return;
  if (t.dataset.view) go(t.dataset.view);
});
$('#trustX').addEventListener('click', () => $('#trust').remove());
$('#topup').addEventListener('click', () => go('wallet'));

/* ================= seller profile ================= */
S.sellerTab = 'listings';
S.sellerId = null;

function formatProfileDate(d) {
  const dt = d ? new Date(d) : null;
  if (!dt || Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function starsHtml(rating) {
  const n = Math.round(Number(rating) || 0);
  return '★'.repeat(Math.max(0, Math.min(5, n))) + '☆'.repeat(Math.max(0, 5 - Math.max(0, Math.min(5, n))));
}

function sellerSlug(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function openSellerProfile(id, name) {
  if (!id) return;
  closeListing();
  S.sellerId = String(id).trim().toLowerCase();
  // Prefer a clean name slug in the URL when we know the seller's name.
  if (name) S.sellerId = sellerSlug(name) || S.sellerId;
  S.sellerTab = 'listings';
  go('seller', { sellerId: S.sellerId });
}

async function loadSellerProfile(id) {
  const root = $('#sellerProfileRoot');
  if (!root || !id) return;
  root.innerHTML = '<div class="panel" style="padding:40px;text-align:center;color:var(--muted)">Loading seller profile…</div>';
  try {
    const r = await fetch('/api/sellers/' + encodeURIComponent(id) + '/profile');
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.msg || data.error || 'Seller not found');
    renderSellerProfile(data.profile);
    // Canonicalize the URL to the clean slug (hides the seller's email).
    if (data.profile?.slug && data.profile.slug !== S.sellerId) {
      S.sellerId = data.profile.slug;
      try { history.replaceState(null, '', '#seller/' + encodeURIComponent(data.profile.slug)); } catch (e) {}
    }
  } catch (e) {
    root.innerHTML = `<div class="panel empty"><b>Seller not found</b>${esc(e.message || 'This seller is not verified or does not exist.')}</div>`;
  }
}

function renderSellerProfile(p) {
  const root = $('#sellerProfileRoot');
  if (!root) return;
  const tab = S.sellerTab || 'listings';
  const listingsHtml = p.listings?.length
    ? `<div class="sp-grid">${p.listings.map(l => {
        const hasImg = !!l.image;
        const catLabel = (CATS.find(c => c.id === l.cat) || {}).label || l.cat || '';
        const grad = CATGRAD[l.cat] || ['#5b6cff', '#8e54e9'];
        const tags = (CATTAGS[l.cat] || []).map(t => `<span class="ctag">${t}</span>`).join('');
        return `<button class="sp-card-li" data-open="${esc(l.id)}" type="button" aria-label="${esc(l.title)} — ${fmt(l.price)} USDT">
          <span class="sp-thumb">
            <span class="sp-grad" style="background:linear-gradient(140deg, ${grad[0]}, ${grad[1]} 130%)"></span>
            <span class="cat-tag">${esc(catLabel)}</span>
            ${hasImg ? `<img src="${esc(l.image)}" alt="${esc(l.title)}" loading="lazy">` : `<span class="tile">${ICONS[l.cat] || ''}</span>`}
            ${escChip()}
          </span>
          <span class="sp-li-body">
            <span class="sp-li-title">${esc(l.title)}</span>
            <span class="sp-li-foot">${l.variants?.length ? '<span class="from">From</span> ' : ''}<span class="p mono">${fmt(l.price)}</span><span class="c">USDT</span></span>
            ${tags ? `<span class="sp-li-tags">${tags}</span>` : ''}
          </span>
        </button>`;
      }).join('')}</div>`
    : `<div class="empty"><b>No active listings</b>This seller has no products listed right now.</div>`;
  const reviewsHtml = p.reviews?.length
    ? `<div style="display:grid;gap:10px">${p.reviews.map(rv => `
        <article class="sp-review">
          <div class="sp-review-top"><b>${esc(rv.buyerName)}</b><span class="stars">${starsHtml(rv.rating)}</span></div>
          ${rv.dealTitle ? `<div class="deal">${esc(rv.dealTitle)} · ${formatProfileDate(rv.at)}</div>` : `<div class="deal">${formatProfileDate(rv.at)}</div>`}
          ${rv.text ? `<p>${esc(rv.text)}</p>` : ''}
        </article>`).join('')}</div>`
    : `<div class="empty"><b>No reviews yet</b>Reviews appear here after buyers complete escrow deals and leave feedback.</div>`;

  root.innerHTML = `
    <button class="btn btn-ghost sp-back" type="button" data-go="market">← Back to market</button>
    <div class="sp-layout">
      <aside class="sp-card sp-hero">
        <span class="sp-ava" style="${AVAHUE(p.name)}">${initials(p.name)}</span>
        <div class="sp-name">${esc(p.name)}</div>
        <div class="sp-verified">${VFY} Verified seller</div>
        <div class="sp-stats">
          <div class="sp-stat"><span class="k">Registered</span><span class="v">${formatProfileDate(p.registeredAt)}</span></div>
          <div class="sp-stat"><span class="k">Products listed</span><span class="v mono">${p.listingsCount || 0}</span></div>
          <div class="sp-stat"><span class="k">Products sold</span><span class="v mono">${p.soldCount || 0}</span></div>
          <div class="sp-stat"><span class="k">Buyer rating</span><span class="v"><span class="st">★</span> ${(p.rate ?? 5).toFixed(1)} · ${p.reviewCount || 0} review${(p.reviewCount || 0) === 1 ? '' : 's'}</span></div>
        </div>
        <button class="btn btn-sec" style="width:100%;margin-top:16px" type="button" data-msg-seller="${esc(p.email)}" data-seller-name="${esc(p.name)}">Message seller</button>
      </aside>
      <div class="sp-main">
        <nav class="sp-tabs chips" aria-label="Seller profile tabs">
          <button class="chip ${tab === 'listings' ? 'on' : ''}" type="button" data-sp-tab="listings">Products (${p.listingsCount || 0})</button>
          <button class="chip ${tab === 'reviews' ? 'on' : ''}" type="button" data-sp-tab="reviews">Reviews (${p.reviewCount || 0})</button>
        </nav>
        ${tab === 'reviews' ? reviewsHtml : listingsHtml}
      </div>
    </div>`;

  root.querySelectorAll('[data-sp-tab]').forEach(b => b.addEventListener('click', () => {
    S.sellerTab = b.dataset.spTab;
    renderSellerProfile(p);
  }));
  root.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openListing(b.dataset.open)));
  root.querySelector('[data-msg-seller]')?.addEventListener('click', () => {
    const btn = root.querySelector('[data-msg-seller]');
    const listing = p.listings?.[0];
    openMessageSeller(btn.dataset.sellerName, listing?.id);
  });
}

function openReviewPrompt(deal) {
  if (!deal?.id || !hasApiSession()) return;
  let rating = 5;
  const sellerName = deal.who || 'the seller';
  const STAR = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.6 14.9 8.7l6.6.7-4.9 4.4 1.4 6.5L12 16.9l-5.9 3.4 1.4-6.5-4.9-4.4 6.6-.7L12 2.6Z"/></svg>';
  const LABELS = { 1: 'Poor', 2: 'Fair', 3: 'Good', 4: 'Very good', 5: 'Excellent' };
  const overlay = document.createElement('div');
  overlay.className = 'auth-overlay open';
  overlay.innerHTML = `
    <div class="auth-box panel rv-box">
      <div class="rv-head"><span class="rv-ava" style="${AVAHUE(sellerName)}">${initials(sellerName)}</span></div>
      <h2>Rate your experience</h2>
      <p class="rv-sub">How was your deal with <b>${esc(sellerName)}</b>?<br>Your review helps other buyers.</p>
      <div style="text-align:center"><span class="rv-deal">${esc(deal.title || deal.id)}</span></div>
      <div class="rv-stars" role="radiogroup" aria-label="Rating">${[1,2,3,4,5].map(n =>
        `<button type="button" class="rv-star" data-star="${n}" role="radio" aria-label="${n} star${n === 1 ? '' : 's'}">${STAR}</button>`).join('')}</div>
      <div class="rv-label" id="rvLabel"></div>
      <textarea class="input rv-text" id="reviewText" rows="3" maxlength="500" placeholder="Share a few words about the deal (optional)…"></textarea>
      <div class="rv-count"><span id="rvCount">0</span>/500</div>
      <div class="rv-actions">
        <button type="button" class="btn btn-ghost" data-skip>Skip</button>
        <button type="button" class="btn btn-pri" data-submit>Submit review</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  const labelEl = overlay.querySelector('#rvLabel');
  const paintStars = (hover) => {
    const active = hover || rating;
    overlay.querySelectorAll('[data-star]').forEach(b => {
      b.classList.toggle('on', +b.dataset.star <= active);
    });
    labelEl.textContent = LABELS[active] || '';
  };
  paintStars();
  overlay.querySelectorAll('[data-star]').forEach(b => {
    b.addEventListener('click', () => { rating = +b.dataset.star; paintStars(); });
    b.addEventListener('mouseenter', () => paintStars(+b.dataset.star));
  });
  overlay.querySelector('.rv-stars')?.addEventListener('mouseleave', () => paintStars());
  const textEl = overlay.querySelector('#reviewText');
  const countEl = overlay.querySelector('#rvCount');
  textEl?.addEventListener('input', () => { countEl.textContent = textEl.value.length; });
  const close = () => { overlay.remove(); document.body.style.overflow = ''; };
  overlay.querySelector('[data-skip]')?.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-submit]')?.addEventListener('click', async () => {
    const text = textEl?.value?.trim() || '';
    try {
      const r = await fetch('/api/reviews', {
        method: 'POST', headers: authHeaders(true),
        body: JSON.stringify({ dealId: deal.id, rating, text }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 409) toast('You already reviewed this deal', 'info');
      else if (!r.ok) toast(d.msg || d.error || 'Could not submit review', 'info');
      else toast('Thanks for your review', 'ok');
    } catch (e) { toast('Could not submit review', 'info'); }
    close();
  });
}

/* Dispute modal — collects the reason, then hands off to the submit handler.
 * onSubmit(reason) is async; resolve true to close, false to keep editing. */
function openDisputePrompt(deal, onSubmit) {
  const overlay = document.createElement('div');
  overlay.className = 'auth-overlay open';
  overlay.innerHTML = `
    <div class="auth-box panel dsp-box">
      <h2>Open a dispute</h2>
      <p class="dsp-sub">Tell the arbiter what went wrong with <b>${esc(deal.title || deal.id)}</b>.<br>
      Your escrow stays frozen while an admin reviews the case — no funds move until it's resolved.</p>
      <textarea class="input rv-text" id="dspReason" rows="4" maxlength="1000" placeholder="e.g. Item not as described, never received, wrong account delivered…"></textarea>
      <div class="rv-count"><span id="dspCount">0</span>/1000</div>
      <div class="rv-actions">
        <button type="button" class="btn btn-ghost" data-cancel>Cancel</button>
        <button type="button" class="btn btn-danger" data-submit>Open dispute</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  const textEl = overlay.querySelector('#dspReason');
  const countEl = overlay.querySelector('#dspCount');
  const submitBtn = overlay.querySelector('[data-submit]');
  textEl.addEventListener('input', () => { countEl.textContent = textEl.value.length; });
  const close = () => { overlay.remove(); document.body.style.overflow = ''; };
  overlay.querySelector('[data-cancel]').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  submitBtn.addEventListener('click', async () => {
    const reason = textEl.value.trim();
    if (!reason) { textEl.focus(); return; }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Opening…';
    const okToClose = await onSubmit(reason);
    if (okToClose) close();
    else { submitBtn.disabled = false; submitBtn.textContent = 'Open dispute'; }
  });
  textEl.focus();
}


/* Fetch + show the auto-delivered credential for a paid order. The server only
 * returns it to the recorded buyer, and only once payment is confirmed. */
async function openCredential(deal) {
  if (!hasApiSession()) {
    openAuth('in');
    toast('Sign in to view your credentials', 'info');
    return;
  }
  let data;
  try {
    const r = await fetch('/api/buyer/orders/' + encodeURIComponent(deal.id) + '/credential', { headers: authHeaders() });
    data = await r.json().catch(() => ({}));
    if (r.status === 401) { handleSessionExpired(); openAuth('in'); return; }
    if (r.status === 410) {
      // Order was refunded — the credential was retired server-side.
      toast(data.msg || 'This order was refunded — the credential is no longer available', 'info');
      syncDealStates();
      return;
    }
    if (!r.ok) {
      toast(data.msg || (data.error === 'no_credential'
        ? 'This order is delivered manually by the seller — check the deal chat'
        : 'Credentials are not available for this order'), 'info');
      return;
    }
  } catch (e) {
    toast('Could not load credentials — check your connection', 'err');
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'auth-overlay open';
  overlay.innerHTML = `
    <div class="auth-box panel dsp-box">
      <h2>Your credentials</h2>
      <p class="dsp-sub">Order <span class="mono">${esc(deal.id)}</span> · delivered automatically on payment. Keep these private.</p>
      <div class="cred-box mono" id="credValue">${esc(data.credential || '')}</div>
      <div class="rv-actions">
        <button type="button" class="btn btn-ghost" data-cancel>Close</button>
        <button type="button" class="btn btn-pri" data-copy>Copy</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  const close = () => { overlay.remove(); document.body.style.overflow = ''; };
  overlay.querySelector('[data-cancel]').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-copy]').addEventListener('click', async () => {
    const btn = overlay.querySelector('[data-copy]');
    try {
      await navigator.clipboard.writeText(data.credential || '');
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    } catch (e) { toast('Copy failed — select and copy manually', 'info'); }
  });
}

/* ================= router ================= */
const VIEWS = ['market', 'forum', 'community', 'escrow', 'deals', 'messages', 'wallet', 'seller'];

function parseHashView() {
  const h = (location.hash || '').slice(1);
  if (h.startsWith('seller/')) {
    return { view: 'seller', sellerId: decodeURIComponent(h.slice(7)).trim().toLowerCase() };
  }
  return { view: VIEWS.includes(h) ? h : 'market' };
}

function go(view, opts = {}) {
  if (view === 'seller') {
    S.sellerId = opts.sellerId || S.sellerId;
    if (S.sellerId) {
      try { history.replaceState(null, '', '#seller/' + encodeURIComponent(S.sellerId)); } catch (e) {}
    }
  } else if (!opts.keepHash && VIEWS.includes(view)) {
    try { history.replaceState(null, '', '#' + view); } catch (e) {}
  }
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'view-' + view));
  document.querySelectorAll('.ptab').forEach(t => t.classList.toggle('on', t.dataset.view === view && view !== 'seller'));
  document.querySelectorAll('.tab[data-view]').forEach(t => t.classList.toggle('on', t.dataset.view === view && view !== 'seller'));
  if (view === 'deals') { renderDealTabs(); renderDealsPage(); syncDealStates(); }
  if (view === 'messages') { syncChatInbox().then(() => { renderChatList(); renderThread(); paintChatBadge(); }); }
  startCommunityPolling(view === 'community');
  if (view === 'community') loadCommunity();
  if (view === 'wallet') countWallet();
  if (view === 'wallet') { paintBal(); paintLocked(); renderTxs(); refreshWalletBalance(); }
  if (view === 'seller') loadSellerProfile(S.sellerId);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$('#pagenav').addEventListener('click', e => {
  const t = e.target.closest('[data-view]');
  if (t) go(t.dataset.view);
});
document.addEventListener('click', e => {
  const sp = e.target.closest('[data-seller-profile]');
  if (sp) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
    openSellerProfile(sp.dataset.sellerProfile, sp.dataset.sellerName);
    return;
  }
  const g = e.target.closest('[data-go]');
  if (g) { e.preventDefault(); go(g.dataset.go); }
}, true);
window.addEventListener('hashchange', () => {
  const p = parseHashView();
  if (p.view === 'seller') go('seller', { sellerId: p.sellerId });
  else go(p.view, { keepHash: true });
});

/* ================= deals page ================= */
const DEALTABS = [['all','All'],['wait','Awaiting payment'],['escrow','In escrow'],['dispute','Dispute'],['done','Completed'],['cancelled','Cancelled']];
S.dealTab = 'all';

function stepsHtml(d) {
  return [1,2,3,4].map(i => {
    let cls = '';
    if (d.status === 'done' || i < d.steps) cls = 'full';
    else if (i === d.steps && d.status !== 'cancelled') cls = 'now';
    const danger = d.status === 'dispute' && i === d.steps;
    return `<span class="dstep ${danger ? '' : cls}" ${danger ? 'style="background:var(--danger)"' : ''}></span>`;
  }).join('');
}

function fmtReceiptDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch (e) {
    return '—';
  }
}

function openReceipt(deal) {
  if (!deal) return;
  const method = deal.payMethod || 'wallet';
  const fees = calcLocalFees(deal.amt, method);
  const methodLabel = deal.payNetwork || PAY_METHOD_LABELS[method] || method;
  const isBuyer = deal.role === 'buyer';
  const isCrypto = method !== 'wallet';
  const buyerPaid = isCrypto ? fees.buyerTotal : deal.amt;
  const sellerLine = isBuyer
    ? `<div class="row"><span>Seller</span><span>${esc(deal.who)}</span></div>`
    : `<div class="row"><span>Buyer</span><span>${esc(deal.who)}</span></div>`;
  const feeRows = isCrypto ? `
      <div class="row"><span>Item price</span><span class="mono">${fmt(fees.listingAmount)} USDT</span></div>
      <div class="row total"><span>${isBuyer ? 'You paid' : 'Buyer paid'}</span><span class="mono">${fmt(buyerPaid)} USDT</span></div>
      <div class="row"><span>Escrow released</span><span class="mono">${fmt(fees.listingAmount)} USDT</span></div>
      <div class="row"><span>Platform fee (${fees.platformFeePercent}%)</span><span class="mono">${fmt(fees.platformFee)} USDT</span></div>
      <div class="row"><span>${isBuyer ? 'Seller received' : 'You received'}</span><span class="mono">${fmt(fees.sellerNet)} USDT</span></div>`
    : `
      <div class="row"><span>Escrow amount</span><span class="mono">${fmt(deal.amt)} USDT</span></div>
      <div class="row"><span>Platform fee (${fees.platformFeePercent}%)</span><span class="mono">${fmt(fees.platformFee)} USDT</span></div>
      <div class="row total"><span>${isBuyer ? 'You paid' : 'Buyer paid'}</span><span class="mono">${fmt(deal.amt)} USDT</span></div>
      <div class="row"><span>${isBuyer ? 'Seller received' : 'You received'}</span><span class="mono">${fmt(fees.sellerNet)} USDT</span></div>`;

  $('#receiptCard').innerHTML = `
    <button class="pay-x" id="receiptClose" aria-label="Close">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l14 14M19 5 5 19"/></svg>
    </button>
    <div class="pay-head">
      <h3>Deal receipt</h3>
      <p class="mono">${esc(deal.id)}</p>
      <span class="receipt-stamp">Completed</span>
    </div>
    <div class="pay-summary">
      <div class="t">${esc(deal.title)}</div>
      ${sellerLine}
      <div class="row"><span>Your role</span><span>${isBuyer ? 'Buyer' : 'Seller'}</span></div>
      <div class="row"><span>Payment method</span><span>${esc(methodLabel)}</span></div>
      <div class="row"><span>Completed</span><span>${esc(fmtReceiptDate(deal.completedAt))}</span></div>
      ${feeRows}
    </div>
    <div class="pay-foot">
      <div class="receipt-actions">
        <button class="btn btn-sec" id="receiptCopy" type="button">Copy deal ID</button>
        <button class="btn btn-pri" id="receiptDone" type="button">Close</button>
      </div>
    </div>`;

  $('#receiptClose').addEventListener('click', closeReceipt);
  $('#receiptDone').addEventListener('click', closeReceipt);
  $('#receiptCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(deal.id);
      toast('Deal ID copied', 'ok');
    } catch (e) {
      toast(deal.id, 'info');
    }
  });

  $('#receiptOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  $('#receiptDone').focus();
}

function closeReceipt() {
  $('#receiptOverlay').classList.remove('open');
  document.body.style.overflow = overlay.classList.contains('open') || $('#payOverlay').classList.contains('open') ? 'hidden' : '';
}

function renderDealTabs() {
  $('#dealTabs').innerHTML = DEALTABS.map(([id, label]) => {
    const n = id === 'all' ? DEALS.length : DEALS.filter(d => d.status === id).length;
    return `<button class="chip ${S.dealTab === id ? 'on' : ''}" data-dtab="${id}">${label}<span class="n">${n}</span></button>`;
  }).join('');
}

function dealActionBtn(d) {
  const chatBtn = `<button class="btn btn-sec" data-act="chat" data-id="${d.id}">Chat</button>`;
  // Auto-delivered credential: only the buyer can fetch it (server re-checks).
  const credBtn = (d.role === 'buyer' && (d.status === 'escrow' || d.status === 'done'))
    ? `<button class="btn btn-sec" data-act="credential" data-id="${d.id}">View credentials</button>` : '';
  if (d.status === 'wait' && d.role === 'buyer')  return `<button class="btn btn-pri" data-act="pay" data-id="${d.id}">Complete payment</button><button class="btn btn-ghost" data-act="cancel" data-id="${d.id}">Cancel deal</button>` + chatBtn;
  if (d.status === 'escrow' && d.role === 'buyer') return `<button class="btn btn-pri done" data-act="confirm" data-id="${d.id}">Confirm delivery — release ${fmt(d.amt)} USDT</button><button class="btn btn-ghost" data-act="dispute" data-id="${d.id}">Open dispute</button>` + credBtn + chatBtn;
  if (d.status === 'dispute') return `<button class="btn btn-sec" data-act="chat" data-id="${d.id}">Open arbitration chat</button>`;
  if (d.status === 'done')    return credBtn + `<button class="btn btn-sec" data-act="review" data-id="${d.id}">Leave a review</button><button class="btn btn-sec" data-act="receipt" data-id="${d.id}">View receipt</button>` + chatBtn;
  return chatBtn;
}

// One-time cleanup: older completed deals stored a seller-oriented note
// ("Payout received…") on the buyer's card. Rewrite it to buyer-facing wording.
function migrateDealNotes() {
  let changed = false;
  for (const d of DEALS) {
    if (typeof d.note === 'string' && (d.note.startsWith('Payout received') || d.note.startsWith('Released to seller ·'))) {
      d.note = 'Released to seller';
      changed = true;
    }
  }
  if (changed) saveState();
}

function renderDealsPage() {
  migrateDealNotes();
  const list = S.dealTab === 'all' ? DEALS : DEALS.filter(d => d.status === S.dealTab);
  const active = DEALS.filter(d => d.status === 'escrow' || d.status === 'wait').length;
  $('#dealCount').textContent = active + ' active · ' + DEALS.length + ' total';
  if (!list.length) {
    $('#dealList').innerHTML = !AUTH
      ? '<div class="empty"><b>Sign in to see your deals</b>Your escrows, payments and releases live here.<br><button class="btn btn-pri" style="flex:none;margin-top:14px;padding:10px 22px" data-auth="in">Sign in</button></div>'
      : '<div class="empty"><b>No deals here</b>Deals move out of this tab as they progress.</div>';
    return;
  }
  $('#dealList').innerHTML = list.map(d => {
    const m = DEALMETA[d.status] || { cls: 'wait', lbl: d.status || 'Unknown' };
    const rel = d.role === 'buyer' ? `Buying from <b>${esc(d.who)}</b>` : `Selling to <b>${esc(d.who)}</b>`;
    return `
    <div class="deal">
      <div class="deal-top"><span class="deal-id mono">${esc(d.id)}</span><span class="pill ${m.cls}">${m.lbl}</span></div>
      <div class="deal-title">${esc(d.title)}</div>
      <div class="deal-with">${rel}</div>
      <div class="deal-amt mono">${fmt(d.amt)}<span class="cur">USDT</span></div>
      ${d.payNetwork ? `<div class="deal-note" style="font-size:12px;margin-top:-2px">Paid via ${esc(d.payNetwork)}</div>` : ''}
      <div class="deal-steps">${stepsHtml(d)}</div>
      <div class="deal-note">${esc(d.note || '')}</div>
      ${dealActionBtn(d) ? `<div class="deal-act">${dealActionBtn(d)}</div>` : ''}
    </div>`;
  }).join('');
}

$('#dealTabs').addEventListener('click', e => {
  const b = e.target.closest('[data-dtab]');
  if (!b) return;
  S.dealTab = b.dataset.dtab;
  renderDealTabs(); renderDealsPage();
});
$('#dealList').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const d = DEALS.find(x => x.id === b.dataset.id);
  if (!d) return;
  if (b.dataset.act === 'pay') {
    openPaymentModal({ dealId: d.id });
  } else if (b.dataset.act === 'cancel') {
    // Abandon an unpaid checkout: cancels the pending server invoice (frees the
    // reserved stock unit) and marks the local deal cancelled so the listing
    // becomes buyable again.
    if (d.sellerEmail && hasApiSession()) {
      b.disabled = true;
      try {
        const r = await fetch('/api/payments/cancel', {
          method: 'POST', headers: authHeaders(true),
          body: JSON.stringify({ orderId: d.id }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok && r.status !== 404) {
          toast(data.msg || data.error || 'Could not cancel — try again', 'err');
          b.disabled = false;
          return;
        }
      } catch (e) {
        toast('Could not cancel — check your connection', 'err');
        b.disabled = false;
        return;
      }
    }
    d.status = 'cancelled';
    d.steps = 4;
    d.note = 'Cancelled — no payment taken';
    if (!d.completedAt) d.completedAt = new Date().toISOString();
    saveState();
    renderDeals(); renderDealTabs(); renderDealsPage(); paintLocked(); renderGrid();
    toast('Deal cancelled — you can buy the listing again anytime', 'ok');
    return;
  } else if (b.dataset.act === 'confirm') {
    // Only mark the deal done AFTER the server confirms the payout. Marking it
    // done optimistically (and toasting "Funds released" on a failed call)
    // left the buyer UI permanently showing "Completed" while the seller was
    // never paid — and syncDealStates never reconciled it.
    if (d.sellerEmail && hasApiSession()) {
      b.disabled = true;
      const prevLbl = b.textContent;
      b.textContent = 'Releasing…';
      try {
        const pr = await fetch('/api/seller/payout', {
          method: 'POST', headers: authHeaders(true),
          body: JSON.stringify({ dealId: d.id, amount: d.amt, sellerEmail: d.sellerEmail, listingTitle: d.title }),
        });
        const pdata = await pr.json().catch(() => ({}));
        if (!pr.ok) {
          toast(pdata.msg || pdata.error || 'Could not release funds — the deal is still in escrow', 'err');
          b.disabled = false;
          b.textContent = prevLbl;
          return;
        }
        d.status = 'done'; d.steps = 4;
        d.note = 'Released to seller';
        if (!d.completedAt) d.completedAt = new Date().toISOString();
        const chat = await ensureDealChat(d);
        await sysMsg(chat, 'released');
        toast(pdata.fee != null
          ? `Released ${fmt(pdata.net)} USDT to ${d.who} · ${fmt(pdata.fee)} USDT platform fee`
          : `Funds released to ${d.who} · ${d.id}`, 'ok');
      } catch (e) {
        toast('Could not release funds — check your connection. The deal is still in escrow.', 'err');
        b.disabled = false;
        b.textContent = prevLbl;
        return;
      }
    } else {
      // Guest / offline demo path — no server escrow exists, so local-only.
      d.status = 'done'; d.steps = 4; d.note = 'Released to the seller';
      if (!d.completedAt) d.completedAt = new Date().toISOString();
      const chat = await ensureDealChat(d);
      await sysMsg(chat, 'released');
      toast(`Funds released to ${d.who} · ${d.id}`, 'ok');
    }
    saveState();
    renderDeals(); renderDealTabs(); renderDealsPage(); paintLocked(); renderGrid();
    if (hasApiSession() && d.sellerEmail && !d.reviewPrompted) {
      d.reviewPrompted = true;
      saveState();
      setTimeout(() => openReviewPrompt(d), 600);
    }
    return;
  } else if (b.dataset.act === 'dispute') {
    if (!hasApiSession()) {
      openAuth('in', () => { renderDeals(); renderDealTabs(); renderDealsPage(); });
      toast('Sign in to open a dispute', 'info');
      return;
    }
    openDisputePrompt(d, async reason => {
      try {
        const r = await fetch('/api/seller/dispute', {
          method: 'POST', headers: authHeaders(true),
          body: JSON.stringify({ dealId: d.id, reason }),
        });
        const data = await r.json().catch(() => ({}));
        if (r.status === 401) {
          handleSessionExpired();
          openAuth('in');
          toast('Your session expired — sign in again to open the dispute', 'info');
          return true; // close the modal; the deal list re-renders signed-out
        }
        if (!r.ok) { toast(data.msg || (data.error === 'wrong_state' ? 'This deal can no longer be disputed' : (data.error || 'Could not open dispute')), 'err'); return false; }
        d.status = 'dispute';
        d.note = 'Disputed — awaiting admin arbitration';
        saveState();
        const chat = await ensureDealChat(d);
        await sysMsg(chat, 'dispute_opened', { reason });
        toast('Dispute opened — an admin will arbitrate', 'ok');
        renderDeals(); renderDealTabs(); renderDealsPage(); paintLocked();
        return true;
      } catch (e) {
        toast('Could not open dispute — check your connection', 'err');
        return false;
      }
    });
    return;
  } else if (b.dataset.act === 'credential') {
    await openCredential(d);
    return;
  } else if (b.dataset.act === 'review') {
    openReviewPrompt(d);
    return;
  } else if (b.dataset.act === 'chat') {
    const chat = await ensureDealChat(d);
    if (chat) { await openChat(chat.id); go('messages'); }
  } else if (b.dataset.act === 'receipt') {
    openReceipt(d);
    return;
  }
  saveState();
  renderDeals(); renderDealTabs(); renderDealsPage(); paintLocked(); renderGrid();
});

/* ================= wallet ================= */
const WALLET_SEED = 0;
let BAL = WALLET_SEED;
let TXS = [];
const TXICONS = {
  in:   '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14m0 0 5-5m-5 5-5-5"/></svg>',
  out:  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5m0 0 5 5m-5-5-5 5"/></svg>',
  hold: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  fee:  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M19 5 5 19"/><circle cx="7.5" cy="7.5" r="2.4"/><circle cx="16.5" cy="16.5" r="2.4"/></svg>',
};
function paintBal() {
  $('#walletAmt').textContent = fmt(BAL);
  const el = $('#waltAvail');
  if (el) el.textContent = fmt(BAL);
}
function paintLocked() {
  const locked = DEALS.filter(d => d.status === 'escrow').reduce((a, d) => a + d.amt, 0);
  const el = $('#waltLocked');
  if (el) el.textContent = fmt(locked) + ' USDT locked in escrow right now';
}
function renderTxs() {
  if (!TXS.length) {
    $('#txs').innerHTML = '<div class="deal-note" style="padding:6px 2px">No transactions yet — top up to start trading.</div>';
    return;
  }
  $('#txs').innerHTML = TXS.map(tx => `
    <div class="tx">
      <span class="tx-ico ${tx.k}">${TXICONS[tx.k] || TXICONS.in}</span>
      <span><span class="lbl">${esc(tx.lbl)}</span><br><span class="t">${esc(tx.t)}</span></span>
      <span class="amt mono ${tx.amt > 0 ? 'pos' : ''}">${tx.amt > 0 ? '+' : ''}${fmt(tx.amt)}</span>
    </div>`).join('');
}
document.querySelector('#view-wallet').addEventListener('click', e => {
  const b = e.target.closest('[data-wdemo]');
  if (!b) return;
  if (!AUTH) { openAuth('in'); toast('Sign in to use your wallet', 'info'); return; }
  if (b.dataset.wdemo.startsWith('Top up')) {
    openTopupModal();
  } else {
    toast(b.dataset.wdemo + ' (demo)', 'info');
  }
});

const CLOSE_X = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l14 14M19 5 5 19"/></svg>`;

function openTopupModal() {
  if (!AUTH) { openAuth('in'); toast('Sign in to top up your wallet', 'info'); return; }
  renderTopupEntry();
  $('#payOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function renderTopupEntry(prefill) {
  $('#payCard').innerHTML = `
    <button class="pay-x" id="payClose" aria-label="Close">${CLOSE_X}</button>
    <div class="pay-head">
      <h3>Top up wallet</h3>
      <p>Pay with crypto — credited after network confirmation.</p>
    </div>
    <div class="pay-summary">
      <label class="sf" style="display:block">
        <span>Amount (USDT)</span>
        <input id="topupAmt" type="number" min="5" step="0.01" value="${prefill != null ? prefill : ''}" placeholder="50.00" inputmode="decimal" style="width:100%">
      </label>
      <p class="muted" style="font-size:12px;margin-top:8px">Minimum 5 USDT.</p>
    </div>
    <div class="pay-foot">
      <p class="pay-error" id="payError" hidden></p>
      <button class="btn btn-pri pay-confirm" id="topupContinue">Continue to payment</button>
    </div>`;
  $('#payClose').addEventListener('click', closePaymentModal);
  $('#topupContinue').addEventListener('click', startTopup);
  const inp = $('#topupAmt');
  inp?.focus();
  inp?.addEventListener('keydown', e => { if (e.key === 'Enter') startTopup(); });
}

async function startTopup() {
  const amt = parseFloat($('#topupAmt')?.value);
  if (!Number.isFinite(amt) || amt < 5) { setPayError('Enter an amount of at least 5 USDT'); return; }
  const btn = $('#topupContinue');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating invoice…'; }
  setPayError('');
  try {
    const r = await fetch('/api/wallet/topup', {
      method: 'POST', headers: authHeaders(true),
      body: JSON.stringify({ amount: amt }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) {
      closePaymentModal();
      handleSessionExpired();
      openAuth('in', () => openTopupModal());
      toast('Your session expired — sign in again to top up', 'info');
      return;
    }
    if (!r.ok) {
      setPayError(d.msg || d.error || 'Could not start top-up');
      if (btn) { btn.disabled = false; btn.textContent = 'Continue to payment'; }
      return;
    }
    renderTopupPending(d);
  } catch (e) {
    setPayError('Network error — try again');
    if (btn) { btn.disabled = false; btn.textContent = 'Continue to payment'; }
  }
}

function renderTopupPending(t) {
  const hasGateway = !!t.payAddress;
  const network = t.networkLabel || t.payNetwork || 'the selected network';
  const currency = t.payCurrency || 'USDT';
  const link = t.payUrl
    ? `<a class="btn btn-sec pay-link" href="${esc(t.payUrl)}" target="_blank" rel="noopener">Open payment page</a>`
    : '';
  // No crypto provider configured on this server: there's no real deposit
  // address to pay, so offer a local simulate button instead of a dead
  // "Check payment now" that can never find a confirmation. The server only
  // honors this when it already marked the record sandbox-eligible
  // (dev/demo deployments only).
  const notice = (t.sandbox && !t.configured)
    ? `<p class="pay-notice">Crypto payments aren't configured on this server — this is a simulated top-up for local development.</p>
       <button class="btn btn-pri" id="topupSimulate" type="button">Simulate payment (dev)</button>
       <p class="muted" id="topupFallbackStatus" style="font-size:12px;margin-top:10px"></p>`
    : '';
  $('#payCard').innerHTML = `
    <button class="pay-x" id="payClose" aria-label="Close">${CLOSE_X}</button>
    <div class="pay-head">
      <h3>Complete your top-up</h3>
      <p>Order <span class="mono">${esc(t.orderId)}</span></p>
    </div>
    <div class="pay-crypto-pending">
      ${hasGateway
        ? paymentGatewayHtml({ network, currency, amount: fmt(t.amount), address: t.payAddress, expiresAt: t.expiresAt })
        : ''}
      ${link}
      <div class="pgw-actions">
        <button class="btn btn-sec" id="topupCheck" type="button">Check payment now</button>
      </div>
      ${notice}
    </div>`;
  if (hasGateway) initPaymentGateway($('#payCard'), { expiresAt: t.expiresAt });
  $('#payClose').addEventListener('click', closePaymentModal);
  $('#topupCheck').addEventListener('click', () => checkTopup(t.orderId, t.amount));
  $('#topupSimulate')?.addEventListener('click', () => simulateTopup(t.orderId, t.amount));
  pollTopup(t.orderId, t.amount);
}

// Reflects status in the gateway strip when one is on screen (a real native
// provider is configured), otherwise falls back to the plain status line
// shown alongside the dev-only "Simulate payment" button.
function setTopupFeedback(state, msg) {
  if ($('#pgwStatus')) { setGatewayStatus(state, msg); return; }
  const el = $('#topupFallbackStatus');
  if (el) el.textContent = msg || '';
}

async function simulateTopup(orderId, amount) {
  const btn = $('#topupSimulate');
  if (btn) { btn.disabled = true; btn.textContent = 'Simulating…'; }
  try {
    const r = await fetch('/api/wallet/topup/' + encodeURIComponent(orderId) + '/simulate', {
      method: 'POST', headers: authHeaders(),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.status === 'paid') { await onTopupPaid(amount); return; }
    setTopupFeedback('waiting', d.msg || 'Could not simulate payment — try again.');
  } catch (e) {
    setTopupFeedback('waiting', 'Network error — try again.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Simulate payment (dev)'; }
  }
}

// Map a server ledger entry to the TXS render shape. The server's wallet
// ledger is the source of truth — client-side TXS is only a cache, so we
// rebuild it from the ledger whenever we refresh.
const LEDGER_TO_TX = { deposit: 'in', refund: 'in', payout: 'in', hold: 'hold', fee: 'fee', withdrawal: 'out' };
function ledgerToTx(e) {
  const at = e.at ? new Date(e.at) : null;
  return {
    k: LEDGER_TO_TX[e.type] || (e.amt < 0 ? 'out' : 'in'),
    lbl: e.lbl || (e.type || 'Transaction'),
    amt: e.amt,
    t: at && !isNaN(at) ? fmtReceiptDate(at) : '',
  };
}
async function refreshWalletBalance() {
  try {
    const r = await fetch('/api/wallet', { headers: authHeaders() });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.wallet) {
      BAL = d.wallet.balance; paintBal();
      if (Array.isArray(d.wallet.ledger)) {
        TXS = d.wallet.ledger.map(ledgerToTx);
        saveState(); renderTxs();
      }
    }
  } catch (e) {}
}

async function onTopupPaid(amount) {
  // refreshWalletBalance() rebuilds TXS from the server's wallet ledger, which
  // already contains this deposit (it's credited before the status endpoint
  // reports 'paid') — adding another entry here duplicated every top-up.
  await refreshWalletBalance();
  setTopupFeedback('paid');
  // Top-up and checkout share #payOverlay, and pollTopup keeps polling after
  // the top-up modal closes — only close the overlay if a top-up view is
  // actually on screen, or a late confirmation would kill an in-progress
  // unrelated purchase.
  if ($('#topupCheck') || $('#topupAmt')) closePaymentModal();
  toast(`${fmt(amount)} USDT added to your balance`, 'ok');
}

async function checkTopup(orderId, amount) {
  const btn = $('#topupCheck');
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
  try {
    const r = await fetch('/api/wallet/topup/' + encodeURIComponent(orderId), { headers: authHeaders() });
    const d = await r.json().catch(() => ({}));
    if (d.status === 'paid') { await onTopupPaid(amount); return true; }
    if (d.progress) setTopupFeedback('seen', d.progress.confirmSecondsLeft);
    else if (['expired', 'cancelled'].includes(d.status)) setTopupFeedback('waiting', 'This top-up has expired — start a new one.');
    else setTopupFeedback('waiting', 'Not received yet — complete the payment, then check again.');
  } catch (e) {
    setTopupFeedback('waiting', 'Could not check — try again.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Check payment now'; }
  }
  return false;
}

async function pollTopup(orderId, amount) {
  for (let i = 0; i < 150; i++) {
    await new Promise(r => setTimeout(r, 4000));
    // Keep polling even if the user closed the top-up modal (e.g. to browse
    // while a crypto confirmation is pending) — otherwise a deposit that
    // confirms after the modal is closed never triggers onTopupPaid, and the
    // buyer only sees the credited balance/ledger entry on their next
    // unrelated wallet refresh, with no confirmation in the meantime.
    try {
      const r = await fetch('/api/wallet/topup/' + encodeURIComponent(orderId), { headers: authHeaders() });
      const d = await r.json().catch(() => ({}));
      if (d.status === 'paid') { await onTopupPaid(amount); return; }
      if (d.progress) setTopupFeedback('seen', d.progress.confirmSecondsLeft);
      if (['expired', 'cancelled'].includes(d.status)) { setTopupFeedback('waiting', 'This top-up has expired.'); return; }
    } catch (e) {}
  }
}

/* ================= forum ================= */
const FTAGS = ['All', 'Announcement', 'Question', 'Showcase', 'Guide', 'Discussion'];
S.forumTag = 'All';
const THREADS = [];
const voted = new Set();

function renderForumChips() {
  $('#forumChips').innerHTML = FTAGS.map(t =>
    `<button class="chip ${S.forumTag === t ? 'on' : ''}" data-ftag="${t}">${t}</button>`).join('');
}
function renderThreads() {
  const list = THREADS.filter(t => S.forumTag === 'All' || t.tag === S.forumTag);
  if (!list.length) {
    $('#threads').innerHTML = `<div class="panel" style="text-align:center;padding:40px 20px;color:var(--muted)">No threads yet — start the conversation above.</div>`;
    return;
  }
  $('#threads').innerHTML = list.map(t => {
    const i = THREADS.indexOf(t);
    return `
    <article class="thread panel">
      <div class="thread-top">
        <span class="s-ava" style="${AVAHUE(t.author)}">${initials(t.author)}</span>
        <span class="thread-who">
          <span class="nm">${esc(t.author)} <span class="role-chip ${t.role === 'Team' ? 'team' : ''}">${esc(t.role)}</span></span>
          <span class="mt">${esc(t.t)}</span>
        </span>
        <span class="thread-tag ${t.pin ? 'pin' : ''}">${t.pin ? '📌 ' + esc(t.tag) : esc(t.tag)}</span>
      </div>
      <h3>${esc(t.title)}</h3>
      <p>${esc(t.body)}</p>
      <div class="thread-foot">
        <button class="vote ${voted.has(i) ? 'on' : ''}" data-vote="${i}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5m0 0 6 6m-6-6-6 6"/></svg>
          ${t.votes + (voted.has(i) ? 1 : 0)}
        </button>
        <span class="thread-stat">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3c-1.5 0-3-.4-4.2-1.1L3 20l1.4-4.1A8.3 8.3 0 1 1 21 11.5Z"/></svg>
          ${t.comments} replies
        </span>
      </div>
    </article>`;
  }).join('');
}
$('#forumChips').addEventListener('click', e => {
  const b = e.target.closest('[data-ftag]');
  if (!b) return;
  S.forumTag = b.dataset.ftag;
  renderForumChips(); renderThreads();
});
$('#threads').addEventListener('click', e => {
  const b = e.target.closest('[data-vote]');
  if (!b) return;
  const i = +b.dataset.vote;
  voted.has(i) ? voted.delete(i) : voted.add(i);
  renderThreads();
});
$('#composerBtn').addEventListener('click', () => {
  const v = $('#composerIn').value.trim();
  if (!v) { toast('Write a title first — details and a section come next (demo)', 'info'); return; }
  THREADS.splice(1, 0, { author: AUTH ? AUTH.name : 'Guest', role: 'Trader', t: 'just now', tag: 'Discussion', votes: 0, comments: 0, title: v, body: 'Thread body editor opens after the title (demo).' });
  $('#composerIn').value = '';
  S.forumTag = 'All'; renderForumChips(); renderThreads();
  toast('Thread posted', 'ok');
});

/* ================= community (real-time server data) ================= */
let COMMUNITY = { sellers: [], stats: null };
let communityTimer = null;

async function loadCommunity() {
  try {
    const r = await fetch('/api/community/sellers');
    if (!r.ok) return;
    const d = await r.json();
    COMMUNITY.sellers = Array.isArray(d.sellers) ? d.sellers : [];
    COMMUNITY.stats = d.stats || null;
    renderCommunity();
    applyCommunityStats();
  } catch (e) { /* offline — keep last render */ }
}

function startCommunityPolling(on) {
  if (communityTimer) { clearInterval(communityTimer); communityTimer = null; }
  if (on) communityTimer = setInterval(loadCommunity, 15000);
}

function applyCommunityStats() {
  const s = COMMUNITY.stats;
  if (!s) return;
  const vals = [s.sellers || 0, s.verifiedSellers || 0, s.totalDeals || 0, s.listings || 0];
  document.querySelectorAll('.comm-stats .stat .v').forEach((el, i) => {
    if (vals[i] != null) el.textContent = String(vals[i]);
  });
}

function renderCommunity() {
  const top = [...COMMUNITY.sellers].sort((a, b) => b.deals - a.deals || b.rate - a.rate);
  $('#leaders').innerHTML = top.length
    ? top.map((s, i) => `
    <div class="leader-row">
      <span class="rank">${i + 1}</span>
      <span class="s-ava" style="${AVAHUE(s.name)}">${initials(s.name)}</span>
      <span><span class="nm">${esc(s.name)} ${s.verified ? VFY : ''}</span><span class="mt">${s.deals} ${s.deals === 1 ? 'deal' : 'deals'}${s.since ? ' · since ' + esc(s.since) : ''}</span></span>
      <span class="rt"><span class="st">★</span>${(s.rate ?? 5).toFixed(1)}</span>
    </div>`).join('')
    : `<div style="padding:20px;color:var(--muted)">No sellers yet.</div>`;
  $('#newbies').innerHTML = `<span class="mt" style="color:var(--muted)">No new members yet.</span>`;
}



/* ================= chat (server-backed buyer ↔ seller) ================= */
S.chat = null;
let chatPollTimer = null;

function authHeaders(json) {
  const token = getAuthToken();
  const h = token ? { Authorization: 'Bearer ' + token } : {};
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

function getAuthToken() {
  try { return localStorage.getItem('dk_token') || ''; } catch (e) { return ''; }
}

function hasApiSession() {
  return !!(AUTH && getAuthToken());
}

function mapConversationRow(c, prev) {
  return {
    id: c.id,
    who: c.who,
    role: c.role || 'Seller',
    dealId: c.dealId || null,
    listingId: c.listingId || null,
    title: c.title || '',
    unread: c.unread || 0,
    online: false,
    lastPreview: c.lastPreview || '',
    msgs: prev?.msgs || c.msgs || [],
    _loaded: prev?._loaded || false,
  };
}

function upsertChat(conv) {
  if (!conv?.id) return null;
  const i = CHATS.findIndex(c => c.id === conv.id);
  const row = mapConversationRow(conv, i >= 0 ? CHATS[i] : null);
  if (i >= 0) CHATS[i] = row;
  else CHATS.unshift(row);
  return row;
}

async function syncChatInbox() {
  if (!AUTH) { CHATS = []; renderChatList(); paintChatBadge(); return; }
  if (!hasApiSession()) return;
  try {
    const r = await fetch('/api/conversations', { headers: authHeaders() });
    if (r.status === 401) return;
    if (!r.ok) return;
    const { conversations } = await r.json();
    const prev = new Map(CHATS.map(c => [c.id, c]));
    CHATS = conversations.map(c => mapConversationRow(c, prev.get(c.id)));
    renderChatList();
    paintChatBadge();
    if (S.chat && $('#view-messages').classList.contains('on')) {
      const active = CHATS.find(x => x.id === S.chat);
      if (active?._loaded) await refreshActiveThread();
    }
  } catch (e) { /* offline */ }
}

async function loadThreadMessages(chat) {
  if (!chat || !AUTH) return;
  try {
    const r = await fetch('/api/conversations/' + encodeURIComponent(chat.id) + '/messages', { headers: authHeaders() });
    if (!r.ok) return;
    const { messages } = await r.json();
    chat.msgs = messages;
    chat._loaded = true;
  } catch (e) { /* offline */ }
}

async function markChatRead(chatId) {
  try {
    await fetch('/api/conversations/' + encodeURIComponent(chatId) + '/read', {
      method: 'POST', headers: authHeaders(true),
    });
  } catch (e) {}
}

async function apiEnsureConversation({ dealId, listingId, sellerName, sellerEmail, title }) {
  if (!hasApiSession()) throw new Error('session');
  const r = await fetch('/api/conversations', {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({ dealId, listingId, sellerName, sellerEmail, title, buyerName: AUTH?.name }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401) throw new Error('session');
    throw new Error(data.msg || 'Could not start conversation');
  }
  const chat = upsertChat(data.conversation);
  syncChatInbox().catch(() => {});
  return chat;
}

async function apiSystemMsg(chatId, kind, params) {
  await fetch('/api/conversations/' + encodeURIComponent(chatId) + '/system', {
    method: 'POST', headers: authHeaders(true), body: JSON.stringify({ kind, ...(params || {}) }),
  });
  await syncChatInbox();
  const chat = CHATS.find(c => c.id === chatId);
  if (chat) await loadThreadMessages(chat);
}

function paintChatBadge() {
  const n = CHATS.reduce((a, c) => a + (c.unread || 0), 0);
  const dot = $('#chatDot');
  dot.hidden = !n;
  dot.textContent = n > 9 ? '9+' : n;
}

async function ensureDealChat(deal) {
  const listing = LISTINGS.find(l => l.id === deal.lid);
  const sellerName = deal.who || listing?.seller?.name;
  const sellerEmail = deal.sellerEmail || listing?.sellerEmail || '';
  if (!sellerName || !AUTH) return null;
  let chat = CHATS.find(c => c.dealId === deal.id);
  if (chat) return chat;
  try {
    return await apiEnsureConversation({
      dealId: deal.id,
      listingId: deal.lid,
      sellerName,
      sellerEmail,
      title: deal.title,
    });
  } catch (e) {
    toast('Could not open deal chat — try again', 'info');
    return null;
  }
}

async function sysMsg(chat, kind, params) {
  if (!chat) return;
  // Chat sync is best-effort: the money action it narrates has already
  // committed server-side, so a failed POST must never reject into the
  // payment/dispute handlers (it freezes modals and misreports success as
  // "Could not release funds"). The server renders whitelisted templates
  // from { kind, ...params } — free-form system text is rejected there.
  try {
    await apiSystemMsg(chat.id, kind, params);
    if (S.chat === chat.id) renderThread();
  } catch (e) {}
}

async function openMessageSeller(sellerName, listingId) {
  const listing = LISTINGS.find(l => l.id === listingId);
  const title = listing?.title || '';
  const sellerEmail = listing?.sellerEmail || '';
  if (!AUTH) {
    openAuth('up', () => openMessageSeller(sellerName, listingId));
    toast('Sign in to message sellers', 'info');
    return;
  }
  if (!hasApiSession()) {
    openAuth('in', () => openMessageSeller(sellerName, listingId));
    toast('Sign in again to message sellers', 'info');
    return;
  }
  try {
    const chat = await apiEnsureConversation({ sellerName, sellerEmail, listingId, title });
    if (!chat?.id) {
      toast('Could not start conversation', 'info');
      return;
    }
    await openChat(chat.id);
    go('messages');
  } catch (e) {
    if (e.message === 'session') {
      openAuth('in', () => openMessageSeller(sellerName, listingId));
      toast('Sign in again to message sellers', 'info');
    } else {
      toast(e.message || 'Could not start conversation', 'info');
    }
  }
}

async function openChat(id) {
  let c = CHATS.find(x => x.id === id);
  if (!c && hasApiSession()) {
    await syncChatInbox();
    c = CHATS.find(x => x.id === id);
  }
  if (!c) return;
  S.chat = id;
  S.chatPeer = c.who || null; // keep the opened thread's group expanded
  c.unread = 0;
  markChatRead(id);
  if (!c._loaded) await loadThreadMessages(c);
  renderChatList();
  renderThread();
  paintChatBadge();
  $('#chatwrap').classList.add('in-chat');
}

function chatMsgPreview(m) {
  if (!m) return '';
  if (m.sys) return '⚙ ' + m.sys;
  const prefix = m.from === 'me' ? 'You: ' : '';
  if (m.image && !m.text) return prefix + '📷 Photo';
  if (m.image && m.text) return prefix + '📷 ' + m.text;
  return prefix + (m.text || '');
}

function chatMsgBubble(m) {
  if (m.sys) return `<div class="m-sys">${esc(m.sys)}</div>`;
  const img = m.image ? `<img class="m-img" src="${esc(m.image)}" alt="Shared image" loading="lazy" data-full="${esc(m.image)}">` : '';
  const txt = m.text ? esc(m.text) : '';
  return `<div class="m-row ${m.from}"><div class="m-bub">${img}${txt}<span class="m-t">${esc(m.t || '')}</span></div></div>`;
}

/* Group threads by counterparty so multiple deals with the same seller collapse
 * under one expandable row instead of repeating the seller name. */
function groupChatsByPeer() {
  const groups = new Map();
  for (const c of CHATS) {
    const key = c.who || 'Unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const lastAt = c => new Date(c.msgs?.[c.msgs.length - 1]?.at || c.lastMessageAt || 0).getTime();
  const out = [...groups.entries()].map(([who, threads]) => {
    threads.sort((a, b) => lastAt(b) - lastAt(a));
    const unread = threads.reduce((n, t) => n + (t.unread || 0), 0);
    const active = threads.some(t => t.id === S.chat);
    return { who, threads, unread, active, latest: threads[0] };
  });
  out.sort((a, b) => lastAt(b.latest) - lastAt(a.latest));
  return out;
}

function chatGroupExpanded(who, groups) {
  const g = groups.find(x => x.who === who);
  if (S.chatPeer == null) return !!(g && (g.active || g.threads.length === 1));
  return S.chatPeer === who;
}

function renderChatList() {
  if (!CHATS.length) {
    $('#chatlist').innerHTML = !AUTH
      ? '<div class="chat-empty"><b>Sign in to read your messages</b>Deal chats and seller messages live here.<br><button class="btn btn-pri" style="flex:none;margin-top:14px;padding:10px 22px" data-auth="in">Sign in</button></div>'
      : '<div class="chat-empty"><b>No conversations</b>Message a seller from any listing.</div>';
    return;
  }
  const groups = groupChatsByPeer();
  $('#chatlist').innerHTML = groups.map(g => {
    const latest = g.latest.msgs?.[g.latest.msgs.length - 1];
    const latestPreview = latest ? chatMsgPreview(latest) : (g.latest.lastPreview || 'Say hello to start the chat');
    const expanded = chatGroupExpanded(g.who, groups);
    const single = g.threads.length === 1;
    const threadRows = expanded ? g.threads.map(c => {
      const last = c.msgs?.[c.msgs.length - 1];
      const preview = last ? chatMsgPreview(last) : (c.lastPreview || 'Say hello to start the chat');
      const label = c.dealId ? `${esc(c.title || c.dealId)} · ${esc(c.dealId)}` : 'Direct message';
      return `
      <button class="ci-thread ${S.chat === c.id ? 'on' : ''}" data-chat="${c.id}">
        <span class="ci-thread-lbl">${label}</span>
        <span class="ci-thread-prev">${esc(preview)}</span>
        ${c.unread ? `<span class="ci-un">${c.unread}</span>` : ''}
      </button>`;
    }).join('') : '';
    return `
    <div class="cigroup">
      <button class="chatitem cigroup-head ${g.active ? 'on' : ''}" ${single ? `data-chat="${g.threads[0].id}"` : `data-peer="${esc(g.who)}"`}>
        <span class="s-ava" style="${AVAHUE(g.who)}">${initials(g.who)}</span>
        <span class="ci-body">
          <span class="ci-top"><b>${esc(g.who)}</b><span class="ci-t">${latest ? (latest.t || '') : ''}</span></span>
          <span class="ci-prev">${single ? esc(latestPreview) : `${g.threads.length} conversations · ${esc(latestPreview)}`}</span>
        </span>
        ${g.unread ? `<span class="ci-un">${g.unread}</span>` : ''}
        ${single ? '' : `<span class="ci-chev ${expanded ? 'open' : ''}" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></span>`}
      </button>
      ${threadRows}
    </div>`;
  }).join('');
}

function renderThread() {
  const pane = $('#chatpane');
  const c = CHATS.find(x => x.id === S.chat);
  if (!c) {
    pane.innerHTML = '<div class="chat-empty"><div><b>Pick a conversation</b>Deal chats and seller messages live here — everything stays on the record for the arbiter.</div></div>';
    return;
  }
  const deal = DEALS.find(d => d.id === c.dealId);
  pane.innerHTML = `
    <div class="chat-head">
      <button class="chat-back" id="chatBack" aria-label="Back to conversations">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>
      </button>
      <span class="s-ava" style="${AVAHUE(c.who)}">${initials(c.who)}</span>
      <span><span class="nm">${esc(c.who)}</span><span class="mt"><span class="ondot ${c.online ? 'on' : ''}"></span>${esc(c.role)} · messages are on the record</span></span>
    </div>
    ${deal ? `
    <div class="chat-deal">
      <span class="pill ${(DEALMETA[deal.status] || { cls: 'wait' }).cls}">${(DEALMETA[deal.status] || { lbl: deal.status }).lbl}</span>
      <span class="t">${esc(deal.title)}</span>
      <span class="a mono">${fmt(deal.amt)} USDT</span>
    </div>` : ''}
    <div class="chat-msgs" id="chatMsgs">
      ${(c.msgs || []).map(chatMsgBubble).join('')}
    </div>
    <div class="chat-composer">
      <input type="file" id="chatImgIn" accept="image/jpeg,image/png,image/gif,image/webp" hidden>
      <button class="chat-attach" id="chatAttach" type="button" aria-label="Upload image" ${AUTH ? '' : 'disabled'}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.75"/><path d="m21 15-5-5L5 21"/></svg>
      </button>
      <input class="chat-in" id="chatIn" placeholder="Message ${esc(c.who)}…" autocomplete="off" aria-label="Message" ${AUTH ? '' : 'disabled'}>
      <button class="chat-send" id="chatSend" aria-label="Send" ${AUTH ? '' : 'disabled'}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"/></svg>
      </button>
    </div>`;
  const box = $('#chatMsgs');
  if (box) box.scrollTop = box.scrollHeight;
  $('#chatSend')?.addEventListener('click', sendChat);
  $('#chatIn')?.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
  $('#chatAttach')?.addEventListener('click', () => $('#chatImgIn')?.click());
  $('#chatImgIn')?.addEventListener('change', e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) sendChatImage(f);
  });
  box?.addEventListener('click', e => {
    const img = e.target.closest('.m-img');
    if (img?.dataset.full) window.open(img.dataset.full, '_blank', 'noopener');
  });
  $('#chatBack')?.addEventListener('click', () => $('#chatwrap').classList.remove('in-chat'));
  $('#chatIn')?.focus();
}

async function refreshActiveThread() {
  const c = CHATS.find(x => x.id === S.chat);
  if (!c) return;
  const since = c.msgs?.length ? c.msgs[c.msgs.length - 1].at : null;
  try {
    const url = '/api/conversations/' + encodeURIComponent(c.id) + '/messages' + (since ? '?since=' + encodeURIComponent(since) : '');
    const r = await fetch(url, { headers: authHeaders() });
    if (!r.ok) return;
    const { messages } = await r.json();
    if (!since) c.msgs = messages;
    else if (messages.length) c.msgs = c.msgs.concat(messages);
    c._loaded = true;
    renderThread();
  } catch (e) {}
}

async function sendChat() {
  const c = CHATS.find(x => x.id === S.chat);
  const inp = $('#chatIn');
  const text = inp?.value.trim();
  if (!c || !text || !AUTH) return;
  inp.value = '';
  await postChatMessage(c, { text });
}

async function sendChatImage(file) {
  if (!file?.type?.startsWith('image/')) {
    toast('Please choose a JPEG, PNG, GIF, or WebP image', 'info');
    return;
  }
  if (file.size > 4 * 1024 * 1024) {
    toast('Image must be under 4 MB', 'info');
    return;
  }
  const c = CHATS.find(x => x.id === S.chat);
  if (!c || !AUTH) return;
  const caption = $('#chatIn')?.value.trim() || '';
  if ($('#chatIn')) $('#chatIn').value = '';
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(file);
  });
  await postChatMessage(c, { image: dataUrl, text: caption });
}

async function postChatMessage(c, payload, opts = {}) {
  const { silent = false } = opts;
  try {
    const r = await fetch('/api/conversations/' + encodeURIComponent(c.id) + '/messages', {
      method: 'POST', headers: authHeaders(true), body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.msg || 'send failed');
    }
    const { message } = await r.json();
    c.msgs = c.msgs || [];
    c.msgs.push(message);
    if (S.chat === c.id) renderThread();
    await syncChatInbox();
  } catch (e) {
    if (!silent) {
      toast(e.message === 'Invalid or too large image (max 4 MB)' ? e.message : 'Message not sent — check your connection', 'info');
    }
  }
}

function paymentNotifyText(deal) {
  return `Hi! I've paid ${fmt(deal.amt)} USDT into escrow for "${deal.title}" (${deal.id}). Please deliver when ready.`;
}

function startChatPoll() {
  if (chatPollTimer) return;
  chatPollTimer = setInterval(() => {
    if (AUTH) { syncChatInbox(); syncDealStates(); }
  }, 5000);
}

$('#chatlist').addEventListener('click', e => {
  const peer = e.target.closest('[data-peer]');
  if (peer) {
    const who = peer.dataset.peer;
    S.chatPeer = (S.chatPeer === who) ? null : who;
    renderChatList();
    return;
  }
  const b = e.target.closest('[data-chat]');
  if (b) openChat(b.dataset.chat);
});
startChatPoll();


/* ================= auth ================= */
let AUTH = loadJSON('dk_user', null);
let authMode = 'up', afterAuth = null, pendingVerifyEmail = null;

function paintAuth() {
  document.querySelector('.wallet').style.display = AUTH ? '' : 'none';
  const ca = $('#composerAva');
  if (ca) {
    ca.textContent = AUTH ? initials(AUTH.name) : '?';
    ca.setAttribute('style', AUTH ? AVAHUE(AUTH.name) : 'background:var(--surface-3);color:var(--muted)');
  }
  const slot = $('#authSlot');
  if (AUTH) {
    slot.innerHTML = `<span class="avatar" id="avaBtn" style="${AVAHUE(AUTH.name)}" title="${esc(AUTH.name)}">${initials(AUTH.name)}</span>`;
    $('#avName').textContent = AUTH.name;
    $('#avEmail').textContent = AUTH.email;
    const ma = $('#avMenuAva');
    if (ma) { ma.textContent = initials(AUTH.name); ma.setAttribute('style', AVAHUE(AUTH.name)); }
    $('#avaBtn').addEventListener('click', e => {
      e.stopPropagation();
      const m = $('#avaMenu');
      if (m.hidden) {
        // Anchor the menu to the avatar: right edges aligned, 10px gap,
        // and never closer than 12px to the viewport edge.
        const r = e.currentTarget.getBoundingClientRect();
        m.style.top = Math.round(r.bottom + 10) + 'px';
        m.style.right = Math.max(12, Math.round(window.innerWidth - r.right)) + 'px';
        m.hidden = false;
      } else {
        m.hidden = true;
      }
    });
  } else {
    slot.innerHTML = `
      <span class="auth-btns">
        <button class="btn-in" data-auth="in">Sign in</button>
        <button class="btn-up" data-auth="in">Log in</button>
      </span>`;
  }
  $('#avaMenu').hidden = true;
}

function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll('[data-amode]').forEach(b => b.classList.toggle('on', b.dataset.amode === mode));
  document.querySelector('.auth-tabs').classList.toggle('m-in', mode === 'in');
  $('#pwMeter').style.display = mode === 'up' ? '' : 'none';
  $('#afName').style.display = mode === 'up' ? '' : 'none';
  $('#authTitle').textContent = mode === 'up' ? 'Create your account' : 'Welcome back';
  $('#authSub').textContent = mode === 'up'
    ? 'Buy and sell anything — every deal protected by escrow.'
    : 'Sign in to your Dot Marketplace account.';
  $('#authGo').textContent = mode === 'up' ? 'Create account' : 'Sign in';
  $('#authSwap').textContent = mode === 'up' ? 'Already have an account? Sign in' : "New here? Create an account";
  document.querySelectorAll('.af').forEach(f => f.classList.remove('err'));
  document.querySelectorAll('.aerr').forEach(e => e.textContent = '');
}

function openAuth(mode, after) {
  afterAuth = after || null;
  setAuthMode(mode || 'up');
  // Reset to the base auth form in case a previous verify step was open.
  pendingVerifyEmail = null;
  $('#verifyForm').hidden = true;
  $('#authForm').hidden = false;
  $('#authOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(() => $(mode === 'up' ? '#authName' : '#authEmail').focus(), 250);
}
function closeAuth() {
  $('#authOverlay').classList.remove('open');
  document.body.style.overflow = '';
  afterAuth = null;
}

function fieldError(input, msg) {
  const f = input.closest('.af');
  f.classList.toggle('err', !!msg);
  f.querySelector('.aerr').textContent = msg || '';
  return !msg;
}

function submitAuth() {
  const name = $('#authName').value.trim();
  const email = $('#authEmail').value.trim().toLowerCase();
  const pass = $('#authPass').value;
  let ok = true;
  if (authMode === 'up') ok = fieldError($('#authName'), name.length >= 2 ? '' : 'At least 2 characters') && ok;
  ok = fieldError($('#authEmail'), /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? '' : 'Enter a valid email address') && ok;
  ok = fieldError($('#authPass'), pass.length >= 8 ? '' : 'At least 8 characters') && ok;
  if (!ok) {
    const c = $('.auth-card');
    c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake');
    return;
  }
  const go = $('#authGo');
  go.disabled = true;
  go.innerHTML = '<span class="aspin"></span>' + (authMode === 'up' ? 'Creating account…' : 'Signing in…');
  setTimeout(async () => {
    const fail = (sel, msg) => { go.disabled = false; setAuthMode(authMode); fieldError($(sel), msg); };
    let token = null, user = null, remote = false, needsVerification = false, devCode = null;
    try {
      const r = await fetch('/api/auth/' + (authMode === 'up' ? 'signup' : 'signin'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authMode === 'up' ? { name, email, password: pass } : { email, password: pass }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) { token = data.token; user = data.user; remote = true; needsVerification = !!data.needsVerification; devCode = data.devCode || null; }
      else if (data.error === 'email') return fail('#authEmail', data.msg);
      else if (data.error === 'password') return fail('#authPass', data.msg);
      else if (data.error === 'name') return fail('#authName', data.msg);
      else return fail('#authEmail', data.msg || 'Something went wrong — try again');
    } catch (e) { /* server offline — local fallback */ }
    if (!remote) {
      const accounts = loadJSON('dk_accounts', {});
      if (authMode === 'up' && accounts[email]) return fail('#authEmail', 'Account exists — sign in instead');
      if (authMode === 'in') {
        if (!accounts[email]) return fail('#authEmail', 'No account with this email');
        if (accounts[email].pass !== pass) return fail('#authPass', 'Incorrect password');
      }
      user = authMode === 'up' ? { name, email } : accounts[email].user;
      if (authMode === 'up') {
        accounts[email] = { pass, user };
        try { localStorage.setItem('dk_accounts', JSON.stringify(accounts)); } catch (e) {}
      }
    }
    if (!user) return fail('#authEmail', 'Something went wrong — try again');
    if (token) try { localStorage.setItem('dk_token', token); } catch (e) {}
    AUTH = user;
    try { localStorage.setItem('dk_user', JSON.stringify(AUTH)); } catch (e) {}
    go.disabled = false;
    paintAuth();
    loadState(authMode === 'up');
    refreshUserViews();
    syncFromServer();
    // Signup with email verification: show the code step (soft — skippable).
    if (authMode === 'up' && needsVerification) {
      showVerifyStep(email, devCode);
      return;
    }
    $('#authOverlay').classList.remove('open');
    document.body.style.overflow = '';
    toast(`Welcome${authMode === 'up' ? '' : ' back'}, ${AUTH.name}`, 'ok');
    const cb = afterAuth; afterAuth = null;
    if (cb) setTimeout(cb, 450);
  }, 750);
}

/* Swap the auth form for the 6-digit verification-code step. The user is
 * already signed in (soft enforcement) — verifying just confirms the email. */
function showVerifyStep(email, devCode) {
  pendingVerifyEmail = email;
  $('#authForm').hidden = true;
  $('#verifyForm').hidden = false;
  $('#authTitle').textContent = 'Verify your email';
  $('#authSub').textContent = devCode
    ? `Dev mode (no SMTP): your code is ${devCode}`
    : `We emailed a 6-digit code to ${email}. Enter it below — it expires in 10 minutes.`;
  $('#verifyCode').value = '';
  setTimeout(() => $('#verifyCode').focus(), 150);
}

function closeVerifyStep() {
  pendingVerifyEmail = null;
  $('#verifyForm').hidden = true;
  $('#authForm').hidden = false;
  $('#authOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

async function submitVerify(e) {
  if (e) e.preventDefault();
  const code = $('#verifyCode').value.trim();
  if (!/^\d{6}$/.test(code)) { fieldError($('#verifyCode'), 'Enter the 6-digit code'); return; }
  fieldError($('#verifyCode'), '');
  const go = $('#verifyGo');
  go.disabled = true;
  go.textContent = 'Verifying…';
  try {
    const r = await fetch('/api/auth/verify-email', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: pendingVerifyEmail, code }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.verified) {
      if (AUTH) { AUTH.emailVerified = true; try { localStorage.setItem('dk_user', JSON.stringify(AUTH)); } catch (e) {} }
      closeVerifyStep();
      toast('Email verified — welcome to Dot Marketplace', 'ok');
      const cb = afterAuth; afterAuth = null;
      if (cb) setTimeout(cb, 450);
      return;
    }
    go.disabled = false;
    go.textContent = 'Verify email';
    fieldError($('#verifyCode'), data.msg || 'Could not verify — try again');
  } catch (e) {
    go.disabled = false;
    go.textContent = 'Verify email';
    fieldError($('#verifyCode'), 'Connection error — try again');
  }
}

async function resendVerifyCode(e) {
  if (e) e.preventDefault();
  if (!pendingVerifyEmail) return;
  const link = $('#verifyResend');
  link.style.pointerEvents = 'none';
  try {
    const r = await fetch('/api/auth/resend-code', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: pendingVerifyEmail }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      if (data.devCode) $('#authSub').textContent = `Dev mode (no SMTP): your code is ${data.devCode}`;
      toast('Code resent — check your inbox', 'ok');
    } else {
      toast(data.msg || 'Could not resend', 'info');
    }
  } catch (e) { toast('Connection error', 'err'); }
  setTimeout(() => { link.style.pointerEvents = ''; }, 5000);
}

$('#verifyForm').addEventListener('submit', submitVerify);
$('#verifyResend').addEventListener('click', resendVerifyCode);
$('#verifySkip').addEventListener('click', e => {
  e.preventDefault();
  closeVerifyStep();
  toast('You can verify later — your account is ready', 'info');
  const cb = afterAuth; afterAuth = null;
  if (cb) setTimeout(cb, 450);
});

document.addEventListener('click', e => {
  const ab = e.target.closest('[data-auth]');
  if (ab) openAuth(ab.dataset.auth);
  if (e.target.closest('[data-ax]') || e.target === $('#authOverlay')) closeAuth();
  const m = $('#avaMenu');
  if (!m.hidden && !e.target.closest('#avaMenu') && !e.target.closest('#avaBtn')) m.hidden = true;
  const am = e.target.closest('[data-am]');
  if (am) {
    m.hidden = true;
    if (am.dataset.am === 'out') {
      try { localStorage.removeItem('dk_user'); localStorage.removeItem('dk_token'); } catch (err) {}
      AUTH = null;
      paintAuth();
      loadState(false);
      refreshUserViews();
      toast('Signed out — your data is saved for next time', 'info');
    } else go(am.dataset.am);
  }
});
document.querySelector('.auth-tabs').addEventListener('click', e => {
  const t = e.target.closest('[data-amode]');
  if (t) setAuthMode(t.dataset.amode);
});
$('#authSwap').addEventListener('click', e => { e.preventDefault(); setAuthMode(authMode === 'up' ? 'in' : 'up'); });
$('#authForm').addEventListener('submit', e => { e.preventDefault(); submitAuth(); });
['#authName', '#authEmail', '#authPass'].forEach(sel =>
  $(sel).addEventListener('input', e => fieldError(e.target, '')));
$('#authPass').addEventListener('input', () => {
  const v = $('#authPass').value;
  let sc = 0;
  if (v.length >= 8) sc++;
  if (v.length >= 12) sc++;
  if (/[a-z]/.test(v) && /[A-Z]/.test(v)) sc++;
  if (/\d/.test(v) && /[^a-zA-Z0-9]/.test(v)) sc++;
  const cols = ['', 'var(--danger)', 'var(--warning)', 'var(--accent)', 'var(--success)'];
  const lbls = ['', 'Weak', 'Fair', 'Good', 'Strong'];
  document.querySelectorAll('#pwMeter i').forEach((b, i) => {
    b.style.background = v && i < sc ? cols[sc] : '';
  });
  $('#pwLabel').textContent = v ? lbls[sc] : '';
});
$('#pwToggle').addEventListener('click', () => {
  const i = $('#authPass');
  i.type = i.type === 'password' ? 'text' : 'password';
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#authOverlay').classList.contains('open')) closeAuth(); });

/* deal-of-the-day shortcut */
document.addEventListener('click', e => {
  const f = e.target.closest('[data-feat]');
  if (f) openListing(f.dataset.feat);
  const h = e.target.closest('[data-hero-open]');
  if (h) openListing(h.dataset.heroOpen);
});

/* count-up numbers */
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
function countUp(el, to, opts = {}) {
  const { dec = 0, pre = '', suf = '' } = opts;
  if (RM) { el.textContent = pre + to.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suf; return; }
  const t0 = performance.now(), dur = 950;
  (function step(now) {
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = pre + (to * e).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suf;
    if (k < 1) requestAnimationFrame(step);
  })(t0);
}
let walletCounted = false;
function countWallet() {
  if (walletCounted) return;
  walletCounted = true;
  countUp($('#waltAvail'), BAL, { dec: 2 });
}

/* ================= boot ================= */
migrateLegacy();
loadState(false);
renderChips();
renderDeals();
renderTopSellers();
renderDealTabs();
renderDealsPage();
renderTxs();
paintBal();
paintLocked();
renderForumChips();
renderThreads();
renderCommunity();
renderChatList();
renderThread();
paintChatBadge();
paintAuth();
refresh();
renderHero();
renderPopular();
if (location.hash) {
  // Mirror the hashchange handler: parse seller/<slug> deep-links into the
  // seller view (loadSellerProfile) instead of passing the raw hash to go(),
  // which matches no view and renders a blank page.
  const p = parseHashView();
  if (p.view === 'seller') go('seller', { sellerId: p.sellerId });
  else go(p.view, { keepHash: true });
}
if (AUTH && !getAuthToken()) {
  toast('Sign in again to sync deals and messages', 'info');
}
syncFromServer();
loadListings();
loadFeeConfig();
