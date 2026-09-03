/* Seller portal — /seller/
 * Built entirely on PanelCommon: one tab registry, one render dispatcher,
 * shared skeletons / tables / toasts. Local state lives in ctx.state.
 */
PanelCommon.boot({
  role: 'seller',
  tabs: [
    ['overview', 'Overview'],
    ['listings', 'Listings'],
    ['orders', 'Orders'],
    ['messages', 'Messages'],
    ['balance', 'Balance'],
    ['withdraw', 'Withdraw'],
    ['settings', 'Settings'],
  ],

  async render(tab, ctx) {
    const { root, ui, api, toast } = ctx;
    const S = ctx.state;

    await ui.into(root, tab === 'listings' ? 'cards' : tab === 'overview' ? 'stats' : 'table', async () => {
      const dash = await api('/api/seller/dashboard');
      S.profile = dash.profile;
      S.stats = dash.stats;
      if (window.AUTH) {
        window.AUTH.isSeller = true;
        window.AUTH.seller = S.profile;
        try { localStorage.setItem('dk_user_seller', JSON.stringify(window.AUTH)); } catch (e) {}
      }
      $('#sellerStatus').textContent = S.profile?.verified
        ? 'Verified seller · manage listings, orders & payouts'
        : 'Pending verification · save drafts, publish after approval';

      if (tab === 'overview') renderOverview(ctx);
      else if (tab === 'listings') await renderListings(ctx);
      else if (tab === 'orders') await renderOrders(ctx);
      else if (tab === 'messages') await renderMessages(ctx);
      else if (tab === 'balance') renderBalance(ctx);
      else if (tab === 'withdraw') await renderWithdraw(ctx);
      else if (tab === 'settings') renderSettings(ctx);
    });

    if (root.querySelector('[data-retry]')) {
      root.querySelector('[data-retry]').addEventListener('click', () => ctx.showTab(tab));
    }
  },
});

/* ------------------------------- tabs ------------------------------- */

function renderOverview(ctx) {
  const { root, ui, fmt } = ctx;
  const p = ctx.state.profile || {};
  const st = ctx.state.stats || {};
  root.innerHTML = `
    ${!p.verified ? ui.banner('⏳ Your seller account is pending verification. Save drafts now — listings go live after admin approval.') : ''}
    ${ui.stats([
      { k: 'Available', v: fmt(p.balance) + ' USDT', mono: true },
      { k: 'In escrow', v: fmt(p.pendingEscrow) + ' USDT', mono: true },
      { k: 'Total earned', v: fmt(p.totalEarnings) + ' USDT', mono: true },
      { k: 'Completed sales', v: p.deals || 0 },
      { k: 'Active listings', v: st.activeListings || 0 },
      { k: 'Draft listings', v: st.draftListings || 0 },
      { k: 'Pending withdrawals', v: st.pendingWithdrawals || 0 },
      { k: 'Status', v: p.verified ? '✓ Verified' : '⏳ Pending' },
    ])}
    <section class="panel" style="margin-top:16px">
      <h2>Quick actions</h2>
      <div class="seller-actions">
        <button class="btn btn-pri" data-goto="listings" data-open-form="1">+ New listing</button>
        <button class="btn btn-sec" data-goto="orders">View orders</button>
        <button class="btn btn-sec" data-goto="withdraw">Withdraw balance</button>
      </div>
    </section>
    <section class="panel" style="margin-top:16px">
      <h2>Recent ledger</h2>
      ${ledgerHtml(p.ledger, ctx)}
    </section>`;
  bindGoto(ctx);
}

