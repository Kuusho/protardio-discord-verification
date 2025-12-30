# How to Build Protardio Discord Verification Bot

## Overview

Build a custom Discord verification bot that allows Farcaster users to verify their Protardio NFT ownership and get Discord roles **without requiring MetaMask popups**. The bot integrates directly with your Farcaster mini app where wallets are already connected.

**Key Innovation:** Traditional token-gating tools (Guild.xyz, Collab.Land) require MetaMask/WalletConnect. This bot uses wallets already connected in Farcaster, providing a seamless verification experience.

---

## Two-Tier Verification System

To prevent Sybil attacks and ensure only real holders get access, we use **two separate verification flows**:

### **Tier 1: Anti-Sybil Verification**
- **Purpose:** Prove "I am a real person with this Discord account"
- **Tool:** Verify.xyz, Otter.app, or Boring.xyz
- **Role Assigned:** "Verified Human"
- **Access:** Can chat in #general-chat but not holder channels

### **Tier 2: NFT Holder Verification**
- **Purpose:** Prove "I own Protardio NFT with this wallet"
- **Tool:** Your custom bot (this guide)
- **Role Assigned:** "Protardio Holder"
- **Access:** All holder channels

---

## Core User Flow

```
STEP 1: Anti-Sybil Verification (In Discord)
──────────────────────────────────────────
1. User joins Discord server
2. Can only see #welcome and #verify-here
3. User completes anti-sybil verification (Verify.xyz or similar)
4. Gets "Verified Human" role
5. Can now chat in #general-chat and #introductions

STEP 2: NFT Holder Verification (In Mini App)
──────────────────────────────────────────────
1. User opens Protardio mini app (wallet already connected via Farcaster)

2. User clicks "Link Discord Account" button
   ├─> Discord OAuth popup appears IN the mini app (iframe/popup)
   ├─> User authorizes: "Let Protardio access your Discord"
   ├─> Backend stores mapping: FID ↔ Wallet ↔ Discord ID
   └─> Confirmation shown: "Linked to @username"

3. User clicks "Verify NFT Ownership" button
   ├─> Backend retrieves linked Discord account
   ├─> Backend checks: Does this wallet hold Protardio NFT?
   └─> Result:
       IF YES:
         ├─> Bot assigns "Protardio Holder" role in Discord
         ├─> All holder channels become visible
         └─> Success message in mini app
       IF NO:
         └─> Error message: "No Protardio NFTs found"
```

**Critical Security Feature:** Users must LINK their Discord account FIRST, then verify. This prevents the attack where someone with an NFT could verify someone else's Discord account.

---

## Why This Solves Your Original Problem

**The Problem:** Traditional token-gating requires MetaMask/WalletConnect, but your users have wallets already connected in Farcaster.

**The Solution:**
1. ✅ No MetaMask popup needed - uses Farcaster-connected wallet
2. ✅ OAuth happens in mini app iframe/popup - user never leaves Farcaster
3. ✅ Backend gets wallet address from mini app context, not user input
4. ✅ Links FID ↔ Wallet ↔ Discord for security
5. ✅ Two-tier verification prevents Sybil attacks

**User experience:**
- Opens mini app (wallet already connected)
- Clicks "Link Discord" → OAuth popup → Done
- Clicks "Verify NFT" → Backend checks blockchain → Role assigned
- No separate website, no MetaMask, no manual input

---

## Discord Server Structure

```
📢 PUBLIC (Everyone can see)
  ├─ #welcome (read-only)
  └─ #verify-here (instructions)

🔐 VERIFIED HUMANS (Need "Verified Human" role)
  ├─ #general-chat
  └─ #introductions

🟪 PROTARDIO HOLDERS (Need "Protardio Holder" role)
  ├─ #announcements (read-only)
  ├─ #holder-chat
  ├─ #alpha
  ├─ #raids
  ├─ #memes
  ├─ #farcaster-feed (auto-posted, read-only)
  └─ #feedback
```

---

## Tech Stack

