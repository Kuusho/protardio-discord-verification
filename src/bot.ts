import {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
  PermissionFlagsBits,
  TextChannel,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction
} from 'discord.js';
import { supabaseDatabase } from './supabase-database';
import { calculateSybilScore, getFarcasterUser } from './neynar';
import { initSalesBot, postCollectionStats } from './sales-bot';
import { getCollectionStats, getRecentSales, formatEth, formatUsd, truncateAddress } from './reservoir';
import { initFarcasterFeed } from './farcaster-feed';
import dotenv from 'dotenv';

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const HOLDER_ROLE_NAME = 'Protardio Citizen';
const UNVERIFIED_ROLE_NAME = 'Unverified';

function getBaseUrl(): string {
  const url = process.env.BASE_URL || 'http://localhost:3000';
  // Remove trailing slash if present
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function getGuildId(): string {
  return process.env.DISCORD_GUILD_ID!;
}

let isReady = false;

client.once('ready', async () => {
  console.log(`Discord bot logged in as ${client.user?.tag}`);
  isReady = true;

  // Initialize sales bot
  try {
    await initSalesBot(client);
  } catch (error) {
    console.error('Failed to initialize sales bot:', error);
  }

  // Initialize Farcaster feed
  try {
    await initFarcasterFeed(client);
  } catch (error) {
    console.error('Failed to initialize Farcaster feed:', error);
  }
});

client.on('error', (error) => {
  console.error('Discord bot error:', error);
});

// Command handler
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const args = message.content.split(' ');
  const command = args[0].toLowerCase();

  // !verify - Check your verification status
  if (command === '!verify') {
    const verification = await supabaseDatabase.getVerificationByDiscord(message.author.id);

    if (verification) {
      const embed = new EmbedBuilder()
        .setColor(0x9333ea)
        .setTitle('Verification Status')
        .addFields(
          { name: 'Status', value: 'Verified', inline: true },
          { name: 'Protardios Held', value: String(verification.nft_balance), inline: true },
          { name: 'Wallet', value: `${verification.wallet.slice(0, 6)}...${verification.wallet.slice(-4)}`, inline: true },
          { name: 'Verified At', value: new Date(verification.verified_at).toLocaleDateString(), inline: true }
        )
        .setFooter({ text: 'Protardio Discord Verification' });

      message.reply({ embeds: [embed] });
    } else {
      message.reply('Not verified. Visit the Protardio mini app to verify your NFT ownership.');
    }
  }

  // !stats - Show community stats
  if (command === '!stats') {
    const count = await supabaseDatabase.getVerifiedCount();
    const embed = new EmbedBuilder()
      .setColor(0x9333ea)
      .setTitle('Protardio Community Stats')
      .addFields(
        { name: 'Verified Holders', value: String(count), inline: true }
      )
      .setTimestamp();

    message.reply({ embeds: [embed] });
  }

  // !whois @user - Check another user's verification (mod only)
  if (command === '!whois' && message.mentions.users.size > 0) {
    const member = message.member;
    if (!member?.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      message.reply('You need moderator permissions to use this command.');
      return;
    }

    const targetUser = message.mentions.users.first();
    if (!targetUser) return;

    const verification = await supabaseDatabase.getVerificationByDiscord(targetUser.id);

    if (verification) {
      const fcUser = await getFarcasterUser(verification.fid);
      const sybilScore = await calculateSybilScore(verification.fid);

      const embed = new EmbedBuilder()
        .setColor(0x9333ea)
        .setTitle(`User Info: ${targetUser.username}`)
        .setThumbnail(targetUser.displayAvatarURL())
        .addFields(
          { name: 'Discord', value: targetUser.tag, inline: true },
          { name: 'Farcaster', value: fcUser ? `@${fcUser.username}` : `FID ${verification.fid}`, inline: true },
          { name: 'Protardios', value: String(verification.nft_balance), inline: true },
          { name: 'Wallet', value: `${verification.wallet.slice(0, 6)}...${verification.wallet.slice(-4)}`, inline: true },
          { name: 'Trust Score', value: `${sybilScore}/100`, inline: true },
          { name: 'Verified', value: new Date(verification.verified_at).toLocaleDateString(), inline: true }
        );

      message.reply({ embeds: [embed] });
    } else {
      message.reply(`${targetUser.username} is not verified.`);
    }
  }

  // !leaderboard - Show top holders
  if (command === '!leaderboard') {
    const verifications = await supabaseDatabase.getAllVerifications();
    const sorted = verifications.sort((a, b) => b.nft_balance - a.nft_balance).slice(0, 10);

    if (sorted.length === 0) {
      message.reply('No verified holders yet.');
      return;
    }

    const leaderboard = sorted.map((v, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      return `${medal} <@${v.discord_id}> - ${v.nft_balance} Protardios`;
    }).join('\n');

    const embed = new EmbedBuilder()
      .setColor(0x9333ea)
      .setTitle('Top Protardio Holders')
      .setDescription(leaderboard)
      .setTimestamp();

    message.reply({ embeds: [embed] });
  }

  // !floor - Show floor price
  if (command === '!floor' || command === '!fp') {
    const stats = await getCollectionStats();

    if (!stats?.floorAsk?.price) {
      message.reply('Unable to fetch floor price. No active listings or API error.');
      return;
    }

    const floor = stats.floorAsk.price.amount;
    const embed = new EmbedBuilder()
      .setColor(0x9333ea)
      .setTitle('Protardio Floor Price')
      .setDescription(`**${formatEth(floor.native)}** (${formatUsd(floor.usd)})`)
      .addFields(
        { name: 'Unique Holders', value: String(stats.ownerCount), inline: true },
        { name: 'Total Supply', value: String(stats.tokenCount), inline: true }
      )
      .setTimestamp();

    message.reply({ embeds: [embed] });
  }

  // !volume - Show trading volume
  if (command === '!volume') {
    const stats = await getCollectionStats();

    if (!stats) {
      message.reply('Unable to fetch volume data.');
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x9333ea)
      .setTitle('Protardio Trading Volume')
      .addFields(
        { name: '24h Volume', value: formatEth(stats.volume['1day']), inline: true },
        { name: '7d Volume', value: formatEth(stats.volume['7day']), inline: true },
        { name: '30d Volume', value: formatEth(stats.volume['30day']), inline: true },
        { name: 'All Time Volume', value: formatEth(stats.volume.allTime), inline: true },
        { name: '24h Sales', value: String(stats.salesCount['1day']), inline: true },
        { name: '7d Sales', value: String(stats.salesCount['7day']), inline: true }
      )
      .setTimestamp();

    message.reply({ embeds: [embed] });
  }

  // !sales - Show recent sales
  if (command === '!sales') {
    const sales = await getRecentSales(5);

    if (sales.length === 0) {
      message.reply('No recent sales found.');
      return;
    }

    const salesList = sales.map(s => {
      const price = formatEth(s.price.amount.native);
      const time = new Date(s.timestamp * 1000).toLocaleString();
      return `**#${s.token.tokenId}** - ${price} - ${truncateAddress(s.to)} - ${time}`;
    }).join('\n');

    const embed = new EmbedBuilder()
      .setColor(0x10b981)
      .setTitle('Recent Protardio Sales')
      .setDescription(salesList)
      .setTimestamp();

    message.reply({ embeds: [embed] });
  }

  // !analytics - Full collection analytics
  if (command === '!analytics') {
    if (message.channel instanceof TextChannel) {
      await postCollectionStats(message.channel);
    }
  }

  // !help - Show available commands
  if (command === '!help') {
    const embed = new EmbedBuilder()
      .setColor(0x9333ea)
      .setTitle('Protardio Bot Commands')
      .addFields(
        { name: '--- Verification ---', value: '\u200B' },
        { name: '!verify', value: 'Check your verification status', inline: true },
        { name: '!stats', value: 'Show community statistics', inline: true },
        { name: '!leaderboard', value: 'Show top holders', inline: true },
        { name: '!whois @user', value: 'Check user info (mod only)', inline: true },
        { name: '--- Analytics ---', value: '\u200B' },
        { name: '!floor', value: 'Show floor price', inline: true },
        { name: '!volume', value: 'Show trading volume', inline: true },
        { name: '!sales', value: 'Show recent sales', inline: true },
        { name: '!analytics', value: 'Full collection stats', inline: true }
      )
      .setFooter({ text: 'Protardion Prime' });

    message.reply({ embeds: [embed] });
  }
});

