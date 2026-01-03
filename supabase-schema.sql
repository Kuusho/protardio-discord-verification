-- Discord Verifications (completed verifications)
CREATE TABLE IF NOT EXISTS discord_verifications (
  id SERIAL PRIMARY KEY,
  fid INTEGER NOT NULL,
  wallet TEXT NOT NULL,
  discord_id TEXT NOT NULL UNIQUE,
  discord_username TEXT NOT NULL,
  nft_balance INTEGER DEFAULT 0,
  verified_at TIMESTAMPTZ DEFAULT NOW(),
  last_checked TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_discord_verifications_wallet ON discord_verifications(wallet);
CREATE INDEX IF NOT EXISTS idx_discord_verifications_fid ON discord_verifications(fid);
CREATE INDEX IF NOT EXISTS idx_discord_verifications_last_checked ON discord_verifications(last_checked);

-- Discord Pending Verifications (OAuth in progress)
CREATE TABLE IF NOT EXISTS discord_pending_verifications (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  fid INTEGER NOT NULL,
  wallet TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Wallet Pending Verifications (signature verification in progress)
CREATE TABLE IF NOT EXISTS wallet_pending_verifications (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  wallet TEXT NOT NULL,
  nonce TEXT NOT NULL,
  signature TEXT,
  verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (optional but recommended)
ALTER TABLE discord_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE discord_pending_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_pending_verifications ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role has full access to discord_verifications"
  ON discord_verifications FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role has full access to discord_pending_verifications"
  ON discord_pending_verifications FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role has full access to wallet_pending_verifications"
  ON wallet_pending_verifications FOR ALL
  USING (true)
  WITH CHECK (true);
