import { Client, TextChannel, EmbedBuilder } from 'discord.js';
import { getRecentCasts, getFarcasterUser } from './neynar';
import dotenv from 'dotenv';

dotenv.config();

const FARCASTER_CHANNEL_NAME = 'farcaster-feed';
const POLL_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes

// FIDs to track - add the FIDs you want to follow here
// Example: [1234, 5678] would track those specific users
const TRACKED_FIDS = process.env.TRACKED_FARCASTER_FIDS
  ? process.env.TRACKED_FARCASTER_FIDS.split(',').map(Number).filter(Boolean)
  : [];

let farcasterChannel: TextChannel | null = null;
let lastCastTimestamp = Math.floor(Date.now() / 1000);
const postedCastHashes = new Set<string>();

interface Cast {
  hash: string;
  thread_hash: string;
  parent_hash: string | null;
  author: {
    fid: number;
    username: string;
    display_name: string;
    pfp_url: string;
  };
  text: string;
  timestamp: string;
  embeds: Array<{ url: string }>;
  reactions: {
    likes_count: number;
    recasts_count: number;
  };
  replies: {
    count: number;
  };
}

/**
 * Initialize Farcaster feed
 */
export async function initFarcasterFeed(client: Client): Promise<void> {
  if (TRACKED_FIDS.length === 0) {
    console.log('No Farcaster FIDs configured. Set TRACKED_FARCASTER_FIDS in .env');
    return;
  }

  // Find farcaster feed channel
  const guildId = process.env.DISCORD_GUILD_ID!;
  const guild = await client.guilds.fetch(guildId);

  const channel = guild.channels.cache.find(
    c => c.name.includes('farcaster') && c.isTextBased()
  ) as TextChannel | undefined;

  if (channel) {
    farcasterChannel = channel;
    console.log(`Farcaster feed initialized, posting to #${channel.name}`);
    console.log(`Tracking ${TRACKED_FIDS.length} Farcaster user(s)`);
  } else {
    console.log('No farcaster channel found. Create a channel with "farcaster" in the name.');
    return;
  }

  // Start polling
  setInterval(checkForNewCasts, POLL_INTERVAL);

  // Initial check after 10 seconds
  setTimeout(checkForNewCasts, 10000);
}

/**
 * Check for new casts from tracked users
 */
async function checkForNewCasts(): Promise<void> {
  if (!farcasterChannel || TRACKED_FIDS.length === 0) return;

  try {
    const casts = await getRecentCasts(TRACKED_FIDS, 20) as Cast[];

    // Filter out already posted casts and replies
    const newCasts = casts.filter(cast => {
      if (postedCastHashes.has(cast.hash)) return false;
      if (cast.parent_hash) return false; // Skip replies
      return true;
    });

    // Post new casts (oldest first for chronological order)
    for (const cast of newCasts.reverse()) {
      await postCast(cast);
      postedCastHashes.add(cast.hash);

      // Keep the set from growing too large
      if (postedCastHashes.size > 1000) {
        const oldHashes = Array.from(postedCastHashes).slice(0, 500);
        oldHashes.forEach(h => postedCastHashes.delete(h));
      }

      // Small delay between posts
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  } catch (error) {
    console.error('Error checking for new casts:', error);
  }
}

/**
 * Post a cast to Discord
 */
async function postCast(cast: Cast): Promise<void> {
  if (!farcasterChannel) return;

  const warpcastUrl = `https://warpcast.com/${cast.author.username}/${cast.hash.slice(0, 10)}`;

  const embed = new EmbedBuilder()
    .setColor(0x8B5CF6) // Farcaster purple
    .setAuthor({
      name: `${cast.author.display_name} (@${cast.author.username})`,
      iconURL: cast.author.pfp_url,
      url: `https://warpcast.com/${cast.author.username}`
    })
    .setDescription(cast.text.slice(0, 4000)) // Discord limit
    .setTimestamp(new Date(cast.timestamp))
    .setFooter({ text: 'Farcaster' });

  // Add first image embed if present
  const imageEmbed = cast.embeds.find(e =>
    e.url && (e.url.endsWith('.jpg') || e.url.endsWith('.png') || e.url.endsWith('.gif') || e.url.endsWith('.webp'))
  );
  if (imageEmbed) {
    embed.setImage(imageEmbed.url);
  }

  // Add engagement stats
  embed.addFields(
    { name: 'Likes', value: String(cast.reactions.likes_count), inline: true },
    { name: 'Recasts', value: String(cast.reactions.recasts_count), inline: true },
    { name: 'Replies', value: String(cast.replies.count), inline: true }
  );

  try {
    await farcasterChannel.send({
      content: `[View on Warpcast](${warpcastUrl})`,
      embeds: [embed]
    });
  } catch (error) {
    console.error('Error posting cast:', error);
  }
}

/**
 * Manually add an FID to track (for bot commands)
 */
export function addTrackedFid(fid: number): void {
  if (!TRACKED_FIDS.includes(fid)) {
    TRACKED_FIDS.push(fid);
  }
}

/**
 * Remove an FID from tracking
 */
export function removeTrackedFid(fid: number): void {
  const index = TRACKED_FIDS.indexOf(fid);
  if (index > -1) {
    TRACKED_FIDS.splice(index, 1);
  }
}

/**
 * Get list of tracked FIDs
 */
export function getTrackedFids(): number[] {
  return [...TRACKED_FIDS];
}

export default {
  initFarcasterFeed,
  addTrackedFid,
  removeTrackedFid,
  getTrackedFids
};