// Button interaction handler for verification
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  const buttonInteraction = interaction as ButtonInteraction;

  if (buttonInteraction.customId === 'verify_farcaster') {
    const baseUrl = getBaseUrl();
    // For Farcaster verification, user needs to provide their FID
    // We'll send them to a page where they can enter it
    const verifyUrl = `${baseUrl}/verify?discord_id=${buttonInteraction.user.id}`;

    await buttonInteraction.reply({
      content: `Click here to verify with your Farcaster account:\n${verifyUrl}`,
      ephemeral: true
    });
  }

  if (buttonInteraction.customId === 'verify_wallet') {
    const baseUrl = getBaseUrl();
    const verifyUrl = `${baseUrl}/auth/wallet-connect?discord_id=${buttonInteraction.user.id}`;

    await buttonInteraction.reply({
      content: `Click here to verify with your wallet:\n${verifyUrl}`,
      ephemeral: true
    });
  }

  if (buttonInteraction.customId === 'check_status') {
    const verification = await supabaseDatabase.getVerificationByDiscord(buttonInteraction.user.id);

    if (verification) {
      const embed = new EmbedBuilder()
        .setColor(0x10b981)
        .setTitle('Verification Status')
        .addFields(
          { name: 'Status', value: '✅ Verified', inline: true },
          { name: 'Protardios Held', value: String(verification.nft_balance), inline: true },
          { name: 'Wallet', value: `${verification.wallet.slice(0, 6)}...${verification.wallet.slice(-4)}`, inline: true }
        );

      await buttonInteraction.reply({ embeds: [embed], ephemeral: true });
    } else {
      await buttonInteraction.reply({
        content: '❌ You are not verified yet. Click one of the verify buttons above to get started!',
        ephemeral: true
      });
    }
  }
});

