// Demo data for local development only (`npm run seed`); production starts empty and never seeds.
import bcrypt from 'bcryptjs';
import { closeDb, initDb, one, q } from '../server/db.js';

// Only the embedded local database: a DATABASE_URL left in a shell can point at a shared prod server.
if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) {
  console.error('Refusing to seed: demo data goes only into the local embedded database (unset NODE_ENV=production and DATABASE_URL).');
  process.exit(1);
}
await initDb();
console.log('Seeding database...');

// ── Influencers ───────────────────────────────────────────────
const influencers = [
  {
    name: 'Sophie Chen',
    email: 'sophie@example.com',
    phone: '617-555-0101',
    instagram: '@sophiechen',
    tiktok: '@sophiechen_life',
    youtube: 'SophieChenCreates',
    instagram_followers: 48200,
    tiktok_followers: 125000,
    youtube_followers: 12400,
    why_lovepop: 'I fell in love with Lovepop cards when I received one for my birthday. The 3D pop-up designs are unlike anything else—they genuinely make people cry happy tears. I want to share that magic with my audience who loves gifting and memorable moments.',
    age_range: '25-34',
    audience_description: 'Millennial women in the US interested in lifestyle, gifting, home decor, and relationships. High engagement on holiday and occasion content.',
    status: 'approved',
    tier: 'gold',
    total_posts: 28,
    total_impressions: 890000,
    lovepop_contacts: JSON.stringify(['Sarah Mitchell', 'James Rodriguez']),
    notes: JSON.stringify([
      { text: 'Sophie crushed the holiday campaign - her reel got 2.3M views organically', author: 'Sarah Mitchell', timestamp: '2026-03-15T14:23:00Z' },
      { text: 'Sent 2 product bundles for Valentines Day campaign. Confirmed received.', author: 'James Rodriguez', timestamp: '2026-01-20T09:15:00Z' }
    ])
  },
  {
    name: 'Marcus Webb',
    email: 'marcus@example.com',
    phone: '212-555-0202',
    instagram: '@marcuswebb',
    tiktok: '@marcusdoeslife',
    linkedin: 'marcuswebbcreative',
    instagram_followers: 92000,
    tiktok_followers: 310000,
    linkedin_followers: 8500,
    why_lovepop: 'As someone who creates content about relationships and thoughtful gestures, Lovepop cards are a perfect fit. They are the most impressive physical card you can give—nobody forgets getting one.',
    age_range: '25-34',
    audience_description: 'Mixed gender audience ages 22-40. Strong following in NYC, LA, Chicago. High interest in dating, relationships, and elevated lifestyle content.',
    status: 'approved',
    tier: 'platinum',
    total_posts: 52,
    total_impressions: 4200000,
    lovepop_contacts: JSON.stringify(['Sarah Mitchell']),
    notes: JSON.stringify([
      { text: 'Marcus is our top performing creator this quarter. Offer Diamond tier benefits early.', author: 'Sarah Mitchell', timestamp: '2026-04-01T11:00:00Z' }
    ])
  },
  {
    name: 'Priya Nair',
    email: 'priya@example.com',
    phone: '415-555-0303',
    instagram: '@priyacreates',
    youtube: 'PriyaNairVlogs',
    instagram_followers: 23500,
    youtube_followers: 45000,
    why_lovepop: 'My audience is obsessed with thoughtful gift guides. Lovepop cards are always the most commented item when I feature them—people want to know where to get them immediately.',
    age_range: '35-44',
    audience_description: 'Predominantly women 30-45 interested in family, parenting, thoughtful gifting, and home. Very high purchasing intent.',
    status: 'approved',
    tier: 'silver',
    total_posts: 18,
    total_impressions: 340000,
    lovepop_contacts: JSON.stringify(['James Rodriguez']),
    notes: JSON.stringify([
      { text: 'Great content quality. Wants to do a unboxing video series for back to school season.', author: 'James Rodriguez', timestamp: '2026-02-28T16:45:00Z' }
    ])
  },
  {
    name: 'Tyler Brooks',
    email: 'tyler@example.com',
    phone: '303-555-0404',
    tiktok: '@tylerbrooks',
    instagram: '@tyler.brooks.co',
    tiktok_followers: 89000,
    instagram_followers: 15600,
    why_lovepop: 'I do a lot of "gift ideas for guys" content and Lovepop cards are legitimately one of the few cards men will actually want to give. They are conversation starters.',
    age_range: '25-34',
    audience_description: 'Predominantly male audience 18-35. Gaming, fitness, relationships, and lifestyle content. Strong TikTok presence.',
    status: 'pending',
    tier: 'bronze',
    total_posts: 0,
    total_impressions: 0,
    lovepop_contacts: JSON.stringify([]),
    notes: JSON.stringify([])
  },
  {
    name: 'Amanda Liu',
    email: 'amanda@example.com',
    phone: '206-555-0505',
    instagram: '@amandaliu.style',
    tiktok: '@amandaliustyle',
    youtube: 'AmandaLiuStyle',
    instagram_followers: 178000,
    tiktok_followers: 445000,
    youtube_followers: 67000,
    why_lovepop: 'I send Lovepop cards to my closest followers as surprise gifts and the reaction videos they post are incredible. I want to partner officially to bring more of this joy to my community.',
    age_range: '25-34',
    audience_description: 'Fashion-forward women 20-35. Very high engagement rate (avg 8.2%). Strong influence on purchasing decisions especially seasonal gifts.',
    status: 'approved',
    tier: 'diamond',
    total_posts: 127,
    total_impressions: 12800000,
    lovepop_contacts: JSON.stringify(['Sarah Mitchell', 'James Rodriguez']),
    notes: JSON.stringify([
      { text: 'Amanda is our Diamond tier creator. Full partnership including affiliate commission. Contract signed Q4 2025.', author: 'Sarah Mitchell', timestamp: '2026-01-05T10:00:00Z' },
      { text: 'Renewing partnership for 2026. Increase product budget to $500/quarter.', author: 'Sarah Mitchell', timestamp: '2026-03-20T14:30:00Z' }
    ])
  },
  {
    name: 'Kevin Park',
    email: 'kevin@example.com',
    phone: '617-555-0606',
    instagram: '@kevinparkbts',
    instagram_followers: 8900,
    why_lovepop: 'I focus on behind-the-scenes content for small businesses and creative entrepreneurs. Lovepop cards would be perfect for my audience who love supporting small businesses and the craft behind beautiful products.',
    age_range: '18-24',
    audience_description: 'Young creative professionals and entrepreneurs. Interested in small business content, behind the scenes, and craft.',
    status: 'pending',
    tier: 'bronze',
    total_posts: 0,
    total_impressions: 0,
    lovepop_contacts: JSON.stringify([]),
    notes: JSON.stringify([
      { text: 'Interesting niche. Low follower count but very targeted. Discuss with team.', author: 'James Rodriguez', timestamp: '2026-04-10T09:00:00Z' }
    ])
  }
];