async function renderListings(ctx) {
  const { root, api, ui, fmt, esc, toast, CATS } = ctx;
  const p = ctx.state.profile || {};
  const verified = !!p.verified;
  const { listings } = await api('/api/seller/listings');

  root.innerHTML = `
    <div class="seller-head-row">
      <p class="seller-hint">${verified ? 'Manage your products on the marketplace.' : 'Save drafts while verification is pending.'}</p>
      <button class="btn btn-pri" id="sellerNewBtn">+ New listing</button>
    </div>
    ${listings.length ? `<div class="seller-listings">${listings.map(l => `
      <div class="seller-listing" data-lid="${esc(l.id)}">
        ${l.image ? `<div class="sl-thumb"><img src="${esc(l.image)}" alt="${esc(l.title)}" loading="lazy"></div>` : ''}
        <div class="sl-top"><span class="pill ${l.status === 'active' ? 'escrow' : 'wait'}">${esc(l.status)}</span><span class="mono">${fmt(l.price)} USDT</span></div>
        <b>${esc(l.title)}</b>
        <span class="mt">${esc(CATS.find(c => c.id === l.cat)?.label || l.cat)}</span>
        <div class="sl-act">
          <button class="btn btn-sec" data-edit="${esc(l.id)}">Edit</button>
          <button class="btn btn-sec" data-stock="${esc(l.id)}">Stock</button>
          ${l.status === 'active' ? `<button class="btn btn-ghost" data-pause="${esc(l.id)}">Pause</button>` : ''}
          ${l.status !== 'active' ? `<button class="btn btn-sec" data-publish="${esc(l.id)}" ${verified ? '' : 'disabled title="Verify account first"'}>Publish</button>` : ''}
          <button class="btn btn-ghost" data-delete="${esc(l.id)}">Remove</button>
        </div>
      </div>`).join('')}</div>`
      : ui.empty('No listings yet', 'Create your first product listing.')}
    <div id="listingFormWrap" hidden></div>`;

  $('#sellerNewBtn')?.addEventListener('click', () => showListingForm(ctx, listings));
  root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () =>
    showListingForm(ctx, listings, listings.find(x => x.id === b.dataset.edit))));

  const mutate = async (id, fn, msg) => {
    try {
      await fn(id);
      toast(msg, 'ok');
      ctx.showTab('listings');
    } catch (e) { toast(e.message, 'info'); }
  };
  root.querySelectorAll('[data-pause]').forEach(b => b.addEventListener('click', () =>
    mutate(b.dataset.pause, id => api('/api/seller/listings/' + id, { method: 'PUT', body: { status: 'paused' } }), 'Listing paused')));
  root.querySelectorAll('[data-publish]').forEach(b => b.addEventListener('click', () =>
    mutate(b.dataset.publish, id => api('/api/seller/listings/' + id, { method: 'PUT', body: { status: 'active' } }), 'Listing published')));
  root.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', async () => {
    const ok = await ui.dialog({ title: 'Remove listing', body: 'Remove this listing from the marketplace? It will no longer be visible to buyers.', confirmText: 'Remove', danger: true });
    if (!ok) return;
    mutate(b.dataset.delete, id => api('/api/seller/listings/' + id, { method: 'DELETE' }), 'Listing removed');
  }));
  root.querySelectorAll('[data-stock]').forEach(b => b.addEventListener('click', () =>
    showStockForm(ctx, listings.find(x => x.id === b.dataset.stock))));

  if (ctx.state.openListingForm) {
    ctx.state.openListingForm = false;
    showListingForm(ctx, listings);
  }
}

/* ------------------------------- messages ------------------------------- */

async function renderMessages(ctx) {
  const { root, api, ui, esc, toast } = ctx;
  const S = ctx.state;
  if (S.msgPoll) { clearInterval(S.msgPoll); S.msgPoll = null; }

  let convs = [];
  try {
    const d = await api('/api/conversations');
    convs = d.conversations || [];
  } catch (e) {
    root.innerHTML = ui.empty('Could not load messages', e.message);
    return;
  }

  if (!convs.length) {
    root.innerHTML = `
      <p class="seller-hint">Buyer messages about your listings and deals appear here.</p>
      ${ui.empty('No conversations yet', 'When a buyer messages you from a listing, it shows up here.')}`;
    return;
  }

  if (!S.activeConv || !convs.find(c => c.id === S.activeConv)) S.activeConv = convs[0].id;

  root.innerHTML = `
    <p class="seller-hint">Reply to buyers — everything stays on the record for escrow.</p>
    <div class="msg-layout">
      <aside class="msg-list" id="msgList">${convs.map(c => `
        <button class="msg-item ${c.id === S.activeConv ? 'on' : ''}" data-conv="${esc(c.id)}">
          <span class="msg-item-top"><b>${esc(c.who)}</b>${c.unread ? `<span class="msg-badge">${c.unread}</span>` : ''}</span>
          <span class="msg-item-title">${esc(c.title || c.role || 'Conversation')}</span>
          <span class="msg-item-prev">${esc(c.lastPreview || 'No messages yet')}</span>
        </button>`).join('')}
      </aside>
      <section class="msg-thread panel" id="msgThread"></section>
    </div>`;

  root.querySelectorAll('[data-conv]').forEach(b => b.addEventListener('click', () => {
    S.activeConv = b.dataset.conv;
    root.querySelectorAll('.msg-item').forEach(x => x.classList.toggle('on', x === b));
    loadSellerThread(ctx);
  }));

  await loadSellerThread(ctx);

  S.msgPoll = setInterval(() => {
    // Stop on sign-out (dead token would spam 401s forever) or tab change.
    if (typeof hasApiSession === 'function' && !hasApiSession()) { clearInterval(S.msgPoll); S.msgPoll = null; return; }
    if (ctx.currentTab && ctx.currentTab() !== 'messages') { clearInterval(S.msgPoll); S.msgPoll = null; return; }
    loadSellerThread(ctx, true);
  }, 8000);
}

