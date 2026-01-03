import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { startBot, assignHolderRole, removeHolderRole } from './bot';
import { supabaseDatabase } from './supabase-database';
import { checkProtardioOwnership, getProtardioBalance } from './blockchain';
import { getFarcasterWallets, passesSybilCheck, calculateSybilScore, getFarcasterUser } from './neynar';

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

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per IP
  message: 'Too many verification attempts, please try again later'
});

const PORT = process.env.PORT || 3000;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID!;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET!;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI!;

// Health check
app.get('/', async (req: Request, res: Response) => {
  const verifiedCount = await supabaseDatabase.getVerifiedCount();
  res.json({
    status: 'ok',
    service: 'Protardio Discord Verifier',
    verified_holders: verifiedCount
  });
});

// Step 1: Initiate Discord OAuth
// Called from mini app with FID and wallet address
app.get('/auth/discord', authLimiter, async (req: Request, res: Response) => {
  const { fid, wallet } = req.query;

  if (!fid || !wallet) {
    res.status(400).json({ error: 'Missing fid or wallet parameter' });
    return;
  }

  // Validate wallet address format
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet as string)) {
    res.status(400).json({ error: 'Invalid wallet address format' });
    return;
  }

  // Generate session ID
  const sessionId = crypto.randomBytes(32).toString('hex');

  // Store pending verification
  await supabaseDatabase.storePending(sessionId, Number(fid), wallet as string);

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

// Step 2: Discord OAuth callback with multi-wallet verification
app.get('/auth/discord/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query;

  if (!code || !state) {
    res.status(400).send(renderErrorPage('Missing code or state parameter'));
    return;
  }

  const sessionId = state as string;

  try {
    // Get pending verification from Supabase
    const pending = await supabaseDatabase.getPending(sessionId);

    if (!pending) {
      res.status(400).send(renderErrorPage('Invalid or expired session'));
      return;
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

    const tokenData = await tokenResponse.json() as { access_token: string };
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

    const discordUser = await userResponse.json() as { id: string; username: string };

    // === MULTI-WALLET VERIFICATION ===
    // Get ALL wallets linked to this Farcaster account
    console.log(`Fetching all wallets for FID: ${pending.fid}`);
    const farcasterWallets = await getFarcasterWallets(pending.fid);

    // Also include the wallet they submitted (in case it's not linked yet)
    const allWallets = [...new Set([pending.wallet.toLowerCase(), ...farcasterWallets])];
    console.log(`Checking ${allWallets.length} wallet(s):`, allWallets);

    // Check each wallet for NFT ownership
    let totalBalance = 0;
    let holdingWallet: string | null = null;

    for (const wallet of allWallets) {
      const balance = await getProtardioBalance(wallet);
      if (balance > 0) {
        totalBalance += balance;
        if (!holdingWallet) holdingWallet = wallet;
      }
    }

    console.log(`Total Protardio balance across all wallets: ${totalBalance}`);

    if (totalBalance > 0 && holdingWallet) {
      // === SYBIL CHECK ===
      const sybilScore = await calculateSybilScore(pending.fid);
      const fcUser = await getFarcasterUser(pending.fid);
      console.log(`Sybil score for FID ${pending.fid}: ${sybilScore}`);

      // Assign Discord role
      const roleAssigned = await assignHolderRole(discordUser.id);

      if (roleAssigned) {
        // Store verification in Supabase
        await supabaseDatabase.storeVerification(
          pending.fid,
          holdingWallet,
          discordUser.id,
          discordUser.username,
          totalBalance
        );

        // Clean up pending verification
        await supabaseDatabase.deletePending(sessionId);

        // Success page
        res.send(renderSuccessPage(
          discordUser.username,
          totalBalance,
          fcUser?.username || `FID ${pending.fid}`,
          sybilScore
        ));
        return;
      } else {
        res.send(renderErrorPage('Failed to assign Discord role. Make sure you\'ve joined the server first!'));
        return;
      }
    } else {
      // User doesn't hold NFT in any wallet
      await supabaseDatabase.deletePending(sessionId);

      res.send(renderNoNFTPage(allWallets));
      return;
    }
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).send(renderErrorPage('An error occurred during verification'));
    return;
  }
});