// Set passwords for approved influencers
const passwords = {
  'sophie@example.com': 'sophie123',
  'marcus@example.com': 'marcus123',
  'priya@example.com': 'priya123',
  'amanda@example.com': 'amanda123'
};

for (const inf of influencers) {
  const existing = await one('SELECT id FROM influencers WHERE email = $1', [inf.email]);
  if (existing) {
    console.log(`Skipping existing: ${inf.email}`);
    continue;
  }
  const password_hash = passwords[inf.email] ? bcrypt.hashSync(passwords[inf.email], 10) : '';
  await q(`
    INSERT INTO influencers (name, email, phone, instagram, tiktok, youtube, linkedin,
      instagram_followers, tiktok_followers, youtube_followers, linkedin_followers,
      why_lovepop, age_range, audience_description, status, tier, total_posts, total_impressions,
      lovepop_contacts, notes, contracts, password_hash)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'[]',$21)
  `, [inf.name, inf.email, inf.phone || '',
    inf.instagram || '', inf.tiktok || '', inf.youtube || '', inf.linkedin || '',
    inf.instagram_followers || 0, inf.tiktok_followers || 0,
    inf.youtube_followers || 0, inf.linkedin_followers || 0,
    inf.why_lovepop, inf.age_range, inf.audience_description,
    inf.status, inf.tier, inf.total_posts, inf.total_impressions,
    inf.lovepop_contacts, inf.notes, password_hash]);
  console.log(`Created influencer: ${inf.name}`);
}

// ── Add contacts for some influencers ─────────────────────────
const sophieId = (await one("SELECT id FROM influencers WHERE email='sophie@example.com'"))?.id;
const marcusId = (await one("SELECT id FROM influencers WHERE email='marcus@example.com'"))?.id;
const amandaId = (await one("SELECT id FROM influencers WHERE email='amanda@example.com'"))?.id;