async function loadSellerThread(ctx, silent) {
  const { api, esc, toast } = ctx;
  const S = ctx.state;
  const box = document.getElementById('msgThread');
  if (!box || !S.activeConv) return;

  S.threadMsgs = S.threadMsgs || {};
  const prev = S.threadMsgs[S.activeConv] || [];
  const since = silent && prev.length ? prev[prev.length - 1].at : null;
  const url = '/api/conversations/' + encodeURIComponent(S.activeConv) + '/messages'
    + (since ? '?since=' + encodeURIComponent(since) : '');

  let msgs;
  let newBatch = [];
  try {
    const d = await api(url);
    newBatch = d.messages || [];
    if (since) {
      msgs = newBatch.length ? prev.concat(newBatch) : prev;
    } else {
      msgs = newBatch;
    }
    S.threadMsgs[S.activeConv] = msgs;
    if (!silent) {
      api('/api/conversations/' + encodeURIComponent(S.activeConv) + '/read', { method: 'POST' }).catch(() => {});
    }
  } catch (e) {
    if (!silent) box.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    return;
  }

  const scrollEl = document.getElementById('msgScroll');
  const nearBottom = scrollEl
    ? scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 80
    : true;
  const draft = silent ? (document.getElementById('msgInput')?.value || '') : '';

  if (!scrollEl) {
    box.innerHTML = `
    <div class="msg-scroll" id="msgScroll">
      ${msgs.length ? msgs.map(m => m.sys != null
        ? `<div class="msg-sys">${esc(m.sys)}</div>`
        : `<div class="msg-bubble ${m.from === 'me' ? 'me' : 'them'}">${m.image ? `<img src="${esc(m.image)}" alt="" loading="lazy">` : ''}${m.text ? `<span>${esc(m.text)}</span>` : ''}<em>${esc(m.t || '')}</em></div>`).join('')
        : '<div class="empty">No messages yet — say hello.</div>'}
    </div>
    <form class="msg-compose" id="msgForm">
      <input class="input" id="msgInput" type="text" maxlength="2000" placeholder="Type a reply…" autocomplete="off">
      <button class="btn btn-pri" type="submit">Send</button>
    </form>`;

    document.getElementById('msgForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      const input = document.getElementById('msgInput');
      const text = (input.value || '').trim();
      if (!text) return;
      input.value = '';
      try {
        await api('/api/conversations/' + encodeURIComponent(S.activeConv) + '/messages', { method: 'POST', body: { text } });
        delete S.threadMsgs[S.activeConv];
        await loadSellerThread(ctx);
      } catch (err) {
        input.value = text;
        toast(err.message, 'info');
      }
    });
  } else if (since && newBatch.length) {
    for (const m of newBatch) {
      scrollEl.insertAdjacentHTML('beforeend', m.sys != null
        ? `<div class="msg-sys">${esc(m.sys)}</div>`
        : `<div class="msg-bubble ${m.from === 'me' ? 'me' : 'them'}">${m.image ? `<img src="${esc(m.image)}" alt="" loading="lazy">` : ''}${m.text ? `<span>${esc(m.text)}</span>` : ''}<em>${esc(m.t || '')}</em></div>`);
    }
  } else if (!since) {
    scrollEl.innerHTML = msgs.length ? msgs.map(m => m.sys != null
      ? `<div class="msg-sys">${esc(m.sys)}</div>`
      : `<div class="msg-bubble ${m.from === 'me' ? 'me' : 'them'}">${m.image ? `<img src="${esc(m.image)}" alt="" loading="lazy">` : ''}${m.text ? `<span>${esc(m.text)}</span>` : ''}<em>${esc(m.t || '')}</em></div>`).join('')
      : '<div class="empty">No messages yet — say hello.</div>';
  }

  const scroll = document.getElementById('msgScroll');
  if (scroll && (!silent || nearBottom)) scroll.scrollTop = scroll.scrollHeight;
  const input = document.getElementById('msgInput');
  if (input && draft) input.value = draft;
}

