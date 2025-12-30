# How to Build Protardio Discord Verification Bot

## Overview

Build a custom Discord verification bot that allows Farcaster users to verify their Protardio NFT ownership and get Discord roles **without requiring MetaMask popups**. The bot integrates directly with your Farcaster mini app where wallets are already connected.

---

## Core User Flow

```
1. User opens Protardio mini app (Farcaster wallet already connected)
2. User clicks "Verify Discord" button
3. Discord OAuth: User authorizes your app
4. Backend receives:
   - Discord ID & username
   - Farcaster FID
   - Connected wallet address
5. Backend checks: Does this wallet hold Protardio NFT?
6. If YES:
   - Bot assigns "Protardio Holder" role in Discord
   - Store mapping in database
   - Redirect user back with success message
7. If NO:
   - Show error message
   - Do not assign role
```

---

## Tech Stack Recommendations

### Backend Framework
**Recommended: Express.js (Node.js)**
- Fast, simple, well-documented
- Great Discord.js integration
- Easy OAuth2 implementation

**Alternative: Hono (if you want edge deployment)**
- Works on Cloudflare Workers
- Lighter weight
- Better for serverless

### Discord Bot Library
**Use: discord.js v14**
```bash
npm install discord.js
```
- Official Discord library
- Well-maintained
- Excellent TypeScript support

### Blockchain Interaction
**Use: viem**
```bash
npm install viem
```
- Modern, TypeScript-first
- Better than ethers.js for this use case
- Built-in Base chain support

### Database
**Recommended: PostgreSQL (via Supabase or Neon)**
- Free tier available
- Great for relational data
- Easy FID ↔ Discord ↔ Wallet mapping

**Alternative: SQLite (for simplicity)**
```bash
npm install better-sqlite3
```
- No separate DB server needed
- Perfect for MVP

### Environment/Deployment
**Recommended: Railway.app**
- Free $5/month credit
- Easy Discord bot deployment
- Auto-restarts on crashes
- Built-in PostgreSQL

**Alternative: Render.com or Fly.io**

---

## Architecture

```
┌─────────────────┐
│  Mini App (FC)  │
│  - Get wallet   │
│  - Get FID      │
│  - Verify btn   │
└────────┬────────┘
         │
         ↓ Discord OAuth
┌─────────────────┐
│  Express API    │
│  /auth/discord  │
│  /callback      │
└────────┬────────┘
         │
    ┌────┴────┐
    ↓         ↓
┌────────┐  ┌──────────┐
│ Viem   │  │ Database │
│ Check  │  │ Store    │
│ NFT    │  │ Mapping  │
└────┬───┘  └──────────┘
     │
     ↓ If holder
┌──────────────┐
│ Discord Bot  │
│ Assign Role  │
└──────────────┘
```

---

## Step-by-Step Implementation

### 1. Set Up Discord Application

1. Go to https://discord.com/developers/applications
2. Click "New Application" → Name it "Protardio Verifier"
3. Go to "Bot" tab:
   - Click "Add Bot"
   - Enable these Privileged Gateway Intents:
     - ✅ SERVER MEMBERS INTENT
     - ✅ MESSAGE CONTENT INTENT (if you want bot commands)
   - Copy the **Bot Token** (keep secret!)
4. Go to "OAuth2" tab:
   - Add redirect URL: `https://your-api.com/auth/discord/callback`
   - Copy **Client ID** and **Client Secret**
5. Go to "OAuth2" → "URL Generator":
   - Scopes: `bot`, `identify`
   - Bot Permissions: `Manage Roles`
   - Copy the generated URL and use it to add bot to your server

### 2. Project Setup

```bash
mkdir protardio-discord-bot
cd protardio-discord-bot
npm init -y
npm install express discord.js viem dotenv better-sqlite3
npm install -D @types/node @types/express tsx typescript
```

