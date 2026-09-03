#!/usr/bin/env node
/**
 * Seed seller profiles + marketplace listings from demo data.
 * Usage: npm run seed:listings
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { MongoClient } = require('mongodb');
const { defaultSellerProfile } = require('../lib/seller-store');

const LISTINGS = [
  { id:'L1', cat:'accounts', title:'52K-member crypto news channel — OG 4-letter handle included', price:3400, age:2,
    seller:{ name:'M. Okafor', email:'m.okafor@sellers.dot.market', rate:4.9, deals:47, vfy:true, since:'Mar 2025' },
    desc:'Active since 2019, 61% premium subscribers, no strikes. Full ownership transfer: channel, linked group, and the OG handle.' },
  { id:'L2', cat:'subscriptions', title:'StreamFlix Premium family slot — 12 months, auto-renew handled', price:38, age:5,
    seller:{ name:'Anna Pixel', email:'anna.pixel@sellers.dot.market', rate:4.8, deals:212, vfy:true, since:'Dec 2024' },
    desc:'Private profile with PIN on a 4K family plan. Invite lands within 15 minutes of escrow opening.' },
  { id:'L3', cat:'software', title:'Figma-source UI kit — 400+ components, lifetime updates license', price:120, age:9,
    seller:{ name:'Devraj S.', email:'devraj.s@sellers.dot.market', rate:5.0, deals:18, vfy:true, since:'Jun 2025' },
    desc:'Full source file plus token sheet and dark/light variants. Commercial license for one team.' },
  { id:'L4', cat:'gaming', title:'Valorant account — Immortal 3, 74 skins, full e-mail change', price:260, age:1,
    seller:{ name:'kazuto', email:'kazuto@sellers.dot.market', rate:4.7, deals:33, vfy:false, since:'Jan 2026' },
    desc:'Region-free, rank history clean, never botted. Full e-mail and Riot ID change done inside the deal chat.' },
  { id:'L5', cat:'services', title:'Landing-page design slot — 2 openings for September', price:450, age:3,
    seller:{ name:'Studio Nara', email:'studio.nara@sellers.dot.market', rate:4.9, deals:64, vfy:true, since:'Aug 2025' },
    desc:'One-page design in Figma, two revision rounds, 7-day turnaround.' },
  { id:'L6', cat:'digital', title:'Notion-style workspace template pack — agency OS, 12 databases', price:29, age:12,
    seller:{ name:'Lena V.', email:'lena.v@sellers.dot.market', rate:4.8, deals:96, vfy:false, since:'Oct 2025' },
    desc:'Duplicate link arrives automatically right after payment. Projects, CRM, invoices pre-wired.' },
];

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set in .env');
    process.exit(1);
  }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const db = client.db('dotmarket');
    const listings = db.collection('listings');
    const profiles = db.collection('seller_profiles');

    const sellers = new Map();
    for (const l of LISTINGS) {
      if (!sellers.has(l.seller.email)) {
        const p = defaultSellerProfile(l.seller.email, l.seller.name);
        p.verified = l.seller.vfy;
        p.verifiedAt = l.seller.vfy ? new Date() : null;
        p.rate = l.seller.rate;
        p.deals = l.seller.deals;
        p.since = l.seller.since;
        p.balance = l.seller.vfy ? 150 : 0;
        sellers.set(l.seller.email, p);
      }
      await listings.replaceOne({ _id: l.id }, {
        _id: l.id,
        sellerEmail: l.seller.email,
        sellerName: l.seller.name,
        cat: l.cat,
        title: l.title,
        desc: l.desc,
        price: l.price,
        ageDays: l.age,
        status: l.seller.vfy ? 'active' : 'draft',
        createdAt: new Date(),
        updatedAt: new Date(),
      }, { upsert: true });
    }
    for (const p of sellers.values()) {
      await profiles.replaceOne({ _id: p._id }, p, { upsert: true });
    }
    console.log(`Seeded ${LISTINGS.length} listings and ${sellers.size} seller profiles.`);
    await client.close();
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err.message);
    try { await client.close(); } catch (_) {}
    process.exit(1);
  }
})();
