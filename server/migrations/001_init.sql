-- Port of the SQLite schema in the old database.js. JSON-array columns stay TEXT (the routes
-- JSON.parse / JSON.stringify them); campaign and post dates stay 'YYYY-MM-DD' TEXT ('' = unset).
CREATE TABLE influencers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  email TEXT UNIQUE NOT NULL DEFAULT '',
  password_hash TEXT DEFAULT '',
  instagram TEXT DEFAULT '',
  tiktok TEXT DEFAULT '',
  youtube TEXT DEFAULT '',
  linkedin TEXT DEFAULT '',
  instagram_followers INTEGER DEFAULT 0,
  tiktok_followers INTEGER DEFAULT 0,
  youtube_followers INTEGER DEFAULT 0,
  linkedin_followers INTEGER DEFAULT 0,
  why_lovepop TEXT DEFAULT '',
  age_range TEXT DEFAULT '',
  audience_description TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  tier TEXT DEFAULT 'bronze',
  total_posts INTEGER DEFAULT 0,
  total_impressions INTEGER DEFAULT 0,
  partnership_opened_at TIMESTAMPTZ DEFAULT now(),
  lovepop_contacts TEXT DEFAULT '[]',
  notes TEXT DEFAULT '[]',
  contracts TEXT DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE influencer_contacts (
  id SERIAL PRIMARY KEY,
  influencer_id INTEGER REFERENCES influencers(id) ON DELETE CASCADE,
  name TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  role TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE campaigns (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  description TEXT DEFAULT '',
  objectives TEXT DEFAULT '',
  start_date TEXT DEFAULT '',
  end_date TEXT DEFAULT '',
  status TEXT DEFAULT 'coming_soon',
  status_override TEXT DEFAULT '',
  success_metrics TEXT DEFAULT '',
  product_bundles TEXT DEFAULT '[]',
  image_assets TEXT DEFAULT '[]',
  sku_designations TEXT DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE post_submissions (
  id SERIAL PRIMARY KEY,
  influencer_id INTEGER REFERENCES influencers(id) ON DELETE CASCADE,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  platform TEXT DEFAULT '',
  post_url TEXT DEFAULT '',
  screenshot_path TEXT DEFAULT '',
  date_posted TEXT DEFAULT '',
  impressions INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE campaign_influencers (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
  influencer_id INTEGER REFERENCES influencers(id) ON DELETE CASCADE,
  bundle_requested TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX post_submissions_influencer_idx ON post_submissions (influencer_id);
CREATE INDEX influencer_contacts_influencer_idx ON influencer_contacts (influencer_id);