**package.json scripts:**
```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

**tsconfig.json:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

**.env file:**
```env
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_client_id_here
DISCORD_CLIENT_SECRET=your_client_secret_here
DISCORD_REDIRECT_URI=https://your-api.com/auth/discord/callback
DISCORD_GUILD_ID=your_server_id_here

PROTARDIO_CONTRACT_ADDRESS=0x...
BASE_RPC_URL=https://mainnet.base.org

PORT=3000
DATABASE_PATH=./data/verifications.db
```

---

### 3. Database Setup

**src/database.ts:**
```typescript
import Database from 'better-sqlite3';
import path from 'path';

const db = new Database(process.env.DATABASE_PATH || './verifications.db');

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
  }
};

export default database;
```

---

### 4. Blockchain Verification

**src/blockchain.ts:**
```typescript
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

const PROTARDIO_CONTRACT = process.env.PROTARDIO_CONTRACT_ADDRESS as `0x${string}`;

const client = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL)
});

// ERC-721 balanceOf ABI
const ERC721_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }]
  }
] as const;

export async function checkProtardioOwnership(wallet: string): Promise<boolean> {
  try {
    const balance = await client.readContract({
      address: PROTARDIO_CONTRACT,
      abi: ERC721_ABI,
      functionName: 'balanceOf',
      args: [wallet as `0x${string}`]
    });

    return balance > 0n;
  } catch (error) {
    console.error('Error checking NFT ownership:', error);
    return false;
  }
}

export async function getProtardioBalance(wallet: string): Promise<number> {
  try {
    const balance = await client.readContract({
      address: PROTARDIO_CONTRACT,
      abi: ERC721_ABI,
      functionName: 'balanceOf',
      args: [wallet as `0x${string}`]
    });

    return Number(balance);
  } catch (error) {
    console.error('Error getting NFT balance:', error);
    return 0;
  }
}
```

---

### 5. Discord Bot

**src/bot.ts:**
```typescript
import { Client, GatewayIntentBits, Guild, GuildMember } from 'discord.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

const GUILD_ID = process.env.DISCORD_GUILD_ID!;
const HOLDER_ROLE_NAME = 'Protardio Holder';

let isReady = false;

client.once('ready', () => {
  console.log(`✅ Discord bot logged in as ${client.user?.tag}`);
  isReady = true;
});

client.on('error', (error) => {
  console.error('Discord bot error:', error);
});

export async function startBot() {
  await client.login(process.env.DISCORD_BOT_TOKEN);
}

export async function assignHolderRole(discordId: string): Promise<boolean> {
  if (!isReady) {
    console.error('Bot not ready yet');
    return false;
  }

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(discordId);
    
    // Find or create the holder role
    let role = guild.roles.cache.find(r => r.name === HOLDER_ROLE_NAME);
    
    if (!role) {
      role = await guild.roles.create({
        name: HOLDER_ROLE_NAME,
        color: 0x9333EA, // Purple color
        reason: 'Protardio holder role'
      });
      console.log(`Created role: ${HOLDER_ROLE_NAME}`);
    }

    // Assign role
    await member.roles.add(role);
    console.log(`✅ Assigned role to ${member.user.tag}`);
    
    return true;
  } catch (error) {
    console.error('Error assigning role:', error);
    return false;
  }
}

export async function removeHolderRole(discordId: string): Promise<boolean> {
  if (!isReady) {
    console.error('Bot not ready yet');
    return false;
  }

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(discordId);
    const role = guild.roles.cache.find(r => r.name === HOLDER_ROLE_NAME);

    if (role && member.roles.cache.has(role.id)) {
      await member.roles.remove(role);
      console.log(`❌ Removed role from ${member.user.tag}`);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Error removing role:', error);
    return false;
  }
}

export { client };
```

---

### 6. Express API Server

**src/index.ts:**
```typescript
import express from 'express';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { startBot, assignHolderRole } from './bot';
import { database } from './database';
import { checkProtardioOwnership, getProtardioBalance } from './blockchain';

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS for mini app
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

