function registerAdminRoutes(app, { authUser, store, sellerStore, paymentStore, withdrawalsCol, memory, listingsCol, usersCol, walletStore, inviteStore, portalAccess, stockStore, sellerProfilesCol, paymentsCol, cryptoAddressStore }) {
  function publicBase(req) {
    const configured = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
    if (configured) return configured;
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    return proto + '://' + (req.headers.host || ('localhost:' + (process.env.PORT || 3000)));
  }
  function portalBase(req) {
    return publicBase(req) + (portalAccess?.mountBase || '');
  }
  async function requireAdmin(req, res) {
    const user = await authUser(req);
    if (!user) {
      res.status(401).json({ error: 'unauthorized' });
      return null;
    }
    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@dot.market').toLowerCase();
    if (!user.isAdmin && user._id !== adminEmail) {
      res.status(403).json({ error: 'forbidden', msg: 'Admin access required' });
      return null;
    }
    return user;
  }

  app.get('/api/admin/dashboard', async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      let sellers = [];
      let listings = [];
      let withdrawals = [];
      let payments = [];
      let users = 0;

      if (memory) {
        sellers = [...memory.sellerProfiles.values()];
        listings = [...memory.listings.values()];
        withdrawals = [...memory.withdrawals.values()];
        payments = [...memory.payments.values()];
        users = memory.users.size;
      } else {
        users = await usersCol.countDocuments({});
        sellers = await sellerProfilesCol.find({}).project({ verified: 1 }).toArray();
        listings = await listingsCol.find({}).project({ status: 1 }).toArray();
        withdrawals = await withdrawalsCol.find({ status: 'pending' }).toArray();
        const [paidToday, platformFeesAgg, recentPayments] = await Promise.all([
          paymentsCol.countDocuments({ status: 'paid', paidAt: { $gte: todayStart } }),
          paymentsCol.aggregate([
            { $match: { status: 'paid' } },
            { $group: { _id: null, total: { $sum: { $ifNull: ['$platformFee', 0] } } } },
          ]).toArray(),
          paymentsCol.find({}).sort({ createdAt: -1 }).limit(10).toArray(),
        ]);
        payments = recentPayments;
        res.json({
          stats: {
            users,
            sellers: sellers.length,
            pendingSellers: sellers.filter(s => !s.verified).length,
            listings: listings.length,
            activeListings: listings.filter(l => l.status === 'active').length,
            pendingWithdrawals: withdrawals.length,
            paymentsToday: paidToday,
            platformFeesTotal: platformFeesAgg[0]?.total || 0,
          },
          recentPayments: recentPayments.map(p => ({
            orderId: p.orderId,
            amount: p.amount,
            status: p.status,
            provider: p.provider,
            buyerEmail: p.buyerEmail,
            platformFee: p.platformFee || 0,
            gatewayFee: p.gatewayFee || 0,
            sellerNet: p.sellerNet || null,
            createdAt: p.createdAt,
          })),
        });
        return;
      }

      const paidToday = payments.filter(p => {
        if (p.status !== 'paid') return false;
        const d = p.paidAt || p.createdAt;
        return d && new Date(d) >= todayStart;
      }).length;

      res.json({
        stats: {
          users,
          sellers: sellers.length,
          pendingSellers: sellers.filter(s => !s.verified).length,
          listings: listings.length,
          activeListings: listings.filter(l => l.status === 'active').length,
          pendingWithdrawals: withdrawals.filter(w => w.status === 'pending').length,
          paymentsToday: paidToday,
          platformFeesTotal: payments
            .filter(p => p.status === 'paid')
            .reduce((sum, p) => sum + (p.platformFee || 0), 0),
        },
        recentPayments: payments.slice(0, 10).map(p => ({
          orderId: p.orderId,
          amount: p.amount,
          status: p.status,
          provider: p.provider,
          buyerEmail: p.buyerEmail,
          platformFee: p.platformFee || 0,
          gatewayFee: p.gatewayFee || 0,
          sellerNet: p.sellerNet || null,
          createdAt: p.createdAt,
        })),
      });
    } catch (err) {
      console.error('admin dashboard error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  app.get('/api/admin/sellers', async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      let sellers = memory
        ? [...memory.sellerProfiles.values()]
        : await sellerProfilesCol.find({}).sort({ createdAt: -1 }).toArray();
      res.json({
        sellers: sellers.map(s => ({
          email: s._id,
          name: s.name,
          verified: !!s.verified,
          balance: s.balance || 0,
          deals: s.deals || 0,
          createdAt: s.createdAt,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: 'server' });
    }
  });

  app.post('/api/admin/sellers/:email/verify', async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      const email = decodeURIComponent(req.params.email).toLowerCase();
      const profile = await sellerStore.getSellerProfile(email);
      if (!profile) return res.status(404).json({ error: 'not found' });
      // Targeted $set — a full-document write here would revert any payout
      // credit ($inc on balance/ledger) that landed since the read above.
      const updated = await sellerStore.updateSellerProfileFields(email, {
        verified: true,
        verifiedAt: new Date(),
      }) || profile;
      const user = await store.getUser(email);
      if (user) {
        user.isSeller = true;
        await store.putUser(user);
      }
      res.json({ ok: true, profile: sellerStore.serializeSellerProfile(updated) });
    } catch (err) {
      res.status(500).json({ error: 'server' });
    }
  });

  app.post('/api/admin/sellers/:email/reject', async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      const email = decodeURIComponent(req.params.email).toLowerCase();
      const profile = await sellerStore.getSellerProfile(email);
      if (!profile) return res.status(404).json({ error: 'not found' });
      // Targeted $set, same reason as verify above.
      await sellerStore.updateSellerProfileFields(email, {
        verified: false,
        verifiedAt: null,
      });
      // Also strip the seller role from the login so a revoked seller can no
      // longer enter the seller portal.
      const user = await store.getUser(email);
      if (user) {
        user.isSeller = false;
        await store.putUser(user);
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'server' });
    }
  });

  /* ---- Invite-only seller onboarding ----
   * Admins provision sellers by generating a one-time setup link. The raw token
   * is returned ONCE here; only its hash is stored. There is no public signup. */

  /* Generate a seller invite. Returns the one-time setup link (raw token) —
   * show it to the admin once and never log it. */
  app.post('/api/admin/seller-invites', async (req, res) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (!inviteStore) return res.status(503).json({ error: 'unavailable' });
      const email = String((req.body || {}).email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return res.status(400).json({ error: 'email', msg: 'Enter a valid seller email' });
      }
      const { invite, rawToken } = await inviteStore.createInvite(email, admin._id);
      res.json({
        invite: serializeInvite(invite),
        setupLink: portalBase(req) + '/seller/?invite=' + rawToken,
      });
    } catch (err) {
      console.error('create invite error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  /* List recent invites (no tokens — hash only). */
  app.get('/api/admin/seller-invites', async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      if (!inviteStore) return res.status(503).json({ error: 'unavailable' });
      const list = await inviteStore.listRecent(100);
      res.json({ invites: list.map(serializeInvite) });
    } catch (err) {
      res.status(500).json({ error: 'server' });
    }
  });

  /* Native crypto deposit-address pool (see lib/crypto-address-store.js and
   * lib/payments/index.js's NATIVE_PROVIDERS). One entry per network the app
   * can accept payment on — whichever one matches the live PAYMENT_PROVIDER
   * is the one actually consuming claims from its pool; the others just sit
   * idle, ready to switch to. Label is shown in the admin UI dropdown. */
  const SUPPORTED_CRYPTO_NETWORKS = [
    { network: 'tron-usdt-trc20', label: 'USDT — TRON (TRC-20)' },
    { network: 'eth-usdt-erc20', label: 'USDT — Ethereum (ERC-20)' },
    { network: 'bsc-usdt-bep20', label: 'USDT — BSC (BEP-20)' },
    { network: 'sol-usdt-spl', label: 'USDT — Solana (SPL)' },
    { network: 'sol-native', label: 'SOL — Solana (native)' },
    { network: 'btc', label: 'BTC — Bitcoin' },
    { network: 'ltc', label: 'LTC — Litecoin' },
  ];
  const SUPPORTED_CRYPTO_NETWORK_IDS = SUPPORTED_CRYPTO_NETWORKS.map(n => n.network);

  app.post('/api/admin/crypto-addresses', async (req, res) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (!cryptoAddressStore) return res.status(503).json({ error: 'unavailable' });
      const network = String((req.body || {}).network || '').trim();
      if (!SUPPORTED_CRYPTO_NETWORK_IDS.includes(network)) {
        return res.status(400).json({ error: 'network', msg: 'Unsupported network: ' + network });
      }
      const addresses = (req.body || {}).addresses;
      const result = await cryptoAddressStore.addAddresses(network, addresses);
      const stats = await cryptoAddressStore.poolStats(network);
      res.json({ ...result, stats });
    } catch (err) {
      console.error('add crypto addresses error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  app.get('/api/admin/crypto-addresses', async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      if (!cryptoAddressStore) return res.status(503).json({ error: 'unavailable' });
      const stats = await Promise.all(SUPPORTED_CRYPTO_NETWORKS.map(async n => ({
        ...(await cryptoAddressStore.poolStats(n.network)),
        label: n.label,
      })));
      res.json({ networks: stats, activeProvider: require('./payments').provider() });
    } catch (err) {
      res.status(500).json({ error: 'server' });
    }
  });

  function serializeInvite(inv) {
    const now = Date.now();
    const expired = new Date(inv.expiresAt).getTime() < now;
    return {
      id: inv._id,
      email: inv.email,
      status: expired && inv.status === 'unused' ? 'expired' : inv.status,
      createdBy: inv.createdBy || null,
      createdAt: inv.createdAt,
      expiresAt: inv.expiresAt,
      usedAt: inv.usedAt || null,
    };
  }

  app.get('/api/admin/withdrawals', async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      let list = memory
        ? [...memory.withdrawals.values()]
        : await withdrawalsCol.find({}).sort({ createdAt: -1 }).limit(100).toArray();
      res.json({
        withdrawals: list.map(w => ({
          id: w._id,
          sellerEmail: w.sellerEmail,
          amount: w.amount,
          address: w.address,
          network: w.network,
          status: w.status,
          txHash: w.txHash || null,
          createdAt: w.createdAt,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: 'server' });
    }
  });

  /* Atomically transition a withdrawal out of 'pending'. The conditional
   * filter ({ _id, status: 'pending' }) makes approve/reject a single-winner
   * claim: an approve racing a reject can no longer end 'completed' with the
   * refund also credited (double payout). Returns { doc } on success,
   * { notFound } / { alreadyProcessed } otherwise. */
  async function claimWithdrawal(id, status, txHash) {
    const patch = { status, processedAt: new Date() };
    if (txHash) patch.txHash = txHash;
    if (memory) {
      const w = memory.withdrawals.get(id);
      if (!w) return { notFound: true };
      if (w.status !== 'pending') return { alreadyProcessed: true };
      Object.assign(w, patch);
      memory.withdrawals.set(id, w);
      return { doc: w };
    }
    const res = await withdrawalsCol.findOneAndUpdate(
      { _id: id, status: 'pending' },
      { $set: patch },
      { returnDocument: 'after' }
    );
    const doc = res && (res.value !== undefined ? res.value : res);
    if (!doc) {
      const cur = await withdrawalsCol.findOne({ _id: id });
      if (!cur) return { notFound: true };
      return { alreadyProcessed: true };
    }
    return { doc };
  }

  /* #3 Manual release to seller: admin sends USDT off-platform, then records the
   * on-chain tx hash here so the payout is verifiable and auditable. */
  app.post('/api/admin/withdrawals/:id/approve', async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      const txHash = String((req.body || {}).txHash || '').trim();
      if (!txHash || txHash.length < 8) {
        return res.status(400).json({ error: 'txHash', msg: 'Record the on-chain transaction hash before approving' });
      }
      const result = await claimWithdrawal(req.params.id, 'completed', txHash);
      if (result.notFound) return res.status(404).json({ error: 'not found' });
      if (result.alreadyProcessed) return res.status(400).json({ error: 'already processed' });
      res.json({ ok: true, withdrawal: result.doc });
    } catch (err) {
      res.status(500).json({ error: 'server' });
    }
  });

  app.post('/api/admin/withdrawals/:id/reject', async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      const w = memory ? memory.withdrawals.get(req.params.id) : await withdrawalsCol.findOne({ _id: req.params.id });
      if (!w) return res.status(404).json({ error: 'not found' });
      // Flip status to 'rejected' first so a crash/retry between the two writes
      // can never refund twice (the conditional claim blocks re-entry). Worst
      // case is a missed refund, which is safe to re-run manually.
      const result = await claimWithdrawal(req.params.id, 'rejected');
      if (result.notFound) return res.status(404).json({ error: 'not found' });
      if (result.alreadyProcessed) return res.status(400).json({ error: 'already processed' });
      await sellerStore.creditSellerBalance(w.sellerEmail, w.amount, {
        type: 'refund',
        amt: w.amount,
        lbl: 'Withdrawal rejected — funds returned',
        t: 'just now',
        at: new Date(),
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'server' });
    }
  });

  app.get('/api/admin/listings', async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      let list = memory
        ? [...memory.listings.values()]
        : await listingsCol.find({}).sort({ createdAt: -1 }).limit(200).toArray();
      const out = [];
      for (const doc of list) {
        const sp = await sellerStore.getSellerProfile(doc.sellerEmail);
        out.push({
          id: doc._id,
          title: doc.title,
          cat: doc.cat,
          price: doc.price,
          status: doc.status,
          sellerEmail: doc.sellerEmail,
          sellerName: doc.sellerName || sp?.name || '',
          sellerVerified: !!sp?.verified,
          createdAt: doc.createdAt,
        });
      }
      res.json({ listings: out });
    } catch (err) {
      res.status(500).json({ error: 'server' });
    }
  });

  app.put('/api/admin/listings/:id/status', async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      const status = (req.body || {}).status;
      if (!['active', 'paused', 'draft', 'removed'].includes(status)) {
        return res.status(400).json({ error: 'bad status' });
      }
      const doc = await sellerStore.getListing(req.params.id);
      if (!doc) return res.status(404).json({ error: 'not found' });
      doc.status = status;
      await sellerStore.saveListing(doc);
      res.json({ ok: true, listing: doc });
    } catch (err) {
      res.status(500).json({ error: 'server' });
    }
  });

  app.get('/api/admin/payments', async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const list = await paymentStore.listRecent(limit);
      res.json({ payments: list });
    } catch (err) {
      res.status(500).json({ error: 'server' });
    }
  });

  /* Unified order feed: every escrow joined with its payment record server-side
   * (per-escrow lookup — never a capped bulk list), so escrows whose payment
   * fell off any recent-window still render with correct status + amounts.
   * Paginated so large marketplaces don't render unbounded rows. */
  app.get('/api/admin/orders', async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 25));

      // Escrows are the source of truth for lifecycle state.
      const escrows = await sellerStore.listAllEscrows(500);
      const withPayment = [];
      for (const e of escrows) {
        let p = null;
        if (paymentStore && typeof paymentStore.getByOrderId === 'function') {
          try { p = await paymentStore.getByOrderId(e._id); } catch (_) { p = null; }
        }
        withPayment.push({
          orderId: e._id,
          title: e.title || p?.title || '',
          amount: e.amount ?? p?.amount,
          buyerTotal: p?.buyerTotal ?? e.amount,
          status: e.status, // held | delivered | dispute | released | refunded
          paymentStatus: p?.status || null,
          refundStatus: p?.refundStatus || null,
          outOfStock: !!p?.outOfStock,
          method: e.method || p?.method || null,
          buyerEmail: e.buyerEmail || p?.buyerEmail || null,
          sellerEmail: e.sellerEmail || p?.sellerEmail || null,
          disputeReason: e.disputeReason || null,
          createdAt: e.createdAt || p?.createdAt || null,
          deliveredAt: e.deliveredAt || null,
          disputedAt: e.disputedAt || null,
          resolvedAt: e.releasedAt || e.refundedAt || null,
        });
      }

      // Payments with no escrow yet (crypto paid but escrow not opened, or
      // out-of-stock orders that need a refund operator). Bounded recent list
      // is fine here — these are always fresh by definition.
      const escrowIds = new Set(escrows.map(e => e._id));
      const recent = paymentStore ? await paymentStore.listRecent(200) : [];
      for (const p of recent) {
        if (p.purpose === 'deposit') continue; // wallet top-ups aren't orders
        if (escrowIds.has(p.orderId)) continue;
        withPayment.push({
          orderId: p.orderId,
          title: p.title || '',
          amount: p.amount,
          buyerTotal: p.buyerTotal ?? p.amount,
          status: p.outOfStock ? 'out_of_stock' : (p.status === 'paid' ? 'paid' : (p.status || 'pending')),
          paymentStatus: p.status || null,
          refundStatus: p.refundStatus || null,
          outOfStock: !!p.outOfStock,
          method: p.method || null,
          buyerEmail: p.buyerEmail || null,
          sellerEmail: p.sellerEmail || null,
          disputeReason: null,
          createdAt: p.createdAt || null,
          deliveredAt: null,
          disputedAt: null,
          resolvedAt: null,
        });
      }

      withPayment.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      const total = withPayment.length;
      const pages = Math.max(1, Math.ceil(total / pageSize));
      const start = (page - 1) * pageSize;
      res.json({ orders: withPayment.slice(start, start + pageSize), total, page, pages, pageSize });
    } catch (err) {
      console.error('admin orders error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  /* ---------- #4/#6 escrow arbitration ---------- */
  app.get('/api/admin/disputes', async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      const list = await sellerStore.listDisputedEscrows(100);
      res.json({
        disputes: list.map(e => ({
          dealId: e._id,
          buyerEmail: e.buyerEmail,
          sellerEmail: e.sellerEmail,
          amount: e.amount,
          title: e.title,
          method: e.method,
          status: e.status,
          reason: e.disputeReason || '',
          proof: e.deliveryProof || '',
          createdAt: e.createdAt,
          disputedAt: e.disputedAt || null,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: 'server' });
    }
  });

  app.post('/api/admin/disputes/:dealId/resolve', async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      const resolution = (req.body || {}).resolution;
      if (!['release', 'refund'].includes(resolution)) {
        return res.status(400).json({ error: 'bad resolution', msg: 'resolution must be "release" or "refund"' });
      }
      const result = await sellerStore.resolveEscrow({
        dealId: req.params.dealId,
        resolution,
        walletStore,
        paymentStore,
        stockStore,
      });
      if (result.notFound) return res.status(404).json({ error: 'not found' });
      if (result.badState) return res.status(409).json({ error: 'bad_state', msg: `Escrow is ${result.status}` });
      if (result.duplicate) return res.json({ ok: true, duplicate: true });
      if (result.released) {
        const p = result.payout || {};
        return res.json({ ok: true, resolution: 'release', net: p.net, fee: p.fee });
      }
      res.json({ ok: true, resolution: 'refund', amount: result.escrow?.amount });
    } catch (err) {
      console.error('resolve dispute error:', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  app.get('/api/admin/config', async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      const paymentsMod = require('./payments');
      const { feeConfig } = require('./fees');
      res.json({
        paymentProvider: paymentsMod.provider(),
        paymentsConfigured: paymentsMod.isConfigured(),
        sandbox: paymentsMod.sandboxEnabled(),
        publicUrl: paymentsMod.publicUrl(),
        fees: feeConfig(),
      });
    } catch (err) {
      res.status(500).json({ error: 'server' });
    }
  });
}

module.exports = { registerAdminRoutes };
