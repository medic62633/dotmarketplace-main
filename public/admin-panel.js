/* Admin portal — /admin/
 * Same PanelCommon framework as the seller portal: shared tabs, tables,
 * search/filter/pagination, skeletons, and error handling.
 */
PanelCommon.boot({
  role: 'admin',
  tabs: [
    ['overview', 'Overview'],
    ['orders', 'Orders'],
    ['sellers', 'Sellers'],
    ['withdrawals', 'Withdrawals'],
    ['payments', 'Payments'],
    ['listings', 'Listings'],
    ['disputes', 'Disputes'],
  ],

  async render(tab, ctx) {
    const { root, ui, api } = ctx;
    const S = ctx.state;

    if (!ctx.user?.isAdmin) {
      root.innerHTML = ui.empty('Admin access required', 'Sign in with an admin account.');
      return;
    }

    await ui.into(root, tab === 'overview' ? 'stats' : 'table', async () => {
      S.config = await api('/api/admin/config');

      if (tab === 'overview') await renderOverview(ctx);
      else if (tab === 'orders') await renderOrders(ctx);
      else if (tab === 'sellers') await renderSellers(ctx);
      else if (tab === 'withdrawals') await renderWithdrawals(ctx);
      else if (tab === 'payments') await renderPayments(ctx);
      else if (tab === 'listings') await renderListings(ctx);
      else if (tab === 'disputes') await renderDisputes(ctx);
    });

    if (root.querySelector('[data-retry]')) {
      root.querySelector('[data-retry]').addEventListener('click', () => ctx.showTab(tab));
    }
  },
});

/* ------------------------------- tabs ------------------------------- */

async function renderOverview(ctx) {
  const { root, ui, api, fmt, esc } = ctx;
  const dash = await api('/api/admin/dashboard');
  const cfg = ctx.state.config || {};

  root.innerHTML = `
    ${ui.banner(`Payments: <b>${esc(cfg.paymentProvider || '—')}</b> · ${cfg.paymentsConfigured ? 'configured' : 'not configured'}${cfg.sandbox ? ' · sandbox' : ''}${cfg.fees ? ` · platform ${cfg.fees.platformFeePercent}% · gateway ${cfg.fees.gatewayFeePercent}%` : ''}`, 'info')}
    ${ui.stats([
      { k: 'Users', v: dash.stats.users },
      { k: 'Sellers', v: dash.stats.sellers },
      { k: 'Pending sellers', v: dash.stats.pendingSellers },
      { k: 'Active listings', v: dash.stats.activeListings },
      { k: 'Pending withdrawals', v: dash.stats.pendingWithdrawals },
      { k: 'Paid today', v: dash.stats.paymentsToday },
      { k: 'Platform fees earned', v: fmt(dash.stats.platformFeesTotal || 0), mono: true },
    ])}
    <section class="panel" style="margin-top:16px">
      <h2>Recent payments</h2>
      <div id="ovPayments"></div>
    </section>
    ${(dash.stats.pendingSellers > 0 || dash.stats.pendingWithdrawals > 0) ? `
    <section class="panel" style="margin-top:16px">
      <h2>Action needed</h2>
      <p class="seller-hint">${dash.stats.pendingSellers} seller(s) awaiting verification · ${dash.stats.pendingWithdrawals} withdrawal(s) pending</p>
      <div class="seller-actions">
        <button class="btn btn-pri" data-goto="sellers" data-filter="pending">Review sellers</button>
        <button class="btn btn-sec" data-goto="withdrawals">Review withdrawals</button>
      </div>
    </section>` : ''}`;

  mountPaymentsTable($('#ovPayments'), dash.recentPayments, ctx, { pageSize: 5 });

  root.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.filter) ctx.state.sellerFilter = b.dataset.filter;
    ctx.showTab(b.dataset.goto);
  }));
}