const PORT = process.env.PORT || 3000;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID!;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET!;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI!;

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'Protardio Discord Verifier',
    verified_holders: database.getVerifiedCount()
  });
});

// Step 1: Initiate Discord OAuth
// Called from mini app with FID and wallet address
app.get('/auth/discord', (req, res) => {
  const { fid, wallet } = req.query;

  if (!fid || !wallet) {
    return res.status(400).json({ error: 'Missing fid or wallet parameter' });
  }

  // Generate session ID
  const sessionId = crypto.randomBytes(32).toString('hex');

  // Store pending verification
  database.storePending(sessionId, Number(fid), wallet as string);

  // Build Discord OAuth URL
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify',
    state: sessionId // Pass session ID via state parameter
  });

  const discordAuthUrl = `https://discord.com/api/oauth2/authorize?${params.toString()}`;
  
  res.redirect(discordAuthUrl);
});

// Step 2: Discord OAuth callback
app.get('/auth/discord/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!code || !state) {
    return res.status(400).send('Missing code or state parameter');
  }

  const sessionId = state as string;

  try {
    // Get pending verification
    const pending = database.getPending(sessionId);
    
    if (!pending) {
      return res.status(400).send('Invalid or expired session');
    }

    // Exchange code for access token
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: DISCORD_REDIRECT_URI
      }),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    if (!tokenResponse.ok) {
      throw new Error('Failed to exchange code for token');
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Get Discord user info
    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!userResponse.ok) {
      throw new Error('Failed to get Discord user info');
    }

    const discordUser = await userResponse.json();

    // Check if wallet holds Protardio NFT
    console.log(`Checking NFT ownership for wallet: ${pending.wallet}`);
    const holdsNFT = await checkProtardioOwnership(pending.wallet);

    if (holdsNFT) {
      // Get NFT balance
      const balance = await getProtardioBalance(pending.wallet);
      
      console.log(`✅ Wallet holds ${balance} Protardio NFT(s)`);

      // Assign Discord role
      const roleAssigned = await assignHolderRole(discordUser.id);

      if (roleAssigned) {
        // Store verification in database
        database.storeVerification(
          pending.fid,
          pending.wallet,
          discordUser.id,
          discordUser.username
        );

        // Clean up pending verification
        database.deletePending(sessionId);

        // Success page
        return res.send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Verification Successful</title>
            <style>
              body {
                font-family: system-ui;
                max-width: 600px;
                margin: 100px auto;
                text-align: center;
                padding: 20px;
              }
              .success { color: #10b981; font-size: 48px; }
              .title { font-size: 24px; font-weight: bold; margin: 20px 0; }
              .info { color: #666; margin: 10px 0; }
              .button {
                display: inline-block;
                background: #9333ea;
                color: white;
                padding: 12px 24px;
                text-decoration: none;
                border-radius: 8px;
                margin-top: 20px;
              }
            </style>
          </head>
          <body>
            <div class="success">✅</div>
            <div class="title">Verification Successful!</div>
            <div class="info">Discord: ${discordUser.username}</div>
            <div class="info">Protardios Held: ${balance}</div>
            <div class="info">You've been assigned the Protardio Holder role</div>
            <a class="button" href="https://discord.gg/your-invite">Open Discord</a>
          </body>
          </html>
        `);
      } else {
        throw new Error('Failed to assign Discord role');
      }
    } else {
      // User doesn't hold NFT
      database.deletePending(sessionId);
      
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Verification Failed</title>
          <style>
            body {
              font-family: system-ui;
              max-width: 600px;
              margin: 100px auto;
              text-align: center;
              padding: 20px;
            }
            .error { color: #ef4444; font-size: 48px; }
            .title { font-size: 24px; font-weight: bold; margin: 20px 0; }
            .info { color: #666; margin: 10px 0; }
          </style>
        </head>
        <body>
          <div class="error">❌</div>
          <div class="title">No Protardio NFTs Found</div>
          <div class="info">Wallet: ${pending.wallet.slice(0, 6)}...${pending.wallet.slice(-4)}</div>
          <div class="info">You need to hold at least 1 Protardio NFT to verify</div>
        </body>
        </html>
      `);
    }
  } catch (error) {
    console.error('Verification error:', error);
    return res.status(500).send('An error occurred during verification');
  }
});