if (sophieId && !(await one('SELECT id FROM influencer_contacts WHERE influencer_id=$1', [sophieId]))) {
  await q(`INSERT INTO influencer_contacts (influencer_id, name, email, phone, role, active) VALUES ($1,$2,$3,$4,$5,$6)`, [sophieId, 'Sophie Chen', 'sophie@example.com', '617-555-0101', 'Primary Creator', 1]);
  await q(`INSERT INTO influencer_contacts (influencer_id, name, email, phone, role, active) VALUES ($1,$2,$3,$4,$5,$6)`, [sophieId, 'Lily Chen', 'lily.chen@agency.com', '617-555-0102', 'Talent Manager', 1]);
}
if (marcusId && !(await one('SELECT id FROM influencer_contacts WHERE influencer_id=$1', [marcusId]))) {
  await q(`INSERT INTO influencer_contacts (influencer_id, name, email, phone, role, active) VALUES ($1,$2,$3,$4,$5,$6)`, [marcusId, 'Marcus Webb', 'marcus@example.com', '212-555-0202', 'Primary Creator', 1]);
  await q(`INSERT INTO influencer_contacts (influencer_id, name, email, phone, role, active) VALUES ($1,$2,$3,$4,$5,$6)`, [marcusId, 'Derek Jones', 'derek@talentco.com', '212-555-0203', 'Booking Agent', 1]);
}
if (amandaId && !(await one('SELECT id FROM influencer_contacts WHERE influencer_id=$1', [amandaId]))) {
  await q(`INSERT INTO influencer_contacts (influencer_id, name, email, phone, role, active) VALUES ($1,$2,$3,$4,$5,$6)`, [amandaId, 'Amanda Liu', 'amanda@example.com', '206-555-0505', 'Primary Creator', 1]);
  await q(`INSERT INTO influencer_contacts (influencer_id, name, email, phone, role, active) VALUES ($1,$2,$3,$4,$5,$6)`, [amandaId, 'Creative Agency BKG', 'bookings@bkg.agency', '206-555-0506', 'Brand Partnerships', 1]);
  await q(`INSERT INTO influencer_contacts (influencer_id, name, email, phone, role, active) VALUES ($1,$2,$3,$4,$5,$6)`, [amandaId, 'Tom Liu', 'tom@liufamily.com', '206-555-0507', 'Business Manager', 0]);
}

// ── Campaigns ─────────────────────────────────────────────────
const campaigns = [
  {
    name: "Mother's Day Magic 2026",
    description: "Create heartfelt content showcasing Lovepop Mother's Day cards and gift sets. Help people realize that a Lovepop card is the ultimate mom gift—she will keep it forever.",
    objectives: "Drive awareness and purchase intent for Mother's Day card collection. Goal: 500K+ combined impressions, 5% average engagement rate.",
    start_date: '2026-04-15',
    end_date: '2026-05-11',
    status_override: 'live',
    success_metrics: "Total impressions across all creator posts, engagement rate, promo code redemptions, and sentiment analysis of comments. Target: 500K impressions, 50 total posts from creators.",
    product_bundles: JSON.stringify([
      { name: "Mother's Day Starter Bundle", items: ["1 Mother's Day Card of Choice", "1 Birthday Card", "Gift Wrap"], value: "$45" },
      { name: "Premium Mom Bundle", items: ["3 Mother's Day Cards", "Lovepop Gift Box", "Personalization Kit"], value: "$95" }
    ]),
    sku_designations: JSON.stringify(["Mother's Day Collection", "Floral Pop-Ups", "Love & Family"])
  },
  {
    name: "Graduation Season 2026",
    description: "Help graduates feel celebrated with Lovepop's stunning graduation card collection. Content should feel aspirational, celebratory, and capture the emotional weight of this milestone.",
    objectives: "Expand Lovepop's reach to younger demographics (18-24) and parents of graduates. Build brand association with milestone celebrations.",
    start_date: '2026-05-01',
    end_date: '2026-06-15',
    status_override: '',
    success_metrics: "New customer acquisition via promo codes. Brand mentions. Target: 300K impressions, 15% new-to-brand purchases.",
    product_bundles: JSON.stringify([
      { name: "Grad Essentials Bundle", items: ["1 Graduation Card", "1 Congrats Card", "Gold Ribbon"], value: "$35" },
      { name: "Grad Gift Set", items: ["3 Graduation Cards", "Lovepop Keepsake Box", "Personalization"], value: "$75" }
    ]),
    sku_designations: JSON.stringify(["Graduation Collection", "Achievement & Milestone"])
  },
  {
    name: "Always-On: Stash Pass Awareness",
    description: "Evergreen campaign to promote Lovepop's Stash Pass subscription program. Show how having a stash of Lovepop cards makes you the best gift-giver in anyone's life.",
    objectives: "Drive Stash Pass subscriptions. Demonstrate the value of always having beautiful cards ready to go. Target storytelling about the surprise and delight of giving a Lovepop card.",
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    status_override: 'live',
    success_metrics: "Stash Pass sign-ups via creator links. Story views and saves. Content should feel organic and personal rather than promotional.",
    product_bundles: JSON.stringify([
      { name: "Stash Starter", items: ["5 Cards of Choice", "Lovepop Stash Box", "Stash Pass 1-Month Trial"], value: "$60" },
      { name: "Ambassador Stash", items: ["10 Cards of Choice", "Premium Stash Box", "Stash Pass 3-Month"], value: "$120" }
    ]),
    sku_designations: JSON.stringify(["All Collections", "Best Sellers", "Stash Pass Eligible"])
  },
  {
    name: "Holiday Magic 2025 (Archived)",
    description: "Our flagship holiday campaign. Create content around the magic of giving Lovepop during the holiday season. Capture genuine unboxing reactions, decorating moments, and gift-giving stories.",
    objectives: "Maximum brand visibility during peak shopping season. Drive both online and retail traffic.",
    start_date: '2025-11-01',
    end_date: '2025-12-31',
    status_override: 'closed',
    success_metrics: "10M combined impressions. Top 3 social mentions in gifting category during holiday week.",
    product_bundles: JSON.stringify([
      { name: "Holiday Bundle", items: ["3 Holiday Cards", "Gift Wrap Set", "Free Shipping Code"], value: "$55" },
      { name: "Holiday Mega Bundle", items: ["6 Holiday Cards", "Ornament Pack", "Priority Shipping"], value: "$110" }
    ]),
    sku_designations: JSON.stringify(["Holiday Collection", "Winter Collection", "Best Sellers"])
  }
];