### Backend
- **Framework:** Express.js (Node.js)
- **Discord Library:** discord.js v14
- **Blockchain:** viem (for Base network)
- **Database:** SQLite (better-sqlite3) or PostgreSQL
- **Deployment:** Railway.app or Render.com

### Installation
```bash
npm install express discord.js viem dotenv better-sqlite3
npm install -D @types/node @types/express tsx typescript
```

---

## Architecture

```
┌─────────────────────┐
│  Mini App (FC)      │
│  - Get wallet       │
│  - Get FID          │
│  - Link Discord btn │
│  - Verify btn       │
└──────────┬──────────┘
           │
           ↓ Discord OAuth
┌──────────────────────┐
│  Express API         │
│  /link-discord       │
│  /verify-holder      │
│  /auth/callback      │
└──────────┬───────────┘
           │
      ┌────┴────┐
      ↓         ↓
┌──────────┐  ┌──────────────┐
│ Viem     │  │ Database     │
│ Check    │  │ - Links      │
│ NFT      │  │ - Verifications │
└────┬─────┘  └──────────────┘
     │
     ↓ If holder
┌─────────────────┐
│ Discord Bot     │
│ Assign Role     │
└─────────────────┘
```

---

## Implementation

### 1. Discord Bot Setup

**Discord Developer Portal:**
1. Create application: https://discord.com/developers/applications
2. Enable Bot with these intents:
   - ✅ SERVER MEMBERS INTENT
   - ✅ MESSAGE CONTENT INTENT (optional)
3. Get Bot Token (keep secret)
4. Set OAuth2 redirect: `https://your-api.com/auth/discord/callback`
5. Get Client ID and Client Secret
6. Add bot to server with Administrator permission

**Environment Variables (.env):**
```env
DISCORD_BOT_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_client_id
DISCORD_CLIENT_SECRET=your_client_secret
DISCORD_REDIRECT_URI=https://your-api.com/auth/discord/callback
DISCORD_GUILD_ID=your_server_id

PROTARDIO_CONTRACT_ADDRESS=0x...
BASE_RPC_URL=https://mainnet.base.org

PORT=3000
DATABASE_PATH=./data/verifications.db
```

### 2. Database Schema

```typescript
// Two tables: discord_links and verifications

CREATE TABLE discord_links (
  id INTEGER PRIMARY KEY,
  fid INTEGER NOT NULL,
  wallet TEXT NOT NULL,
  discord_id TEXT UNIQUE NOT NULL,
  discord_username TEXT,
  linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE verifications (
  id INTEGER PRIMARY KEY,
  discord_id TEXT UNIQUE NOT NULL,
  wallet TEXT NOT NULL,
  fid INTEGER NOT NULL,
  nft_balance INTEGER NOT NULL,
  verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_checked TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 3. API Endpoints

**Link Discord Account:**
```
GET /link-discord?fid={fid}&wallet={address}
├─> Redirects to Discord OAuth
└─> State includes FID and wallet
```

**OAuth Callback:**
```
GET /auth/discord/callback?code={code}&state={state}
├─> Exchange code for Discord access token
├─> Get Discord user info
├─> Store link: FID ↔ Wallet ↔ Discord ID
└─> Return success page
```

**Verify NFT Ownership:**
```
POST /verify-holder
Body: { fid, wallet }
├─> Get linked Discord account
├─> Check NFT ownership on-chain
├─> If owns NFT: Assign Discord role
└─> Store verification record
```

### 4. Blockchain Verification (viem)

```typescript
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

const client = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL)
});

const ERC721_ABI = [{
  name: 'balanceOf',
  type: 'function',
  inputs: [{ name: 'owner', type: 'address' }],
  outputs: [{ name: 'balance', type: 'uint256' }]
}];

async function checkProtardioOwnership(wallet: string): Promise<boolean> {
  const balance = await client.readContract({
    address: PROTARDIO_CONTRACT,
    abi: ERC721_ABI,
    functionName: 'balanceOf',
    args: [wallet as `0x${string}`]
  });
  
  return balance > 0n;
}
```

### 5. Discord Bot (discord.js)

```typescript
import { Client, GatewayIntentBits } from 'discord.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