// API endpoint to check verification status
app.get('/api/verification/:discordId', (req, res) => {
  const { discordId } = req.params;
  const verification = database.getVerificationByDiscord(discordId);

  if (verification) {
    res.json({
      verified: true,
      fid: verification.fid,
      wallet: verification.wallet,
      discord_username: verification.discord_username,
      verified_at: verification.verified_at
    });
  } else {
    res.json({ verified: false });
  }
});

// Stats endpoint
app.get('/api/stats', (req, res) => {
  const verifiedCount = database.getVerifiedCount();
  
  res.json({
    verified_holders: verifiedCount
  });
});

// Start server
async function start() {
  try {
    // Start Discord bot
    await startBot();
    
    // Start Express server
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📍 Callback URL: ${DISCORD_REDIRECT_URI}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
```

---

### 7. Mini App Integration

**In your Farcaster mini app frontend:**

```typescript
// components/VerifyDiscord.tsx
import { useAccount } from 'wagmi';
import sdk from '@farcaster/frame-sdk';

export function VerifyDiscordButton() {
  const { address } = useAccount();
  const [fid, setFid] = useState<number | null>(null);

  useEffect(() => {
    // Get FID from Farcaster context
    sdk.context.then(ctx => {
      setFid(ctx.user.fid);
    });
  }, []);

  const handleVerify = () => {
    if (!address || !fid) {
      alert('Please connect your wallet first');
      return;
    }

    // Open verification flow
    const verifyUrl = `https://your-api.com/auth/discord?fid=${fid}&wallet=${address}`;
    window.open(verifyUrl, '_blank', 'width=500,height=700');
  };

  return (
    <button
      onClick={handleVerify}
      className="bg-purple-600 text-white px-6 py-3 rounded-lg"
    >
      🔗 Verify Discord
    </button>
  );
}
```

---

## Deployment

### Option 1: Railway (Recommended)

1. Push code to GitHub
2. Go to railway.app
3. Click "New Project" → "Deploy from GitHub repo"
4. Add environment variables
5. Railway will auto-deploy on push

### Option 2: Render.com

1. Connect GitHub repo
2. Create "Web Service"
3. Build command: `npm install && npm run build`
4. Start command: `npm start`
5. Add environment variables

### Option 3: Self-hosted (VPS)

```bash
# On your server
git clone your-repo
cd protardio-discord-bot
npm install
npm run build

# Use PM2 to keep it running
npm install -g pm2
pm2 start dist/index.js --name protardio-bot
pm2 save
pm2 startup
```

---

## Testing

### Local Testing

1. Use ngrok for local callback URL:
```bash
ngrok http 3000
# Use the ngrok URL as DISCORD_REDIRECT_URI
```

2. Update Discord app redirect URI to ngrok URL

3. Run bot:
```bash
npm run dev
```

4. Test flow:
   - Visit `http://localhost:3000/auth/discord?fid=123&wallet=0x...`
   - Complete Discord OAuth
   - Check if role was assigned

---

## Advanced Features (Optional)

### 1. Periodic Re-verification

**src/reverify.ts:**
```typescript
import { database } from './database';
import { checkProtardioOwnership } from './blockchain';
import { removeHolderRole } from './bot';

export async function reverifyAllHolders() {
  console.log('Starting re-verification...');
  const verifications = database.getAllVerifications();

  for (const v of verifications) {
    const stillHolds = await checkProtardioOwnership(v.wallet);

    if (!stillHolds) {
      console.log(`❌ ${v.discord_username} no longer holds NFT`);
      await removeHolderRole(v.discord_id);
      // Optionally delete from DB or mark as inactive
    } else {
      console.log(`✅ ${v.discord_username} still holds NFT`);
    }
  }
}

// Run daily
setInterval(reverifyAllHolders, 24 * 60 * 60 * 1000);
```

### 2. Tiered Roles Based on NFT Count

```typescript
async function assignTieredRole(discordId: string, balance: number) {
  const guild = await client.guilds.fetch(GUILD_ID);
  const member = await guild.members.fetch(discordId);

  let roleName = 'Protardio Holder';
  
  if (balance >= 10) {
    roleName = 'Protardio Whale';
  } else if (balance >= 5) {
    roleName = 'Protardio Collector';
  }

  const role = guild.roles.cache.find(r => r.name === roleName);
  if (role) {
    await member.roles.add(role);
  }
}
```

### 3. Discord Commands

```typescript
// In src/bot.ts
import { Events } from 'discord.js';

client.on(Events.MessageCreate, async (message) => {
  if (message.content === '!verify') {
    const verification = database.getVerificationByDiscord(message.author.id);
    
    if (verification) {
      message.reply(`✅ You're verified! Wallet: ${verification.wallet.slice(0, 6)}...${verification.wallet.slice(-4)}`);
    } else {
      message.reply('❌ Not verified. Visit the mini app to verify.');
    }
  }
});
```

---

## Security Considerations

1. **Never expose bot token** - Keep in .env, never commit
2. **Validate all inputs** - FID, wallet addresses, Discord IDs
3. **Rate limiting** - Add rate limiting to prevent abuse:
```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5 // 5 requests per IP
});