for (const camp of campaigns) {
  const existing = await one('SELECT id FROM campaigns WHERE name = $1', [camp.name]);
  if (existing) { console.log(`Skipping existing campaign: ${camp.name}`); continue; }
  await q(`
    INSERT INTO campaigns (name, description, objectives, start_date, end_date, status_override, success_metrics, product_bundles, sku_designations)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
  `, [camp.name, camp.description, camp.objectives, camp.start_date, camp.end_date, camp.status_override, camp.success_metrics, camp.product_bundles, camp.sku_designations]);
  console.log(`Created campaign: ${camp.name}`);
}

// ── Post Submissions ──────────────────────────────────────────
const allInfluencers = await q("SELECT id, name FROM influencers WHERE status='approved'");
const allCampaigns = await q("SELECT id, name FROM campaigns");

const platforms = ['Instagram', 'TikTok', 'YouTube', 'LinkedIn'];
const samplePosts = [
  { platform: 'Instagram', post_url: 'https://instagram.com/p/example1', impressions: 145000, notes: 'Reel format, organic reach exceeded expectations', status: 'approved' },
  { platform: 'TikTok', post_url: 'https://tiktok.com/@creator/video/example1', impressions: 380000, notes: 'Went mini-viral, featured in #gifting FYP', status: 'approved' },
  { platform: 'Instagram', post_url: 'https://instagram.com/p/example2', impressions: 52000, notes: 'Story series over 3 days', status: 'approved' },
  { platform: 'YouTube', post_url: 'https://youtube.com/watch?v=example1', impressions: 28000, notes: 'Dedicated unboxing video, great watch time', status: 'approved' },
  { platform: 'TikTok', post_url: 'https://tiktok.com/@creator/video/example2', impressions: 92000, notes: 'Trending sound + product showcase', status: 'approved' },
  { platform: 'Instagram', post_url: 'https://instagram.com/p/example3', impressions: 37000, notes: 'Feed post with product in lifestyle context', status: 'pending' }
];

for (const inf of allInfluencers) {
  const existingPosts = (await one('SELECT COUNT(*)::int AS c FROM post_submissions WHERE influencer_id=$1', [inf.id])).c;
  if (existingPosts > 0) continue;
  const numPosts = Math.floor(Math.random() * 4) + 2;
  for (let i = 0; i < numPosts && i < samplePosts.length; i++) {
    const post = samplePosts[i];
    const campaign = allCampaigns[Math.floor(Math.random() * allCampaigns.length)];
    const daysAgo = Math.floor(Math.random() * 60);
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    await q(`
      INSERT INTO post_submissions (influencer_id, campaign_id, platform, post_url, date_posted, impressions, notes, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `, [inf.id, campaign.id, post.platform, post.post_url, date.toISOString().split('T')[0], post.impressions, post.notes, post.status]);
  }
  console.log(`Created posts for: ${inf.name}`);
}

console.log('\nSeed complete!');
console.log('\nTeam sign-in: open /team (local dev mode signs you in as Local Dev).');
console.log('\nInfluencer logins:');
console.log('  sophie@example.com / sophie123');
console.log('  marcus@example.com / marcus123');
console.log('  priya@example.com  / priya123');
console.log('  amanda@example.com / amanda123');

await closeDb();