async function renderSellers(ctx) {
  const { root, api, table, fmt, esc, ui, toast } = ctx;
  const { sellers } = await api('/api/admin/sellers');
  const initialFilter = ctx.state.sellerFilter || 'all';
  ctx.state.sellerFilter = 'all';

  root.innerHTML = `
    <section class="panel">
      <h2>Provision a seller</h2>
      <p class="seller-hint">Seller accounts are invite-only. Generate a one-time setup link and send it to the seller — it creates their verified login when they set a password. The link is shown once and works a single time.</p>
      <form id="inviteForm" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <label class="sf" style="flex:1;min-width:240px"><span>Seller email</span>
          <input id="inviteEmail" type="email" placeholder="seller@example.com" required>
        </label>
        <button class="btn btn-pri" type="submit" id="inviteGen">Generate setup link</button>
      </form>
      <div id="inviteResult"></div>
      <div id="invitesTbl" style="margin-top:14px"></div>
    </section>
    <section class="panel" style="margin-top:16px"><h2>Seller accounts</h2><div id="sellersTbl"></div></section>`;

  await renderInvites(ctx);
  wireInviteForm(ctx);

  const holder = $('#sellersTbl');
  const tbl = table(holder, {
    key: s => s.email,
    rows: sellers,
    pageSize: 10,
    searchText: s => `${s.name} ${s.email}`,
    filters: [
      { id: 'all', label: 'All', match: () => true },
      { id: 'pending', label: 'Pending', match: s => !s.verified },
      { id: 'verified', label: 'Verified', match: s => s.verified },
    ],
    emptyText: 'No sellers',
    columns: [
      { label: 'Seller', value: s => `<b>${esc(s.name)}</b><br><span class="muted">${esc(s.email)}</span>` },
      { label: 'Status', value: s => s.verified ? ui.statusBadge('verified') : ui.statusBadge('pending') },
      { label: 'Balance', value: s => `<span class="mono">${fmt(s.balance)}</span>` },
      { label: 'Deals', value: s => s.deals || 0 },
      { label: 'Joined', value: s => `<span class="muted">${s.createdAt ? new Date(s.createdAt).toLocaleDateString() : '—'}</span>` },
    ],
    rowActions: s => s.verified
      ? `<button class="btn btn-ghost btn-sm" data-act="reject" data-id="${esc(s.email)}">Revoke</button>`
      : `<button class="btn btn-pri btn-sm" data-act="verify" data-id="${esc(s.email)}">Verify</button>`,
  });

  if (initialFilter !== 'all') {
    holder.querySelector(`[data-filter="${initialFilter}"]`)?.click();
  }

  holder.addEventListener('action', async e => {
    const { type, id } = e.detail;
    try {
      if (type === 'reject') {
        const ok = await ui.dialog({ title: 'Revoke seller', body: `Revoke <b>${esc(id)}</b>? Their listings are hidden and they can no longer sign in to the seller portal.`, confirmText: 'Revoke', danger: true });
        if (!ok) return;
        await api('/api/admin/sellers/' + encodeURIComponent(id) + '/reject', { method: 'POST' });
        toast('Seller revoked', 'ok');
      } else if (type === 'verify') {
        await api('/api/admin/sellers/' + encodeURIComponent(id) + '/verify', { method: 'POST' });
        toast('Seller verified — their listings can go live', 'ok');
      }
      ctx.showTab('sellers');
    } catch (err) { toast(err.message, 'info'); }
  });
}

function wireInviteForm(ctx) {
  const { api, esc, toast } = ctx;
  const form = $('#inviteForm');
  if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#inviteGen');
    const email = $('#inviteEmail')?.value.trim();
    if (!email) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
    try {
      const res = await api('/api/admin/seller-invites', { method: 'POST', body: { email } });
      const box = $('#inviteResult');
      box.innerHTML = `
        <div class="seller-banner banner-ok" style="margin-top:12px">
          <b>Setup link for ${esc(email)}</b> (shown once — copy it now):<br>
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
            <input class="pd-input" style="flex:1;min-width:260px" readonly value="${esc(res.setupLink)}" id="inviteLink">
            <button class="btn btn-sec btn-sm" type="button" id="inviteCopy">Copy</button>
          </div>
        </div>`;
      $('#inviteLink')?.addEventListener('click', function () { this.select(); });
      $('#inviteCopy')?.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(res.setupLink); toast('Link copied', 'ok'); }
        catch (e2) { $('#inviteLink')?.select(); toast('Select and copy manually', 'info'); }
      });
      $('#inviteEmail').value = '';
      await renderInvites(ctx);
    } catch (err) {
      toast(err.message, 'info');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Generate setup link'; }
    }
  });
}