async function assignHolderRole(discordId: string): Promise<boolean> {
  const guild = await client.guilds.fetch(GUILD_ID);
  const member = await guild.members.fetch(discordId);
  
  let role = guild.roles.cache.find(r => r.name === 'Protardio Holder');
  
  if (!role) {
    role = await guild.roles.create({
      name: 'Protardio Holder',
      color: 0x9333EA,
      reason: 'NFT holder role'
    });
  }
  
  await member.roles.add(role);
  return true;
}
```

### 6. Mini App Integration

```typescript
// In your Farcaster mini app
import { useAccount } from 'wagmi';
import sdk from '@farcaster/frame-sdk';

function DiscordVerification() {
  const { address } = useAccount();
  const [fid, setFid] = useState(null);
  const [linkedDiscord, setLinkedDiscord] = useState(null);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    sdk.context.then(ctx => setFid(ctx.user.fid));
    
    // Listen for Discord link completion
    window.addEventListener('message', (event) => {
      if (event.data.type === 'discord-linked') {
        setLinkedDiscord(event.data.discord);
      }
    });
  }, []);

  const handleLinkDiscord = () => {
    const linkUrl = `https://your-api.com/link-discord?fid=${fid}&wallet=${address}`;
    window.open(linkUrl, 'discord-link', 'width=500,height=700');
  };

  const handleVerifyNFT = async () => {
    const response = await fetch('https://your-api.com/verify-holder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fid, wallet: address })
    });
    
    const data = await response.json();
    if (data.success) setVerified(true);
  };

  return (
    <div>
      {!linkedDiscord ? (
        <button onClick={handleLinkDiscord}>
          1️⃣ Link Discord Account
        </button>
      ) : !verified ? (
        <button onClick={handleVerifyNFT}>
          2️⃣ Verify NFT Ownership
        </button>
      ) : (
        <p>✅ Verified Holder!</p>
      )}
    </div>
  );
}
```

---

## Automated Server Setup

**Don't want to manually create channels?** Use the automated setup script!

See `discord-setup-script.ts` for complete automation.

**What it does:**
- ✅ Creates all roles (Verified Human, Protardio Holder)
- ✅ Creates all categories (Public, Verified Humans, Holders)
- ✅ Creates all channels with proper permissions
- ✅ Sets up webhooks for Farcaster feed
- ✅ Pins welcome messages
- ✅ Configures read-only channels

**To use:**
1. Give bot Administrator permissions
2. Run: `npm run setup`
3. Done! Entire server is configured

**Be lazy! The bot does everything for you. 🎉**

---

## Security Features

### 1. Two-Tier Verification
- Anti-sybil bot prevents fake accounts
- Custom bot verifies NFT ownership
- Both required for full access

### 2. Discord Link Enforcement
- Users MUST link Discord before verifying
- Prevents verifying someone else's account
- One wallet → One Discord account

### 3. FID Verification
- Ensures Farcaster account matches
- Prevents cross-account attacks

### 4. Rate Limiting
```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5
});

app.use('/link-discord', limiter);
app.use('/verify-holder', limiter);
```

### 5. Re-verification (Optional)
```typescript
// Periodically check if holders still own NFTs
setInterval(async () => {
  const verifications = database.getAllVerifications();
  for (const v of verifications) {
    const stillHolds = await checkProtardioOwnership(v.wallet);
    if (!stillHolds) {
      await removeHolderRole(v.discord_id);
      database.deleteVerification(v.discord_id);
    }
  }
}, 24 * 60 * 60 * 1000); // Daily
```

---

## Deployment

### Railway (Recommended)
1. Push code to GitHub
2. Connect to Railway.app
3. Add environment variables
4. Auto-deploy on push

### Render
1. Connect GitHub repo
2. Create "Web Service"
3. Build: `npm install && npm run build`
4. Start: `npm start`

### Self-Hosted
```bash
git clone your-repo
cd protardio-discord-bot
npm install && npm run build