// HTML page renderers
function renderSuccessPage(discordUsername: string, balance: number, fcUsername: string, sybilScore: number): string {
  const scoreColor = sybilScore >= 50 ? '#10b981' : sybilScore >= 25 ? '#f59e0b' : '#ef4444';
  const scoreLabel = sybilScore >= 50 ? 'High Trust' : sybilScore >= 25 ? 'Medium Trust' : 'Low Trust';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Verification Successful</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body {
          font-family: system-ui, -apple-system, sans-serif;
          max-width: 600px;
          margin: 100px auto;
          text-align: center;
          padding: 20px;
          background: #0f0f0f;
          color: #fff;
        }
        .success { color: #10b981; font-size: 64px; }
        .title { font-size: 24px; font-weight: bold; margin: 20px 0; }
        .info { color: #999; margin: 10px 0; }
        .score { color: ${scoreColor}; font-weight: bold; }
        .button {
          display: inline-block;
          background: #9333ea;
          color: white;
          padding: 12px 24px;
          text-decoration: none;
          border-radius: 8px;
          margin-top: 20px;
          font-weight: 500;
        }
        .button:hover { background: #7c22ce; }
      </style>
    </head>
    <body>
      <div class="success">&#10003;</div>
      <div class="title">Verification Successful!</div>
      <div class="info">Discord: ${discordUsername}</div>
      <div class="info">Farcaster: @${fcUsername}</div>
      <div class="info">Protardios Held: ${balance}</div>
      <div class="info">Trust Score: <span class="score">${sybilScore}/100 (${scoreLabel})</span></div>
      <div class="info" style="margin-top: 20px;">You've been assigned the Protardio Citizen role</div>
      <a class="button" href="https://discord.com/channels/${process.env.DISCORD_GUILD_ID}">Open Discord</a>
    </body>
    </html>
  `;
}

function renderNoNFTPage(wallets: string[]): string {
  const walletList = wallets.map(w => `${w.slice(0, 6)}...${w.slice(-4)}`).join(', ');
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Verification Failed</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body {
          font-family: system-ui, -apple-system, sans-serif;
          max-width: 600px;
          margin: 100px auto;
          text-align: center;
          padding: 20px;
          background: #0f0f0f;
          color: #fff;
        }
        .error { color: #ef4444; font-size: 64px; }
        .title { font-size: 24px; font-weight: bold; margin: 20px 0; }
        .info { color: #999; margin: 10px 0; }
      </style>
    </head>
    <body>
      <div class="error">&#10007;</div>
      <div class="title">No Protardio NFTs Found</div>
      <div class="info">Checked ${wallets.length} wallet(s): ${walletList}</div>
      <div class="info">You need to hold at least 1 Protardio NFT to verify</div>
      <p style="margin-top: 30px; color: #666;">You can close this window now.</p>
    </body>
    </html>
  `;
}

function renderErrorPage(message: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Verification Error</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body {
          font-family: system-ui, -apple-system, sans-serif;
          max-width: 600px;
          margin: 100px auto;
          text-align: center;
          padding: 20px;
          background: #0f0f0f;
          color: #fff;
        }
        .error { color: #ef4444; font-size: 64px; }
        .title { font-size: 24px; font-weight: bold; margin: 20px 0; }
        .info { color: #999; margin: 10px 0; }
      </style>
    </head>
    <body>
      <div class="error">&#10007;</div>
      <div class="title">Verification Error</div>
      <div class="info">${message}</div>
      <p style="margin-top: 30px; color: #666;">You can close this window now.</p>
    </body>
    </html>
  `;
}

// API endpoint to check verification status
app.get('/api/verification/:discordId', async (req: Request, res: Response) => {
  const { discordId } = req.params;
  const verification = await supabaseDatabase.getVerificationByDiscord(discordId);

  if (verification) {
    res.json({
      verified: true,
      fid: verification.fid,
      wallet: verification.wallet,
      discord_username: verification.discord_username,
      nft_balance: verification.nft_balance,
      verified_at: verification.verified_at,
      last_checked: verification.last_checked
    });
  } else {
    res.json({ verified: false });
  }
});

// Stats endpoint
app.get('/api/stats', async (req: Request, res: Response) => {
  const verifiedCount = await supabaseDatabase.getVerifiedCount();

  res.json({
    verified_holders: verifiedCount
  });
});

// Cleanup old pending verifications every hour
setInterval(async () => {
  const cleaned = await supabaseDatabase.cleanupOldPending();
  console.log(`Cleaned up ${cleaned} old pending verifications`);
}, 60 * 60 * 1000);

// Re-verify holders every 6 hours (check if they still hold NFTs)
setInterval(async () => {
  console.log('Starting periodic re-verification of holders...');
  const staleVerifications = await supabaseDatabase.getStaleVerifications();

  for (const verification of staleVerifications) {
    try {
      // Get all wallets for this user
      const farcasterWallets = await getFarcasterWallets(verification.fid);
      const allWallets = [...new Set([verification.wallet.toLowerCase(), ...farcasterWallets])];

      // Check total balance
      let totalBalance = 0;
      for (const wallet of allWallets) {
        totalBalance += await getProtardioBalance(wallet);
      }

      if (totalBalance === 0) {
        // User no longer holds NFT - remove role
        console.log(`User ${verification.discord_id} no longer holds NFT, removing role...`);
        await removeHolderRole(verification.discord_id);
        await supabaseDatabase.deleteVerification(verification.discord_id);
      } else {
        // Update balance
        await supabaseDatabase.updateNftBalance(verification.discord_id, totalBalance);
      }
    } catch (error) {
      console.error(`Error re-verifying ${verification.discord_id}:`, error);
    }
  }
  console.log(`Re-verification complete. Checked ${staleVerifications.length} users.`);
}, 6 * 60 * 60 * 1000);

// Start server
async function start() {
  try {
    // Start Discord bot
    await startBot();

    // Start Express server
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Callback URL: ${DISCORD_REDIRECT_URI}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