async function renderInvites(ctx) {
  const { api, table, esc, ui } = ctx;
  const { invites } = await api('/api/admin/seller-invites');
  const holder = $('#invitesTbl');
  if (!holder) return;
  if (!invites.length) { holder.innerHTML = ''; return; }
  table(holder, {
    key: i => i.id,
    rows: invites,
    pageSize: 8,
    searchText: i => `${i.email} ${i.status}`,
    filters: [
      { id: 'all', label: 'All', match: () => true },
      { id: 'unused', label: 'Active', match: i => i.status === 'unused' },
      { id: 'used', label: 'Used', match: i => i.status === 'used' },
    ],
    emptyText: 'No invites yet',
    columns: [
      { label: 'Seller email', value: i => `<b>${esc(i.email)}</b>` },
      { label: 'Status', value: i => ui.statusBadge(i.status === 'unused' ? 'active' : i.status) },
      { label: 'Created', value: i => `<span class="muted">${i.createdAt ? new Date(i.createdAt).toLocaleString() : '—'}</span>` },
      { label: 'Expires', value: i => `<span class="muted">${i.expiresAt ? new Date(i.expiresAt).toLocaleDateString() : '—'}</span>` },
    ],
  });
}

async function renderWithdrawals(ctx) {
  const { root, api, table, fmt, esc, ui, toast } = ctx;
  const { withdrawals } = await api('/api/admin/withdrawals');
  const pending = withdrawals.filter(w => w.status === 'pending');

  root.innerHTML = `
    ${pending.length ? ui.banner(`${pending.length} withdrawal(s) need review`) : ''}
    <section class="panel" style="margin-top:${pending.length ? '0' : '14px'}">
      <h2>Withdrawal requests</h2>
      <div id="wdTbl"></div>
    </section>`;

  const holder = $('#wdTbl');
  table(holder, {
    key: w => w.id,
    rows: withdrawals,
    pageSize: 10,
    searchText: w => `${w.sellerEmail} ${w.address} ${w.status}`,
    filters: [
      { id: 'all', label: 'All', match: () => true },
      { id: 'pending', label: 'Pending', match: w => w.status === 'pending' },
      { id: 'completed', label: 'Completed', match: w => w.status === 'completed' },
      { id: 'rejected', label: 'Rejected', match: w => w.status === 'rejected' },
    ],
    emptyText: 'No withdrawals',
    columns: [
      { label: 'ID', value: w => `<span class="mono">${esc(String(w.id).slice(0, 10))}…</span>` },
      { label: 'Seller', value: w => esc(w.sellerEmail) },
      { label: 'Amount', value: w => `<span class="mono">${fmt(w.amount)} USDT</span>` },
      { label: 'Destination', value: w => `<span class="mono">${esc(w.address)}</span><br><span class="muted">${esc(w.network)}</span>` },
      { label: 'Status', value: w => ui.statusBadge(w.status) },
      { label: 'Requested', value: w => `<span class="muted">${w.createdAt ? new Date(w.createdAt).toLocaleString() : '—'}</span>` },
    ],
    rowActions: w => w.status === 'pending'
      ? `<button class="btn btn-pri btn-sm" data-act="approve" data-id="${esc(w.id)}">Approve</button>
         <button class="btn btn-ghost btn-sm" data-act="reject" data-id="${esc(w.id)}">Reject</button>`
      : '',
  });

  holder.addEventListener('action', async e => {
    const { type, id } = e.detail;
    try {
      if (type === 'approve') {
        const txHash = await ui.dialog({
          title: 'Approve withdrawal',
          body: 'Send USDT to the seller off-platform first, then record the on-chain transaction hash to mark this completed.',
          input: 'text',
          placeholder: 'Transaction hash',
          confirmText: 'Approve',
          required: true,
        });
        if (!txHash) return;
        await api('/api/admin/withdrawals/' + id + '/approve', { method: 'POST', body: { txHash } });
        toast('Withdrawal approved', 'ok');
      } else if (type === 'reject') {
        const ok = await ui.dialog({ title: 'Reject withdrawal', body: 'Reject this withdrawal and return funds to the seller balance?', confirmText: 'Reject & refund', danger: true });
        if (!ok) return;
        await api('/api/admin/withdrawals/' + id + '/reject', { method: 'POST' });
        toast('Withdrawal rejected — funds returned', 'ok');
      }
      ctx.showTab('withdrawals');
    } catch (err) { toast(err.message, 'info'); }
  });
}

