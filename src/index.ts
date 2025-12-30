import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
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
app.get('/', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'Protardio Discord Verifier',
    verified_holders: database.getVerifiedCount()
  });
});

// Step 1: Initiate Discord OAuth
// Called from mini app with FID and wallet address
app.get('/auth/discord', authLimiter, (req: Request, res: Response) => {
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
app.get('/auth/discord/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query;

  if (!code || !state) {
    res.status(400).send('Missing code or state parameter');
    return;
  }

  const sessionId = state as string;

  try {
    // Get pending verification
    const pending = database.getPending(sessionId);

    if (!pending) {
      res.status(400).send('Invalid or expired session');
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

    // Check if wallet holds Protardio NFT
    console.log(`Checking NFT ownership for wallet: ${pending.wallet}`);
    const holdsNFT = await checkProtardioOwnership(pending.wallet);

    if (holdsNFT) {
      // Get NFT balance
      const balance = await getProtardioBalance(pending.wallet);

      console.log(`Wallet holds ${balance} Protardio NFT(s)`);

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
        res.send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Verification Successful</title>
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
              .success { color: #10b981; font-size: 48px; }
              .title { font-size: 24px; font-weight: bold; margin: 20px 0; }
              .info { color: #999; margin: 10px 0; }
              .button {
                display: inline-block;
                background: #9333ea;
                color: white;
                padding: 12px 24px;
                text-decoration: none;
                border-radius: 8px;
                margin-top: 20px;
              }
              .button:hover { background: #7c22ce; }
            </style>
          </head>
          <body>
            <div class="success">&#10003;</div>
            <div class="title">Verification Successful!</div>
            <div class="info">Discord: ${discordUser.username}</div>
            <div class="info">Protardios Held: ${balance}</div>
            <div class="info">You've been assigned the Protardio Holder role</div>
            <a class="button" href="https://discord.com/channels/${process.env.DISCORD_GUILD_ID}">Open Discord</a>
          </body>
          </html>
        `);
        return;
      } else {
        throw new Error('Failed to assign Discord role');
      }
    } else {
      // User doesn't hold NFT
      database.deletePending(sessionId);

      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Verification Failed</title>
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
            .error { color: #ef4444; font-size: 48px; }
            .title { font-size: 24px; font-weight: bold; margin: 20px 0; }
            .info { color: #999; margin: 10px 0; }
          </style>
        </head>
        <body>
          <div class="error">&#10007;</div>
          <div class="title">No Protardio NFTs Found</div>
          <div class="info">Wallet: ${pending.wallet.slice(0, 6)}...${pending.wallet.slice(-4)}</div>
          <div class="info">You need to hold at least 1 Protardio NFT to verify</div>
        </body>
        </html>
      `);
      return;
    }
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).send('An error occurred during verification');
    return;
  }
});

// API endpoint to check verification status
app.get('/api/verification/:discordId', (req: Request, res: Response) => {
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
app.get('/api/stats', (req: Request, res: Response) => {
  const verifiedCount = database.getVerifiedCount();

  res.json({
    verified_holders: verifiedCount
  });
});

// Cleanup old pending verifications every hour
setInterval(() => {
  database.cleanupOldPending();
  console.log('Cleaned up old pending verifications');
}, 60 * 60 * 1000);

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
