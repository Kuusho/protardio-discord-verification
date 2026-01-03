import dotenv from 'dotenv';

dotenv.config();

const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;
const NEYNAR_BASE_URL = 'https://api.neynar.com/v2';

interface FarcasterUser {
  fid: number;
  username: string;
  display_name: string;
  pfp_url: string;
  custody_address: string;
  verified_addresses: {
    eth_addresses: string[];
    sol_addresses: string[];
  };
  follower_count: number;
  following_count: number;
  power_badge: boolean;
}

interface NeynarUserResponse {
  users: FarcasterUser[];
}

/**
 * Get all verified wallet addresses for a Farcaster user
 * This includes both ETH addresses and the custody address
 */
export async function getFarcasterWallets(fid: number): Promise<string[]> {
  if (!NEYNAR_API_KEY) {
    console.error('NEYNAR_API_KEY not configured');
    return [];
  }

  try {
    const response = await fetch(`${NEYNAR_BASE_URL}/farcaster/user/bulk?fids=${fid}`, {
      headers: {
        'accept': 'application/json',
        'api_key': NEYNAR_API_KEY
      }
    });

    if (!response.ok) {
      console.error('Neynar API error:', await response.text());
      return [];
    }

    const data = await response.json() as NeynarUserResponse;

    if (!data.users || data.users.length === 0) {
      return [];
    }

    const user = data.users[0];
    const wallets: string[] = [];

    // Add custody address
    if (user.custody_address) {
      wallets.push(user.custody_address.toLowerCase());
    }

    // Add verified ETH addresses
    if (user.verified_addresses?.eth_addresses) {
      for (const addr of user.verified_addresses.eth_addresses) {
        const normalized = addr.toLowerCase();
        if (!wallets.includes(normalized)) {
          wallets.push(normalized);
        }
      }
    }

    return wallets;
  } catch (error) {
    console.error('Error fetching Farcaster wallets:', error);
    return [];
  }
}

/**
 * Get Farcaster user profile data
 */
export async function getFarcasterUser(fid: number): Promise<FarcasterUser | null> {
  if (!NEYNAR_API_KEY) {
    console.error('NEYNAR_API_KEY not configured');
    return null;
  }

  try {
    const response = await fetch(`${NEYNAR_BASE_URL}/farcaster/user/bulk?fids=${fid}`, {
      headers: {
        'accept': 'application/json',
        'api_key': NEYNAR_API_KEY
      }
    });

    if (!response.ok) {
      console.error('Neynar API error:', await response.text());
      return null;
    }

    const data = await response.json() as NeynarUserResponse;

    if (!data.users || data.users.length === 0) {
      return null;
    }

    return data.users[0];
  } catch (error) {
    console.error('Error fetching Farcaster user:', error);
    return null;
  }
}

/**
 * Calculate a simple sybil score based on Farcaster social graph
 * Higher score = more likely to be a real user
 * Score 0-100
 */
export async function calculateSybilScore(fid: number): Promise<number> {
  const user = await getFarcasterUser(fid);

  if (!user) {
    return 0;
  }

  let score = 0;

  // Follower count scoring (max 30 points)
  if (user.follower_count >= 1000) score += 30;
  else if (user.follower_count >= 500) score += 25;
  else if (user.follower_count >= 100) score += 20;
  else if (user.follower_count >= 50) score += 15;
  else if (user.follower_count >= 10) score += 10;
  else if (user.follower_count >= 1) score += 5;

  // Following count (shows activity, max 10 points)
  if (user.following_count >= 100) score += 10;
  else if (user.following_count >= 50) score += 7;
  else if (user.following_count >= 10) score += 5;

  // Power badge (verified by Warpcast, 25 points)
  if (user.power_badge) score += 25;

  // Has verified addresses (max 20 points)
  const ethAddresses = user.verified_addresses?.eth_addresses?.length || 0;
  if (ethAddresses >= 3) score += 20;
  else if (ethAddresses >= 2) score += 15;
  else if (ethAddresses >= 1) score += 10;

  // Has profile picture (5 points)
  if (user.pfp_url && !user.pfp_url.includes('default')) score += 5;

  // Has display name (5 points)
  if (user.display_name && user.display_name !== user.username) score += 5;

  // Follower/following ratio (helps detect follow-bots, max 5 points)
  if (user.following_count > 0) {
    const ratio = user.follower_count / user.following_count;
    if (ratio >= 0.5 && ratio <= 10) score += 5;
  }

  return Math.min(score, 100);
}

/**
 * Check if a user passes minimum sybil threshold
 * Default threshold: 25 (has some followers + verified address)
 */
export async function passesSybilCheck(fid: number, threshold: number = 25): Promise<boolean> {
  const score = await calculateSybilScore(fid);
  console.log(`Sybil score for FID ${fid}: ${score}`);
  return score >= threshold;
}

/**
 * Get recent casts from specific FIDs (for Farcaster feed)
 */
export async function getRecentCasts(fids: number[], limit: number = 25): Promise<any[]> {
  if (!NEYNAR_API_KEY) {
    console.error('NEYNAR_API_KEY not configured');
    return [];
  }

  try {
    const response = await fetch(
      `${NEYNAR_BASE_URL}/farcaster/feed?feed_type=filter&filter_type=fids&fids=${fids.join(',')}&limit=${limit}`,
      {
        headers: {
          'accept': 'application/json',
          'api_key': NEYNAR_API_KEY
        }
      }
    );

    if (!response.ok) {
      console.error('Neynar API error:', await response.text());
      return [];
    }

    const data = await response.json();
    return data.casts || [];
  } catch (error) {
    console.error('Error fetching casts:', error);
    return [];
  }
}

export default {
  getFarcasterWallets,
  getFarcasterUser,
  calculateSybilScore,
  passesSybilCheck,
  getRecentCasts
};
