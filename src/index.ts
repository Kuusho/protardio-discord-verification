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
  max: 200, // 200 requests per IP
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
    scope: 'identify guilds.join',
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

    // === AUTO-JOIN USER TO SERVER ===
    const guildId = process.env.DISCORD_GUILD_ID!;
    try {
      await fetch(`https://discord.com/api/guilds/${guildId}/members/${discordUser.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          access_token: accessToken
        })
      });
      console.log(`Added/confirmed user ${discordUser.username} in guild`);
    } catch (joinError) {
      console.log('User may already be in guild or join failed:', joinError);
    }

    // === MULTI-WALLET VERIFICATION ===
    // Get ALL wallets linked to this Farcaster account (if FID provided)
    console.log(`Fetching all wallets for FID: ${pending.fid}`);
    const farcasterWallets = pending.fid > 0 ? await getFarcasterWallets(pending.fid) : [];

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
      // === CHECK IF FID ALREADY USED (skip for wallet-only users) ===
      if (pending.fid > 0) {
        const existingFidVerification = await supabaseDatabase.getVerificationByFid(pending.fid);
        if (existingFidVerification && existingFidVerification.discord_id !== discordUser.id) {
          await supabaseDatabase.deletePending(sessionId);
          res.send(renderErrorPage(
            `This Farcaster account (FID ${pending.fid}) is already linked to another Discord account (${existingFidVerification.discord_username}). Each Farcaster account can only verify one Discord account.`
          ));
          return;
        }
      }

      // === CHECK IF WALLET ALREADY USED ===
      const existingVerification = await supabaseDatabase.getVerificationByWallet(holdingWallet);
      if (existingVerification && existingVerification.discord_id !== discordUser.id) {
        await supabaseDatabase.deletePending(sessionId);
        res.send(renderErrorPage(
          `This wallet is already linked to another Discord account (${existingVerification.discord_username}). Each wallet can only verify one account.`
        ));
        return;
      }

      // === SYBIL CHECK (skip for wallet-only users) ===
      const sybilScore = pending.fid > 0 ? await calculateSybilScore(pending.fid) : 0;
      const fcUser = pending.fid > 0 ? await getFarcasterUser(pending.fid) : null;
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
        const displayName = pending.fid > 0
          ? (fcUser?.username || `FID ${pending.fid}`)
          : `Wallet ${holdingWallet.slice(0, 6)}...${holdingWallet.slice(-4)}`;
        res.send(renderSuccessPage(
          discordUser.username,
          totalBalance,
          displayName,
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

// Farcaster verification from Discord button
app.get('/verify', authLimiter, async (req: Request, res: Response) => {
  const { discord_id } = req.query;

  if (!discord_id || !/^\d{17,20}$/.test(discord_id as string)) {
    res.status(400).send(renderErrorPage('Invalid or missing Discord ID'));
    return;
  }

  res.send(renderFarcasterVerifyPage(discord_id as string));
});

app.post('/verify', authLimiter, async (req: Request, res: Response) => {
  const { discord_id, fid, wallet } = req.body;

  // Validate discord_id
  if (!discord_id || !/^\d{17,20}$/.test(discord_id)) {
    res.status(400).send(renderErrorPage('Invalid Discord ID'));
    return;
  }

  // Validate FID
  const fidNum = parseInt(fid, 10);
  if (!fid || isNaN(fidNum) || fidNum < 1) {
    res.send(renderFarcasterVerifyPage(discord_id, 'Please enter a valid Farcaster ID'));
    return;
  }

  // Validate wallet if provided
  let walletAddress = wallet?.trim() || '';
  if (walletAddress && !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    res.send(renderFarcasterVerifyPage(discord_id, 'Invalid wallet address format'));
    return;
  }

  // If no wallet provided, try to get one from Farcaster
  if (!walletAddress) {
    const farcasterWallets = await getFarcasterWallets(fidNum);
    if (farcasterWallets.length > 0) {
      walletAddress = farcasterWallets[0];
    } else {
      res.send(renderFarcasterVerifyPage(discord_id, 'No wallets found for this FID. Please enter a wallet address.'));
      return;
    }
  }

  // Generate session and store pending verification
  const sessionId = crypto.randomBytes(32).toString('hex');
  await supabaseDatabase.storePending(sessionId, fidNum, walletAddress);

  // Redirect to Discord OAuth
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds.join',
    state: sessionId
  });

  res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});

// Wallet verification from Discord button
app.get('/auth/wallet-connect', authLimiter, async (req: Request, res: Response) => {
  const { discord_id } = req.query;

  if (!discord_id || !/^\d{17,20}$/.test(discord_id as string)) {
    res.status(400).send(renderErrorPage('Invalid or missing Discord ID'));
    return;
  }

  res.send(renderWalletVerifyPage(discord_id as string));
});

app.post('/auth/wallet-connect', authLimiter, async (req: Request, res: Response) => {
  const { discord_id, wallet } = req.body;

  // Validate discord_id
  if (!discord_id || !/^\d{17,20}$/.test(discord_id)) {
    res.status(400).send(renderErrorPage('Invalid Discord ID'));
    return;
  }

  // Validate wallet
  const walletAddress = wallet?.trim() || '';
  if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    res.send(renderWalletVerifyPage(discord_id, 'Please enter a valid wallet address'));
    return;
  }

  // Generate session and store pending verification with fid=0 for wallet-only
  const sessionId = crypto.randomBytes(32).toString('hex');
  await supabaseDatabase.storePending(sessionId, 0, walletAddress);

  // Redirect to Discord OAuth
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds.join',
    state: sessionId
  });

  res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
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

function renderFarcasterVerifyPage(discordId: string, error?: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Verify with Farcaster</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body {
          font-family: system-ui, -apple-system, sans-serif;
          max-width: 400px;
          margin: 80px auto;
          padding: 20px;
          background: #0f0f0f;
          color: #fff;
        }
        .title { font-size: 24px; font-weight: bold; margin-bottom: 10px; text-align: center; }
        .subtitle { color: #999; margin-bottom: 30px; text-align: center; font-size: 14px; }
        .form-group { margin-bottom: 20px; }
        label { display: block; margin-bottom: 8px; color: #ccc; font-size: 14px; }
        input {
          width: 100%;
          padding: 12px;
          border: 1px solid #333;
          border-radius: 8px;
          background: #1a1a1a;
          color: #fff;
          font-size: 16px;
          box-sizing: border-box;
        }
        input:focus { outline: none; border-color: #9333ea; }
        .button {
          width: 100%;
          padding: 14px;
          background: #9333ea;
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 500;
          cursor: pointer;
        }
        .button:hover { background: #7c22ce; }
        .error { color: #ef4444; margin-bottom: 20px; text-align: center; }
        .help { color: #666; font-size: 12px; margin-top: 8px; }
      </style>
    </head>
    <body>
      <div class="title">Verify with Farcaster</div>
      <div class="subtitle">Enter your Farcaster ID to verify Protardio ownership</div>
      ${error ? `<div class="error">${error}</div>` : ''}
      <form method="POST" action="/verify">
        <input type="hidden" name="discord_id" value="${discordId}" />
        <div class="form-group">
          <label>Farcaster ID (FID)</label>
          <input type="number" name="fid" placeholder="e.g. 12345" required min="1" />
          <div class="help">Find your FID on Warpcast profile settings</div>
        </div>
        <div class="form-group">
          <label>Wallet Address (optional)</label>
          <input type="text" name="wallet" placeholder="0x..." pattern="^0x[a-fA-F0-9]{40}$" />
          <div class="help">Override if your NFT is in a wallet not linked to Farcaster</div>
        </div>
        <button type="submit" class="button">Continue with Discord</button>
      </form>
    </body>
    </html>
  `;
}

function renderWalletVerifyPage(discordId: string, error?: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Verify with Wallet</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body {
          font-family: system-ui, -apple-system, sans-serif;
          max-width: 400px;
          margin: 80px auto;
          padding: 20px;
          background: #0f0f0f;
          color: #fff;
        }
        .title { font-size: 24px; font-weight: bold; margin-bottom: 10px; text-align: center; }
        .subtitle { color: #999; margin-bottom: 30px; text-align: center; font-size: 14px; }
        .form-group { margin-bottom: 20px; }
        label { display: block; margin-bottom: 8px; color: #ccc; font-size: 14px; }
        input {
          width: 100%;
          padding: 12px;
          border: 1px solid #333;
          border-radius: 8px;
          background: #1a1a1a;
          color: #fff;
          font-size: 16px;
          box-sizing: border-box;
        }
        input:focus { outline: none; border-color: #9333ea; }
        .button {
          width: 100%;
          padding: 14px;
          background: #9333ea;
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 500;
          cursor: pointer;
        }
        .button:hover { background: #7c22ce; }
        .error { color: #ef4444; margin-bottom: 20px; text-align: center; }
        .help { color: #666; font-size: 12px; margin-top: 8px; }
      </style>
    </head>
    <body>
      <div class="title">Verify with Wallet</div>
      <div class="subtitle">Enter your wallet address holding Protardio NFTs</div>
      ${error ? `<div class="error">${error}</div>` : ''}
      <form method="POST" action="/auth/wallet-connect">
        <input type="hidden" name="discord_id" value="${discordId}" />
        <div class="form-group">
          <label>Wallet Address</label>
          <input type="text" name="wallet" placeholder="0x..." required pattern="^0x[a-fA-F0-9]{40}$" />
          <div class="help">Enter the wallet address that holds your Protardio NFT</div>
        </div>
        <button type="submit" class="button">Continue with Discord</button>
      </form>
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