function showListingForm(ctx, listings, existing) {
  const { esc, toast, api, CATS } = ctx;
  const wrap = $('#listingFormWrap');
  if (!wrap) return;
  wrap.hidden = false;
  const verified = !!ctx.state.profile?.verified;
  const cats = CATS.filter(c => c.id !== 'all');
  let pendingImageDataUrl = null;
  let currentImageUrl = existing?.image || null;
  let removedImage = false;

  // Multiple price options on one listing (e.g. a single "Apple Gift Card"
  // listing the buyer picks $10/$50/$100 on), instead of one listing per
  // amount. Each row keeps its server id (when editing) so its stock stays
  // attached across an edit that doesn't touch that row.
  let useVariants = !!existing?.variants?.length;
  let variantRows = existing?.variants?.length
    ? existing.variants.map(v => ({ id: v.id, label: v.label, price: v.price }))
    : [{ id: null, label: '', price: '' }];

  function renderVariantRows() {
    const box = $('#lfVariantRows');
    if (!box) return;
    box.innerHTML = variantRows.map((v, i) => `
      <div class="sf-row lf-variant-row" data-vi="${i}">
        <input type="text" class="lf-vi-label" placeholder="e.g. $10" maxlength="60" value="${esc(v.label)}" style="flex:2">
        <input type="number" class="lf-vi-price" placeholder="Price (USDT)" min="0.01" step="0.01" value="${v.price === '' ? '' : v.price}" style="flex:1">
        <button type="button" class="btn btn-ghost btn-sm lf-vi-remove" ${variantRows.length <= 1 ? 'disabled' : ''} aria-label="Remove option">✕</button>
      </div>`).join('');
    box.querySelectorAll('.lf-variant-row').forEach(row => {
      const i = Number(row.dataset.vi);
      row.querySelector('.lf-vi-label').addEventListener('input', e => { variantRows[i].label = e.target.value; });
      row.querySelector('.lf-vi-price').addEventListener('input', e => { variantRows[i].price = e.target.value; });
      row.querySelector('.lf-vi-remove').addEventListener('click', () => {
        if (variantRows.length <= 1) return;
        variantRows.splice(i, 1);
        renderVariantRows();
      });
    });
  }

  function renderVariantSection() {
    const box = $('#lfVariantSection');
    const priceField = $('#lfPriceField');
    if (!box || !priceField) return;
    box.hidden = !useVariants;
    priceField.hidden = useVariants;
    if (useVariants) renderVariantRows();
  }

  function previewSrc() {
    if (removedImage) return null;
    if (pendingImageDataUrl) return pendingImageDataUrl;
    return currentImageUrl;
  }

  function renderPreview() {
    const src = previewSrc();
    const box = $('#lfPreview');
    if (!box) return;
    box.innerHTML = src
      ? `<img src="${src.startsWith('data:') ? src : esc(src)}" alt="Product preview"><button type="button" class="btn btn-ghost btn-sm lf-rm-img" id="lfRemoveImg">Remove</button>`
      : `<span class="lf-upload-ph">No image — category icon shown on marketplace</span>`;
    $('#lfRemoveImg')?.addEventListener('click', () => {
      pendingImageDataUrl = null;
      removedImage = true;
      renderPreview();
    });
  }

  wrap.innerHTML = `
    <section class="panel seller-form" style="margin-top:16px">
      <h2>${existing ? 'Edit listing' : 'New listing'}</h2>
      <label class="sf"><span>Product image</span>
        <div class="listing-upload">
          <div class="listing-upload-preview" id="lfPreview"></div>
          <input id="lfImage" type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden>
          <div class="listing-upload-actions">
            <button type="button" class="btn btn-sec" id="lfPickImg">Choose image</button>
            <span class="muted lf-upload-hint">JPEG, PNG, WebP or GIF · max 4 MB · auto-fitted on marketplace</span>
          </div>
        </div>
      </label>
      <label class="sf"><span>Category</span>
        <select id="lfCat">${cats.map(c => `<option value="${c.id}" ${existing?.cat === c.id ? 'selected' : ''}>${c.label}</option>`).join('')}</select>
      </label>
      <label class="sf"><span>Title</span><input id="lfTitle" value="${existing ? esc(existing.title) : ''}" maxlength="200"></label>
      <label class="sf"><span>Description</span><textarea id="lfDesc" rows="4">${existing ? esc(existing.desc) : ''}</textarea></label>
      <label class="sf" id="lfPriceField"><span>Price (USDT)</span><input id="lfPrice" type="number" min="1" step="0.01" value="${existing ? existing.price : ''}"></label>
      <label class="sf-check">
        <input type="checkbox" id="lfUseVariants" ${useVariants ? 'checked' : ''}>
        <span>Sell multiple price options on this listing (e.g. $10 / $50 / $100 gift cards) — the buyer picks one before checkout</span>
      </label>
      <div id="lfVariantSection" ${useVariants ? '' : 'hidden'}>
        <div id="lfVariantRows"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="lfVariantAdd" style="margin-top:6px">+ Add price option</button>
      </div>
      <div class="sf-row">
        <button class="btn btn-ghost" id="lfCancel">Cancel</button>
        <button class="btn btn-sec" id="lfDraft">Save draft</button>
        <button class="btn btn-pri" id="lfPublish" ${verified ? '' : 'disabled title="Verify account first"'}>Publish</button>
      </div>
    </section>`;

  renderPreview();
  renderVariantSection();
  $('#lfUseVariants').addEventListener('change', e => {
    useVariants = e.target.checked;
    renderVariantSection();
  });
  $('#lfVariantAdd').addEventListener('click', () => {
    variantRows.push({ id: null, label: '', price: '' });
    renderVariantRows();
  });
  $('#lfPickImg').addEventListener('click', () => $('#lfImage').click());
  $('#lfImage').addEventListener('change', () => {
    const file = $('#lfImage').files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { toast('Image too large — max 4 MB', 'info'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      pendingImageDataUrl = reader.result;
      removedImage = false;
      renderPreview();
    };
    reader.onerror = () => toast('Could not read image', 'info');
    reader.readAsDataURL(file);
  });

  $('#lfCancel').addEventListener('click', () => { wrap.hidden = true; wrap.innerHTML = ''; });
  const save = async status => {
    const body = {
      cat: $('#lfCat').value,
      title: $('#lfTitle').value.trim(),
      desc: $('#lfDesc').value.trim(),
      status,
    };
    if (useVariants) {
      const cleaned = variantRows
        .map(v => ({ id: v.id, label: String(v.label || '').trim(), price: parseFloat(v.price) }))
        .filter(v => v.label && Number.isFinite(v.price) && v.price > 0);
      if (!cleaned.length) { toast('Add at least one price option with a label and price', 'info'); return; }
      body.variants = cleaned;
    } else {
      body.price = parseFloat($('#lfPrice').value);
      body.variants = [];
    }
    if (pendingImageDataUrl) body.imageData = pendingImageDataUrl;
    else if (removedImage) body.image = null;
    else if (currentImageUrl) body.image = currentImageUrl;
    try {
      if (existing) await api('/api/seller/listings/' + existing.id, { method: 'PUT', body });
      else await api('/api/seller/listings', { method: 'POST', body });
      toast(status === 'active' ? 'Listing published' : 'Draft saved', 'ok');
      ctx.showTab('listings');
    } catch (e) { toast(e.message, 'info'); }
  };
  $('#lfDraft').addEventListener('click', () => save('draft'));
  $('#lfPublish').addEventListener('click', () => save('active'));
  wrap.scrollIntoView({ behavior: 'smooth' });
}

/* Credential stock: paste one account/subscription credential per line. The
 * server encrypts them and delivers one automatically when a buyer pays.
 * Submitted secrets are never shown back here. */
function showStockForm(ctx, listing) {
  const { esc, toast, api } = ctx;
  const wrap = $('#listingFormWrap');
  if (!wrap || !listing) return;
  wrap.hidden = false;
  const variants = listing.variants || [];
  const hasVariants = variants.length > 0;

  // Each price option (e.g. a gift-card denomination) has its own separate
  // stock pool, so the seller must say which one a pasted batch is for.
  const variantPicker = hasVariants ? `
      <label class="sf"><span>Price option</span>
        <select id="stockVariant">${variants.map(v => `<option value="${esc(v.id)}">${esc(v.label)}</option>`).join('')}</select>
      </label>` : '';
  const countBlock = hasVariants
    ? `<div id="stockCounts" class="seller-hint">…</div>`
    : `<p class="seller-hint"><b id="stockCount">…</b> in stock.</p>`;

  wrap.innerHTML = `
    <section class="panel seller-form" style="margin-top:16px">
      <h2>Stock — ${esc(listing.title)}</h2>
      ${countBlock}
      <p class="seller-hint">Add account/subscription credentials below — one per line. Each is
        encrypted and auto-delivered to a buyer the moment their payment confirms. Once added, a
        credential is never shown back here.</p>
      ${variantPicker}
      <label class="sf"><span>Credentials (one per line)</span>
        <textarea id="stockText" rows="8" placeholder="user@example.com:password123&#10;license-key-XXXX-YYYY" autocomplete="off" spellcheck="false"></textarea>
      </label>
      <div class="sf-row">
        <button class="btn btn-ghost" id="stockCancel">Close</button>
        <button class="btn btn-pri" id="stockAdd">Add to stock</button>
      </div>
    </section>`;

  const refreshCount = async () => {
    try {
      const d = await api('/api/seller/listings/' + listing.id + '/stock-count');
      if (hasVariants) {
        const rows = (d.variants || []).map(v => `<div>${esc(v.label)}: <b>${v.available}</b> in stock</div>`).join('');
        $('#stockCounts').innerHTML = rows || 'No price options.';
      } else {
        $('#stockCount').textContent = d.available;
      }
    } catch (e) {
      if (hasVariants) { if ($('#stockCounts')) $('#stockCounts').textContent = '?'; }
      else if ($('#stockCount')) $('#stockCount').textContent = '?';
    }
  };
  refreshCount();

  $('#stockCancel').addEventListener('click', () => { wrap.hidden = true; wrap.innerHTML = ''; });
  $('#stockAdd').addEventListener('click', async () => {
    const text = $('#stockText').value.trim();
    if (!text) { toast('Paste at least one credential', 'info'); return; }
    const body = { text };
    if (hasVariants) body.variantId = $('#stockVariant').value;
    try {
      const d = await api('/api/seller/listings/' + listing.id + '/stock', { method: 'POST', body });
      toast(`Added ${d.added}${hasVariants ? '' : ` — ${d.available} in stock`}`, 'ok');
      $('#stockText').value = '';
      refreshCount();
    } catch (e) { toast(e.message, 'info'); }
  });
  wrap.scrollIntoView({ behavior: 'smooth' });
}

async function renderOrders(ctx) {
  const { root, api, table, fmt, esc, ui, toast } = ctx;
  const [{ orders }, escrowRes] = await Promise.all([
    api('/api/seller/orders'),
    api('/api/seller/escrows').catch(() => ({ escrows: [] })),
  ]);
  const escrowByDeal = {};
  for (const e of (escrowRes.escrows || [])) escrowByDeal[e.dealId] = e;

  const holder = document.createElement('div');
  root.innerHTML = `
    <section class="panel">
      <h2>Sales & payments</h2>
      <p class="seller-hint">Paid orders from buyers. Mark an order delivered once you've fulfilled it — the buyer then confirms to release funds. Funds move to your balance after delivery is confirmed.</p>
    </section>`;
  root.querySelector('.panel').appendChild(holder);

  const actionCell = o => {
    const e = escrowByDeal[o.orderId];
    if (!e) return '<span class="muted">—</span>';
    if (e.status === 'held') {
      return `<button class="btn btn-pri btn-sm" data-deliver="${esc(o.orderId)}">Mark delivered</button>`;
    }
    if (e.status === 'delivered') {
      return `<span class="muted" title="${esc(e.deliveryProof || '')}">Delivered ${e.deliveredAt ? new Date(e.deliveredAt).toLocaleDateString() : ''} · awaiting buyer</span>`;
    }
    if (e.status === 'dispute') {
      return `<span class="badge warn" title="${esc(e.disputeReason || '')}">In dispute</span>`;
    }
    if (e.status === 'released') return '<span class="muted">Released</span>';
    if (e.status === 'refunded') return '<span class="muted">Refunded</span>';
    return `<span class="muted">${esc(e.status)}</span>`;
  };

  table(holder, {
    key: o => o.orderId,
    rows: orders,
    pageSize: 10,
    searchText: o => `${o.orderId} ${o.title || ''} ${o.buyerEmail || ''} ${o.status || ''}`,
    filters: [
      { id: 'all', label: 'All' },
      { id: 'paid', label: 'Paid', match: o => o.status === 'paid' },
      { id: 'pending', label: 'Pending', match: o => o.status !== 'paid' },
    ],
    emptyText: 'No orders yet — sales appear here after buyers pay.',
    columns: [
      { label: 'Deal', value: o => `<span class="mono">${esc(o.orderId)}</span>` },
      { label: 'Item', value: o => esc(o.title || '—') },
      { label: 'Amount', value: o => `<span class="mono">${fmt(o.amount)}</span>` },
      { label: 'Status', value: o => ui.statusBadge(o.status) },
      { label: 'Method', value: o => esc(o.methodLabel || o.payNetwork || o.method || '—') },
      { label: 'Delivery', value: actionCell },
      { label: 'Date', value: o => `<span class="muted">${o.paidAt ? new Date(o.paidAt).toLocaleString() : new Date(o.createdAt).toLocaleString()}</span>` },
    ],
  });

  holder.addEventListener('click', async ev => {
    const btn = ev.target.closest('[data-deliver]');
    if (!btn) return;
    const dealId = btn.dataset.deliver;
    const proof = await ui.dialog({
      title: 'Mark delivered',
      body: `Add delivery proof for order <b class="mono">${esc(dealId)}</b>. The buyer and the arbiter can review it.`,
      input: 'textarea',
      placeholder: 'Tracking link, screenshot URL, download link, note…',
      confirmText: 'Mark delivered',
    });
    if (proof === null) return;
    btn.disabled = true;
    try {
      await api('/api/seller/deliver', { method: 'POST', body: { dealId, proof } });
      toast('Marked as delivered — the buyer can now confirm to release funds', 'ok');
      ctx.showTab('orders');
    } catch (e) {
      toast(e.message, 'info');
      btn.disabled = false;
    }
  });
}

function renderBalance(ctx) {
  const { root, fmt } = ctx;
  const p = ctx.state.profile || {};
  root.innerHTML = `
    <div class="walt-card" style="margin-bottom:16px">
      <div class="walt-lbl">Seller balance</div>
      <div class="walt-amt mono"><span>${fmt(p.balance)}</span><span class="walt-cur">USDT</span></div>
      <div class="walt-sub mono">${fmt(p.pendingEscrow)} USDT pending in escrow</div>
      <div class="walt-btns" style="margin-top:14px">
        <button class="btn btn-pri" data-goto="withdraw">Withdraw</button>
      </div>
    </div>
    <section class="panel"><h2>Ledger</h2>${ledgerHtml(p.ledger, ctx)}</section>`;
  bindGoto(ctx);
}

async function renderWithdraw(ctx) {
  const { root, api, fmt, esc, toast } = ctx;
  const p = ctx.state.profile || {};
  const { withdrawals } = await api('/api/seller/withdrawals');
  root.innerHTML = `
    <section class="panel seller-form">
      <h2>Withdraw to USDT (TRC-20)</h2>
      <p class="seller-hint">Available: <b class="mono">${fmt(p.balance)} USDT</b> · Minimum 10 USDT · Processed within 2 hours</p>
      <label class="sf"><span>Wallet address</span>
        <input id="wdAddr" placeholder="TXyz…" value="${esc(p.withdrawAddress || '')}">
      </label>
      <label class="sf"><span>Amount (USDT)</span>
        <input id="wdAmt" type="number" min="10" step="0.01" placeholder="100.00">
      </label>
      <div class="seller-actions">
        <button class="btn btn-pri" id="wdSubmit">Request withdrawal</button>
        <button class="btn btn-ghost" id="wdMax" type="button">Withdraw all</button>
      </div>
    </section>
    <section class="panel" style="margin-top:16px">
      <h2>Withdrawal history</h2>
      ${withdrawals.length ? withdrawals.map(w => `
        <div class="tx">
          <span class="tx-ico">↗</span>
          <span><span class="lbl">Withdrawal · ${ctx.ui.statusBadge(w.status)}</span><br><span class="t mono">${fmt(w.amount)} USDT → ${esc(String(w.address).slice(0, 16))}…</span></span>
          <span class="amt mono neg">-${fmt(w.amount)}</span>
        </div>`).join('') : ctx.ui.empty('No withdrawals yet')}
    </section>`;
  $('#wdMax')?.addEventListener('click', () => {
    const el = $('#wdAmt');
    if (el && (p.balance || 0) >= 10) el.value = p.balance;
  });
  $('#wdSubmit').addEventListener('click', async () => {
    try {
      const res = await api('/api/seller/withdrawals', {
        method: 'POST',
        body: { amount: parseFloat($('#wdAmt').value), address: $('#wdAddr').value.trim() },
      });
      ctx.state.profile = res.profile;
      toast('Withdrawal requested — admin will process within 2 hours', 'ok');
      ctx.showTab('withdraw');
    } catch (e) { toast(e.message, 'info'); }
  });
}

function renderSettings(ctx) {
  const { root, api, esc, toast } = ctx;
  const p = ctx.state.profile || {};
  root.innerHTML = `
    <section class="panel seller-form">
      <h2>Seller settings</h2>
      <label class="sf"><span>Display name</span><input value="${esc(p.name)}" disabled></label>
      <label class="sf"><span>Email</span><input value="${esc(p.email)}" disabled></label>
      <label class="sf"><span>Default withdrawal address (TRC-20)</span>
        <input id="setAddr" value="${esc(p.withdrawAddress || '')}" placeholder="TXyz…">
      </label>
      <button class="btn btn-pri" id="setSave">Save address</button>
    </section>
    <section class="panel" style="margin-top:16px">
      <h2>Account status</h2>
      <p class="seller-hint">${p.verified ? '✓ Your account is verified. Listings can be published to the marketplace.' : '⏳ Pending admin verification. You can save draft listings in the meantime.'}</p>
    </section>`;
  $('#setSave').addEventListener('click', async () => {
    try {
      const res = await api('/api/seller/withdraw-address', { method: 'PUT', body: { address: $('#setAddr').value.trim() } });
      ctx.state.profile = res.profile;
      toast('Withdrawal address saved', 'ok');
    } catch (e) { toast(e.message, 'info'); }
  });
}

/* ------------------------------- shared bits ------------------------------- */

function ledgerHtml(ledger, ctx) {
  const { esc, fmt, ui } = ctx;
  if (!ledger?.length) return ui.empty('No activity yet');
  return ledger.map(tx => `
    <div class="tx">
      <span class="tx-ico">${tx.amt >= 0 ? '↓' : '↑'}</span>
      <span><span class="lbl">${esc(tx.lbl)}</span>${tx.fee ? `<br><span class="t">Platform fee ${fmt(tx.fee)} USDT</span>` : ''}</span>
      <span class="amt mono ${tx.amt >= 0 ? 'pos' : 'neg'}">${tx.amt >= 0 ? '+' : ''}${fmt(tx.amt)}</span>
    </div>`).join('');
}

function bindGoto(ctx) {
  ctx.root.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.openForm) ctx.state.openListingForm = true;
    ctx.showTab(b.dataset.goto);
  }));
}