/* Status display metadata for the unified orders feed. */
const escHtml = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ORDER_STATUS = {
  paid:         { lbl: 'Paid', cls: 'ok' },
  held:         { lbl: 'In escrow', cls: '' },
  delivered:    { lbl: 'Delivered', cls: '' },
  dispute:      { lbl: 'Disputed', cls: 'warn' },
  released:     { lbl: 'Released', cls: 'ok' },
  refunded:     { lbl: 'Refunded', cls: 'warn' },
  cancelled:    { lbl: 'Cancelled', cls: 'warn' },
  pending:      { lbl: 'Pending', cls: '' },
  out_of_stock: { lbl: 'Out of stock — refund', cls: 'warn' },
};
function orderStatusBadge(status) {
  const m = ORDER_STATUS[String(status || '').toLowerCase()] || { lbl: escHtml(status || '—'), cls: '' };
  return `<span class="badge ${m.cls}">${m.lbl}</span>`;
}

async function renderOrders(ctx) {
  const { root, api, table, fmt, esc, ui } = ctx;
  // Pull all pages server-side so client search/filter sees the full feed.
  let orders = [];
  let page = 1, pages = 1;
  do {
    const r = await api(`/api/admin/orders?page=${page}&pageSize=100`);
    orders = orders.concat(r.orders || []);
    pages = r.pages || 1;
    page += 1;
  } while (page <= pages);

  const counts = orders.reduce((m, o) => { m[o.status] = (m[o.status] || 0) + 1; return m; }, {});
  const oosCount = orders.filter(o => o.outOfStock).length;
  root.innerHTML = `
    ${oosCount ? ui.banner(`⚠ ${oosCount} paid order(s) could not be auto-delivered (out of stock) — refund these buyers.`) : ''}
    <section class="panel" style="margin-top:${oosCount ? '0' : '14px'}">
      <h2>All orders</h2>
      <p class="seller-hint">Every order across the marketplace with its current escrow state — paid, in escrow, delivered, disputed, released, refunded.</p>
      <div id="ordTbl"></div>
    </section>`;

  const holder = $('#ordTbl');
  table(holder, {
    key: o => o.orderId,
    rows: orders,
    pageSize: 12,
    searchText: o => `${o.orderId} ${o.title || ''} ${o.buyerEmail || ''} ${o.sellerEmail || ''} ${o.status || ''} ${o.method || ''}`,
    filters: [
      { id: 'all', label: `All (${orders.length})`, match: () => true },
      { id: 'paid', label: `Paid (${counts.paid || 0})`, match: o => o.status === 'paid' },
      { id: 'held', label: `In escrow (${counts.held || 0})`, match: o => o.status === 'held' },
      { id: 'delivered', label: `Delivered (${counts.delivered || 0})`, match: o => o.status === 'delivered' },
      { id: 'dispute', label: `Disputed (${counts.dispute || 0})`, match: o => o.status === 'dispute' },
      { id: 'released', label: `Released (${counts.released || 0})`, match: o => o.status === 'released' },
      { id: 'refunded', label: `Refunded (${counts.refunded || 0})`, match: o => o.status === 'refunded' },
      ...(oosCount ? [{ id: 'oos', label: `Out of stock (${oosCount})`, match: o => !!o.outOfStock }] : []),
    ],
    emptyText: 'No orders yet.',
    columns: [
      { label: 'Order', value: o => `<b>${esc(o.title || '—')}</b><br><span class="mono muted">${esc(o.orderId)}</span>` },
      { label: 'Amount', value: o => `<span class="mono">${fmt(o.amount)} USDT</span>${o.buyerTotal && o.buyerTotal !== o.amount ? `<br><span class="muted mono" style="font-size:11px">paid ${fmt(o.buyerTotal)}</span>` : ''}` },
      { label: 'Status', value: o => `${orderStatusBadge(o.status)}${o.outOfStock && o.status !== 'out_of_stock' ? ' <span class="badge warn" title="Paid but no credential was available to deliver — refund this buyer">out of stock</span>' : ''}` },
      { label: 'Method', value: o => esc(o.method || '—') },
      { label: 'Buyer', value: o => esc(o.buyerEmail || '—') },
      { label: 'Seller', value: o => esc(o.sellerEmail || '—') },
      { label: 'Date', value: o => `<span class="muted">${o.createdAt ? new Date(o.createdAt).toLocaleString() : '—'}</span>${o.disputeReason ? `<br><span class="badge warn" title="${esc(o.disputeReason)}">dispute</span>` : ''}` },
    ],
  });
}

