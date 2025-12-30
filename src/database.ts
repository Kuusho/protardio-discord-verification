import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Ensure data directory exists
const dataDir = path.dirname(process.env.DATABASE_PATH || './data/verifications.db');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(process.env.DATABASE_PATH || './data/verifications.db');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fid INTEGER NOT NULL,
    wallet TEXT NOT NULL,
    discord_id TEXT NOT NULL UNIQUE,
    discord_username TEXT,
    verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_checked TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_wallet ON verifications(wallet);
  CREATE INDEX IF NOT EXISTS idx_discord_id ON verifications(discord_id);
  CREATE INDEX IF NOT EXISTS idx_fid ON verifications(fid);

  CREATE TABLE IF NOT EXISTS pending_verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL UNIQUE,
    fid INTEGER NOT NULL,
    wallet TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

export interface Verification {
  id: number;
  fid: number;
  wallet: string;
  discord_id: string;
  discord_username: string;
  verified_at: string;
  last_checked: string;
}

export interface PendingVerification {
  session_id: string;
  fid: number;
  wallet: string;
}

export const database = {
  // Store pending verification (before Discord OAuth)
  storePending: (sessionId: string, fid: number, wallet: string) => {
    const stmt = db.prepare(
      'INSERT INTO pending_verifications (session_id, fid, wallet) VALUES (?, ?, ?)'
    );
    stmt.run(sessionId, fid, wallet.toLowerCase());
  },

  // Get pending verification
  getPending: (sessionId: string): PendingVerification | undefined => {
    const stmt = db.prepare(
      'SELECT * FROM pending_verifications WHERE session_id = ?'
    );
    return stmt.get(sessionId) as PendingVerification | undefined;
  },

  // Delete pending verification
  deletePending: (sessionId: string) => {
    const stmt = db.prepare('DELETE FROM pending_verifications WHERE session_id = ?');
    stmt.run(sessionId);
  },

  // Store completed verification
  storeVerification: (fid: number, wallet: string, discordId: string, discordUsername: string) => {
    const stmt = db.prepare(`
      INSERT INTO verifications (fid, wallet, discord_id, discord_username)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(discord_id) DO UPDATE SET
        fid = excluded.fid,
        wallet = excluded.wallet,
        discord_username = excluded.discord_username,
        last_checked = CURRENT_TIMESTAMP
    `);
    stmt.run(fid, wallet.toLowerCase(), discordId, discordUsername);
  },

  // Get verification by Discord ID
  getVerificationByDiscord: (discordId: string): Verification | undefined => {
    const stmt = db.prepare('SELECT * FROM verifications WHERE discord_id = ?');
    return stmt.get(discordId) as Verification | undefined;
  },

  // Get verification by wallet
  getVerificationByWallet: (wallet: string): Verification | undefined => {
    const stmt = db.prepare('SELECT * FROM verifications WHERE wallet = ?');
    return stmt.get(wallet.toLowerCase()) as Verification | undefined;
  },

  // Get all verifications
  getAllVerifications: (): Verification[] => {
    const stmt = db.prepare('SELECT * FROM verifications');
    return stmt.all() as Verification[];
  },

  // Get verification count
  getVerifiedCount: (): number => {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM verifications');
    return (stmt.get() as { count: number }).count;
  },

  // Delete verification by Discord ID
  deleteVerification: (discordId: string) => {
    const stmt = db.prepare('DELETE FROM verifications WHERE discord_id = ?');
    stmt.run(discordId);
  },

  // Clean up old pending verifications (older than 1 hour)
  cleanupOldPending: () => {
    db.exec(`
      DELETE FROM pending_verifications
      WHERE created_at < datetime('now', '-1 hour')
    `);
  }
};

export default database;