app.use('/auth/discord', limiter);
```

4. **Session expiration** - Clean up old pending verifications:
```typescript
// Delete pending verifications older than 1 hour
setInterval(() => {
  db.exec(`
    DELETE FROM pending_verifications 
    WHERE created_at < datetime('now', '-1 hour')
  `);
}, 60 * 60 * 1000);
```

5. **HTTPS only** - Always use HTTPS in production

---

## Troubleshooting

### Bot Not Assigning Roles
- Check bot has "Manage Roles" permission
- Bot's role must be ABOVE the role it's trying to assign
- Check GUILD_ID is correct

### OAuth Redirect Not Working
- Verify DISCORD_REDIRECT_URI exactly matches Discord app settings
- Check it's using HTTPS in production
- Make sure server is publicly accessible

### NFT Check Failing
- Verify PROTARDIO_CONTRACT_ADDRESS is correct
- Check BASE_RPC_URL is working
- Test with a known holder's wallet

### Database Locked Error
- SQLite doesn't handle concurrent writes well
- Consider upgrading to PostgreSQL for production

---

## Monitoring & Maintenance

### Logs to Monitor
- Verification attempts (success/failure)
- Role assignments
- NFT ownership checks
- Discord API errors

### Metrics to Track
- Verification success rate
- Average verification time
- Total verified holders
- Failed verification reasons

### Regular Tasks
- Daily: Check bot is online
- Weekly: Review error logs
- Monthly: Re-verify all holders

---

## Cost Breakdown

- **Railway/Render**: $5-10/month
- **Domain** (optional): $10/year
- **RPC calls**: Free (Base RPC has generous limits)
- **Discord bot**: Free

**Total**: ~$5-10/month

---

## Summary

This bot provides a seamless verification experience:
1. ✅ No MetaMask popups needed
2. ✅ Works with Farcaster-connected wallets
3. ✅ Automatic role assignment
4. ✅ Tracks all verifications
5. ✅ Can re-verify periodically
6. ✅ Extensible for more features

**Next Steps:**
1. Set up Discord application
2. Clone this code structure
3. Add your contract address
4. Deploy to Railway
5. Test with a holder wallet
6. Launch! 🚀