/**
 * Post verification embed with buttons to a channel
 */
export async function postVerificationEmbed(channel: TextChannel): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0x9333ea)
    .setTitle('Protardio Holder Verification')
    .setDescription(
      'Verify your Protardio NFT ownership to unlock holder-only channels.\n\n' +
      '**How it works:**\n' +
      '1. Click a verify button below\n' +
      '2. Connect your wallet or Farcaster account\n' +
      '3. Authorize Discord access\n' +
      '4. Get your Protardio Citizen role!'
    )
    .addFields(
      { name: 'Farcaster Verification', value: 'Best if you have wallets linked to your Farcaster account', inline: true },
      { name: 'Wallet Verification', value: 'Connect directly with MetaMask, Rainbow, etc.', inline: true }
    )
    .setFooter({ text: 'Your wallet is checked on Base chain' });

  const row = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('verify_farcaster')
        .setLabel('Verify with Farcaster')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🟣'),
      new ButtonBuilder()
        .setCustomId('verify_wallet')
        .setLabel('Verify with Wallet')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔗'),
      new ButtonBuilder()
        .setCustomId('check_status')
        .setLabel('Check Status')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅')
    );

  await channel.send({ embeds: [embed], components: [row] });
}

export async function startBot() {
  await client.login(process.env.DISCORD_BOT_TOKEN);
}

export async function assignHolderRole(discordId: string): Promise<boolean> {
  if (!isReady) {
    console.error('Bot not ready yet');
    return false;
  }

  try {
    const guild = await client.guilds.fetch(getGuildId());
    const member = await guild.members.fetch(discordId);

    // Find or create the holder role
    let role = guild.roles.cache.find(r => r.name === HOLDER_ROLE_NAME);

    if (!role) {
      role = await guild.roles.create({
        name: HOLDER_ROLE_NAME,
        color: 0x9333EA, // Purple color
        position: 1, // Low position so moderation bots can manage holders
        permissions: [], // No special permissions - prevents @everyone mentions
        reason: 'Protardio holder role'
      });
      console.log(`Created role: ${HOLDER_ROLE_NAME} at low position`);
    }

    // Assign holder role
    await member.roles.add(role);
    console.log(`Assigned holder role to ${member.user.tag}`);

    // Remove Unverified role if present
    const unverifiedRole = guild.roles.cache.find(r => r.name === UNVERIFIED_ROLE_NAME);
    if (unverifiedRole && member.roles.cache.has(unverifiedRole.id)) {
      await member.roles.remove(unverifiedRole);
      console.log(`Removed Unverified role from ${member.user.tag}`);
    }

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
    const guild = await client.guilds.fetch(getGuildId());
    const member = await guild.members.fetch(discordId);
    const role = guild.roles.cache.find(r => r.name === HOLDER_ROLE_NAME);

    if (role && member.roles.cache.has(role.id)) {
      await member.roles.remove(role);
      console.log(`Removed role from ${member.user.tag}`);
      return true;
    }

    return false;
  } catch (error) {
    console.error('Error removing role:', error);
    return false;
  }
}

export { client };