# Use PM2
npm install -g pm2
pm2 start dist/index.js --name protardio-bot
pm2 save && pm2 startup
```

---

## Advanced Features

### 1. Tiered Roles
```typescript
if (balance >= 10) {
  roleName = 'Protardio Whale 🐋';
} else if (balance >= 5) {
  roleName = 'Protardio Collector 💎';
}
```

### 2. Discord Slash Commands
```typescript
client.on('interactionCreate', async interaction => {
  if (interaction.commandName === 'verify') {
    // Send verification instructions
  }
  
  if (interaction.commandName === 'status') {
    // Show verification status
  }
  
  if (interaction.commandName === 'stats') {
    // Show holder statistics
  }
});
```

### 3. Farcaster Feed Integration
```typescript
// Post to Discord webhook when specific users cast
async function postToFarcaster(cast) {
  await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: cast.author.username,
      avatar_url: cast.author.pfp_url,
      embeds: [{
        description: cast.text,
        url: cast.url
      }]
    })
  });
}
```

---

## Troubleshooting

### Bot Not Assigning Roles
- Check bot has "Manage Roles" or Administrator permission
- Bot's role must be ABOVE "Protardio Holder" role
- Verify GUILD_ID is correct

### OAuth Redirect Failing
- DISCORD_REDIRECT_URI must exactly match Discord app settings
- Must use HTTPS in production
- Use ngrok for local testing

### NFT Check Failing
- Verify PROTARDIO_CONTRACT_ADDRESS is correct
- Check BASE_RPC_URL is accessible
- Test with known holder wallet

### Database Issues
- SQLite doesn't handle high concurrency well
- Consider PostgreSQL for production
- Ensure database file is writable

---

## Cost Breakdown

- **Hosting:** $0-10/month (Railway/Render free tier)
- **RPC calls:** Free (Base has generous limits)
- **Discord bot:** Free
- **Anti-sybil bot:** Free (Verify.xyz)
- **Domain:** $10/year (optional)

**Total:** ~$0-10/month

---

## Monitoring

### Key Metrics
- Link conversion rate (links → verifications)
- Verification success rate
- Total verified holders
- Failed verification reasons

### Logs to Monitor
- Verification attempts
- Role assignments
- NFT ownership checks
- Discord API errors

### Maintenance
- **Daily:** Check bot is online
- **Weekly:** Review verification stats
- **Monthly:** Re-verify holders (optional)

---

## Summary

This bot provides a complete verification solution:

✅ **Sybil Resistant** - Two-tier verification prevents fake accounts  
✅ **No MetaMask** - Works with Farcaster wallets  
✅ **Secure** - Link Discord first, then verify  
✅ **Automated** - Setup script creates entire server structure  
✅ **Scalable** - Handles thousands of verifications  
✅ **Easy Integration** - Simple mini app buttons  

**The Flow:**
1. User verifies they're human (Discord)
2. User links Discord (Mini app)
3. User verifies NFT (Mini app)
4. Bot assigns role automatically
5. User gets holder access

**Next Steps:**
1. Set up Discord bot application
2. Copy code structure from this guide
3. Add your Protardio contract address
4. Run automated setup script
5. Deploy to Railway/Render
6. Add anti-sybil bot (Verify.xyz)
7. Test with holder wallet
8. Launch! 🚀

---

## Quick Reference Commands

```bash
# Setup
npm install
npm run setup  # Automated Discord setup

# Development
npm run dev

# Production
npm run build
npm start

# Deploy
git push origin main  # Auto-deploys on Railway/Render
```

---

## Files Structure

```
protardio-discord-bot/
├── src/
│   ├── index.ts          # Main Express server
│   ├── bot.ts            # Discord bot
│   ├── database.ts       # Database queries
│   ├── blockchain.ts     # NFT verification
│   └── setup.ts          # Automated setup script
├── .env                  # Environment variables
├── package.json
└── tsconfig.json
```

---

**Questions? Issues? Check the troubleshooting section or review logs for specific errors.**

**Ready to build! 🚀**