async function renderPayments(ctx) {
  const { root, api } = ctx;
  const { payments } = await api('/api/admin/payments');
  root.innerHTML = `
    <section class="panel">
      <h2>Payment records</h2>
      <div id="payTbl"></div>
    </section>`;
  mountPaymentsTable($('#payTbl'), payments, ctx, { pageSize: 15 });
}

async function renderListings(ctx) {
  const { root, api, table, fmt, esc, ui, toast } = ctx;
  const { listings } = await api('/api/admin/listings');

  root.innerHTML = `
    <section class="panel">
      <h2>All listings</h2>
      <div id="listTbl"></div>
    </section>`;

  const holder = $('#listTbl');
  table(holder, {
    key: l => l.id,
    rows: listings,
    pageSize: 10,
    searchText: l => `${l.title} ${l.id} ${l.sellerName} ${l.sellerEmail}`,
    filters: [
      { id: 'all', label: 'All', match: () => true },
      { id: 'active', label: 'Active', match: l => l.status === 'active' },
      { id: 'paused', label: 'Paused', match: l => l.status === 'paused' },
      { id: 'draft', label: 'Draft', match: l => l.status === 'draft' },
    ],
    emptyText: 'No listings',
    columns: [
      { label: 'Listing', value: l => `<b>${esc(l.title)}</b><br><span class="muted">${esc(l.id)}</span>` },
      { label: 'Seller', value: l => `${esc(l.sellerName)}<br><span class="muted">${esc(l.sellerEmail)}</span>` },
      { label: 'Price', value: l => `<span class="mono">${fmt(l.price)}</span>` },
      { label: 'Status', value: l => `${ui.statusBadge(l.status)}${l.sellerVerified ? '' : ' <span class="badge warn">unverified seller</span>'}` },
    ],
    rowActions: l => {
      let btns = '';
      if (l.status === 'active') btns += `<button class="btn btn-ghost btn-sm" data-act="pause" data-id="${esc(l.id)}">Pause</button>`;
      if (l.status !== 'active' && l.sellerVerified) btns += `<button class="btn btn-sec btn-sm" data-act="activate" data-id="${esc(l.id)}">Activate</button>`;
      if (l.status !== 'removed') btns += `<button class="btn btn-ghost btn-sm" data-act="remove" data-id="${esc(l.id)}">Remove</button>`;
      return btns;
    },
  });

  holder.addEventListener('action', async e => {
    const { type, id } = e.detail;
    try {
      if (type === 'remove') {
        const ok = await ui.dialog({ title: 'Remove listing', body: 'Remove this listing from the marketplace? It will no longer be visible to buyers.', confirmText: 'Remove', danger: true });
        if (!ok) return;
      }
      const status = type === 'pause' ? 'paused' : type === 'activate' ? 'active' : 'removed';
      await api('/api/admin/listings/' + id + '/status', { method: 'PUT', body: { status } });
      toast(type === 'pause' ? 'Listing paused' : type === 'activate' ? 'Listing activated' : 'Listing removed', 'ok');
      ctx.showTab('listings');
    } catch (err) { toast(err.message, 'info'); }
  });
}

async function renderDisputes(ctx) {
  const { root, api, table, fmt, esc, ui, toast } = ctx;
  const { disputes } = await api('/api/admin/disputes');

  root.innerHTML = `
    ${disputes.length ? ui.banner(`${disputes.length} open dispute(s) awaiting arbitration`) : ''}
    <section class="panel" style="margin-top:${disputes.length ? '0' : '14px'}">
      <h2>Dispute arbitration</h2>
      <p class="seller-hint">Escrows frozen by a buyer dispute. <b>Release</b> pays the seller (normal fees apply); <b>Refund</b> returns the full amount to the buyer's wallet.</p>
      <div id="dspTbl"></div>
    </section>`;

  const holder = $('#dspTbl');
  table(holder, {
    key: d => d.dealId,
    rows: disputes,
    pageSize: 10,
    searchText: d => `${d.dealId} ${d.title || ''} ${d.buyerEmail || ''} ${d.sellerEmail || ''} ${d.reason || ''}`,
    filters: [{ id: 'all', label: 'Open', match: () => true }],
    emptyText: 'No open disputes — nice.',
    columns: [
      { label: 'Deal', value: d => `<b>${esc(d.title || '—')}</b><br><span class="mono muted">${esc(d.dealId)}</span>` },
      { label: 'Amount', value: d => `<span class="mono">${fmt(d.amount)} USDT</span>` },
      { label: 'Buyer', value: d => esc(d.buyerEmail || '—') },
      { label: 'Seller', value: d => esc(d.sellerEmail || '—') },
      { label: 'Dispute reason', value: d => `<span>${esc(d.reason || '—')}</span>${d.proof ? `<br><span class="muted">Seller proof: ${esc(d.proof)}</span>` : ''}` },
      { label: 'Opened', value: d => `<span class="muted">${d.disputedAt ? new Date(d.disputedAt).toLocaleString() : '—'}</span>` },
    ],
    rowActions: d =>
      `<button class="btn btn-pri btn-sm" data-act="release" data-id="${esc(d.dealId)}">Release to seller</button>
       <button class="btn btn-ghost btn-sm" data-act="refund" data-id="${esc(d.dealId)}">Refund buyer</button>`,
  });

  holder.addEventListener('action', async e => {
    const { type, id } = e.detail;
    try {
      if (type === 'release') {
        const ok = await ui.dialog({
          title: 'Release to seller',
          body: `Pay the escrow for deal <b class="mono">${esc(id)}</b> to the seller? Platform fees apply and the seller is paid.`,
          confirmText: 'Release funds',
        });
        if (!ok) return;
        const res = await api('/api/admin/disputes/' + encodeURIComponent(id) + '/resolve', { method: 'POST', body: { resolution: 'release' } });
        toast(res.duplicate ? 'Already resolved' : `Released to seller · net ${fmt(res.net)} USDT · fee ${fmt(res.fee)} USDT`, 'ok');
      } else if (type === 'refund') {
        const ok = await ui.dialog({
          title: 'Refund buyer',
          body: `Refund the full amount for deal <b class="mono">${esc(id)}</b> to the buyer's wallet? The seller receives nothing.`,
          confirmText: 'Refund buyer',
          danger: true,
        });
        if (!ok) return;
        const res = await api('/api/admin/disputes/' + encodeURIComponent(id) + '/resolve', { method: 'POST', body: { resolution: 'refund' } });
        toast(res.duplicate ? 'Already resolved' : `Refunded ${fmt(res.amount)} USDT to the buyer`, 'ok');
      }
      ctx.showTab('disputes');
    } catch (err) { toast(err.message, 'info'); }
  });
}

/* ------------------------------- shared bits ------------------------------- */

function mountPaymentsTable(holder, list, ctx, { pageSize = 10 } = {}) {
  const { table, fmt, esc, ui } = ctx;
  if (!list?.length) {
    holder.innerHTML = ctx.ui.empty('No payments yet');
    return;
  }
  table(holder, {
    key: p => p.orderId,
    rows: list,
    pageSize,
    searchText: p => `${p.orderId} ${p.buyerEmail || ''} ${p.status || ''} ${p.provider || ''}`,
    filters: [
      { id: 'all', label: 'All', match: () => true },
      { id: 'paid', label: 'Paid', match: p => p.status === 'paid' },
      { id: 'pending', label: 'Pending', match: p => p.status !== 'paid' },
    ],
    emptyText: 'No payments',
    columns: [
      { label: 'Order', value: p => `<span class="mono">${esc(p.orderId)}</span>` },
      { label: 'Amount', value: p => `<span class="mono">${fmt(p.amount)}</span>` },
      { label: 'Status', value: p => ui.statusBadge(p.status) },
      { label: 'Provider', value: p => esc(p.provider || '—') },
      { label: 'Platform fee', value: p => `<span class="mono">${p.platformFee != null ? fmt(p.platformFee) : '—'}</span>` },
      { label: 'Seller net', value: p => `<span class="mono">${p.sellerNet != null ? fmt(p.sellerNet) : '—'}</span>` },
      { label: 'Buyer', value: p => esc(p.buyerEmail || '—') },
      { label: 'Date', value: p => `<span class="muted">${p.createdAt ? new Date(p.createdAt).toLocaleString() : '—'}</span>` },
    ],
  });
}
