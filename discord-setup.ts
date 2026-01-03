// discord-setup.ts
// Run this once to automatically set up your entire Discord server

import {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionFlagsBits,
  TextChannel,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

function getGuildId(): string {
  return process.env.DISCORD_GUILD_ID!;
}

async function setupProtardioServer() {
  console.log('🚀 Starting Protardio Discord setup...\n');

  const guild = await client.guilds.fetch(getGuildId());
  console.log(`✅ Connected to: ${guild.name}\n`);

  // STEP 0: Clean up duplicate channels and categories
  console.log('🧹 Cleaning up...');

  // Fetch all channels
  await guild.channels.fetch();


  // Find or create PROTARDIO HOLDER category
  let holderCategory = guild.channels.cache.find(
    c => c.type === ChannelType.GuildCategory &&
    (c.name === 'PROTARDIO HOLDER' || c.name === '🟪 PROTARDIO HOLDER')
  );

  if (!holderCategory) {
    holderCategory = await guild.channels.create({
      name: '🟪 PROTARDIO HOLDER',
      type: ChannelType.GuildCategory
    });
    console.log(`  ✅ Created category: PROTARDIO HOLDER`);
  }

  // Delete PROTARDIO CITIZENS categories and move channels to PROTARDIO HOLDER
  const citizenCategories = guild.channels.cache.filter(
    c => c.type === ChannelType.GuildCategory &&
    (c.name.toLowerCase().includes('protardio citizens') ||
     c.name.includes('🅿️') ||
     (c.name.includes('🟪') && c.name.toLowerCase().includes('citizens')))
  );

  for (const category of citizenCategories.values()) {
    const childChannels = guild.channels.cache.filter(c => c.parentId === category.id);

    // Move channels to PROTARDIO HOLDER
    for (const channel of childChannels.values()) {
      await (channel as any).setParent(holderCategory.id);
      console.log(`  📦 Moved #${channel.name} to PROTARDIO HOLDER`);
    }

    await category.delete('Consolidating to PROTARDIO HOLDER');
    console.log(`  🗑️  Deleted category: ${category.name}`);
  }

  // Find and remove duplicate categories
  const categoryNames = ['PUBLIC', '📢 PUBLIC', 'VERIFIED HUMANS', '🔐 VERIFIED HUMANS', 'PROTARDIO HOLDERS', '🟪 PROTARDIO HOLDERS'];
  for (const catName of categoryNames) {
    const duplicates = guild.channels.cache.filter(
      c => c.type === ChannelType.GuildCategory && c.name === catName
    );
    if (duplicates.size > 1) {
      const sorted = [...duplicates.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      // Keep the oldest, delete the rest
      for (let i = 1; i < sorted.length; i++) {
        await sorted[i].delete('Removing duplicate category');
        console.log(`  🗑️  Deleted duplicate category: ${catName}`);
      }
    }
  }

  // Find and remove duplicate text channels
  const channelNames = [
    'welcome', '👋welcome', 'verify-here', '🔐verify-here',
    'general-chat', '💬general-chat', 'introductions', '👋introductions',
    'announcements', '📢announcements', 'holder-chat', '💬holder-chat',
    'alpha', '🔥alpha', 'raids', '🎯raids', 'memes', '😂memes',
    'farcaster-feed', '📱farcaster-feed', 'feedback', '💡feedback'
  ];

  for (const chanName of channelNames) {
    const duplicates = guild.channels.cache.filter(
      c => c.type === ChannelType.GuildText && c.name === chanName
    );
    if (duplicates.size > 1) {
      const sorted = [...duplicates.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      // Keep the oldest, delete the rest
      for (let i = 1; i < sorted.length; i++) {
        await sorted[i].delete('Removing duplicate channel');
        console.log(`  🗑️  Deleted duplicate channel: #${chanName}`);
      }
    }
  }

  console.log('  ✅ Cleanup complete\n');

  // STEP 1: Clean up old roles and create new ones
  console.log('📝 Managing roles...');

  // Delete old "Protardio Holder" role if it exists
  const oldHolderRole = guild.roles.cache.find(r => r.name === 'Protardio Holder');
  if (oldHolderRole) {
    await oldHolderRole.delete('Consolidating to Protardio Citizen role');
    console.log('  🗑️  Deleted: Protardio Holder (consolidated to Protardio Citizen)');
  }

  // Delete old "Verified Human" role if it exists (replaced by Pretardio Citizens)
  const oldVerifiedHumanRole = guild.roles.cache.find(r => r.name === 'Verified Human');
  if (oldVerifiedHumanRole) {
    await oldVerifiedHumanRole.delete('Replaced by Pretardio Citizens role');
    console.log('  🗑️  Deleted: Verified Human (replaced by Pretardio Citizens)');
  }

  // Pretardio Citizens - completed Wick verification but not holder verification
  let pretardioCitizensRole = guild.roles.cache.find(r => r.name === 'Pretardio Citizens');
  if (!pretardioCitizensRole) {
    pretardioCitizensRole = await guild.roles.create({
      name: 'Pretardio Citizens',
      color: 0x3b82f6, // Blue
      position: 1, // Low position for moderation bots
      reason: 'Wick-verified users (not yet holder verified)',
      permissions: []
    });
    console.log('  ✅ Created: Pretardio Citizens');
  } else {
    // Update existing role to ensure correct settings
    await pretardioCitizensRole.setPosition(1).catch(() => {});
    await pretardioCitizensRole.setPermissions([]).catch(() => {});
    console.log('  ✅ Updated: Pretardio Citizens (low position, no special permissions)');
  }

  let holderRole = guild.roles.cache.find(r => r.name === 'Protardio Citizen');
  if (!holderRole) {
    holderRole = await guild.roles.create({
      name: 'Protardio Citizen',
      color: 0x9333ea, // Purple
      position: 1, // Low position so moderation bots can manage holders
      reason: 'NFT holders',
      permissions: [] // No special permissions - no @everyone mentions
    });
    console.log('  ✅ Created: Protardio Citizen');
  } else {
    // Update existing role to ensure correct settings
    await holderRole.setPosition(1).catch(() => {});
    await holderRole.setPermissions([]).catch(() => {});
    console.log('  ✅ Updated: Protardio Citizen (low position, no @everyone mentions)');
  }

  // Reaction roles - positioned just above Protardio Citizen so their colors display
  const reactionRoles = [
    { name: 'Builder', color: 0x3b82f6, emoji: '🛠️' },   // Blue
    { name: 'Creator', color: 0xec4899, emoji: '🎨' },   // Pink
    { name: 'Streamer', color: 0x8b5cf6, emoji: '📺' },  // Purple
    { name: 'Raider', color: 0xef4444, emoji: '⚔️' }     // Red
  ];

  for (const roleData of reactionRoles) {
    let role = guild.roles.cache.find(r => r.name === roleData.name);
    if (!role) {
      role = await guild.roles.create({
        name: roleData.name,
        color: roleData.color,
        position: 2, // Just above Protardio Citizen, still low for mod bots
        reason: `Reaction role: ${roleData.emoji}`,
        permissions: []
      });
      console.log(`  ✅ Created: ${roleData.name} (${roleData.emoji})`);
    } else {
      await role.setPosition(2).catch(() => {});
      await role.setPermissions([]).catch(() => {});
      console.log(`  ✅ Updated: ${roleData.name} (position 2, no special permissions)`);
    }
  }

  // STEP 2: Update channel permissions
  console.log('\n📁 Updating channel permissions...');

  // Find all non-PUBLIC categories and make them holder-only
  const allCategories = guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory);

  for (const category of allCategories.values()) {
    // Skip PUBLIC category
    if (category.name.toLowerCase().includes('public')) {
      console.log(`  ⏭️  Skipping PUBLIC category`);
      continue;
    }

    // Make this category holder-only
    await (category as any).permissionOverwrites.set([
      {
        id: guild.id,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: holderRole.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
      }
    ]);
    console.log(`  ✅ Set holder-only: ${category.name}`);

    // Update all channels in this category to be holder-only
    const childChannels = guild.channels.cache.filter(c => c.parentId === category.id);
    for (const channel of childChannels.values()) {
      const isReadOnly = channel.name.includes('announcement') || channel.name.includes('farcaster-feed');

      await (channel as any).permissionOverwrites.set([
        {
          id: guild.id,
          deny: [PermissionFlagsBits.ViewChannel]
        },
        {
          id: holderRole.id,
          allow: isReadOnly ? [PermissionFlagsBits.ViewChannel] : [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
          deny: isReadOnly ? [PermissionFlagsBits.SendMessages] : []
        }
      ]);
      console.log(`    ✅ Set holder-only: #${channel.name}${isReadOnly ? ' (read-only)' : ''}`);
    }
  }

  // Update PUBLIC category channels
  const publicCategory = guild.channels.cache.find(
    c => c.type === ChannelType.GuildCategory && c.name.toLowerCase().includes('public')
  );

  if (publicCategory) {
    const publicChannels = guild.channels.cache.filter(c => c.parentId === publicCategory.id);

    for (const channel of publicChannels.values()) {
      // general-chat and introductions: viewable by all, only Pretardio Citizens can chat
      if (channel.name.includes('general-chat') || channel.name.includes('introductions')) {
        await (channel as any).permissionOverwrites.set([
          {
            id: guild.id,
            allow: [PermissionFlagsBits.ViewChannel],
            deny: [PermissionFlagsBits.SendMessages]
          },
          {
            id: pretardioCitizensRole.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
          }
        ]);
        console.log(`  ✅ Set Pretardio Citizens can chat: #${channel.name}`);
      }
    }
  }

  // STEP 3: Create verification channel and post verification embed
  console.log('\n🔐 Setting up verification channel...');

  // Find PUBLIC category
  let verifyChannel = guild.channels.cache.find(
    c => c.type === ChannelType.GuildText && c.name.includes('verify')
  ) as TextChannel | undefined;

  if (!verifyChannel && publicCategory) {
    verifyChannel = await guild.channels.create({
      name: '🔐verify',
      type: ChannelType.GuildText,
      parent: publicCategory.id,
      topic: 'Verify your Protardio NFT ownership to unlock holder channels'
    }) as TextChannel;
    console.log('  ✅ Created: #verify');
  }

  if (verifyChannel) {
    // Set permissions: everyone can view, no one can send (except bot)
    await verifyChannel.permissionOverwrites.set([
      {
        id: guild.id,
        allow: [PermissionFlagsBits.ViewChannel],
        deny: [PermissionFlagsBits.SendMessages]
      }
    ]);

    // Check if verification message already exists
    const messages = await verifyChannel.messages.fetch({ limit: 10 });
    const hasVerifyEmbed = messages.some(m =>
      m.author.id === client.user?.id &&
      m.embeds.length > 0 &&
      m.embeds[0].title?.includes('Verification')
    );

    if (!hasVerifyEmbed) {
      // Post verification embed with buttons
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

      await verifyChannel.send({ embeds: [embed], components: [row] });
      console.log('  ✅ Posted verification embed with buttons');
    } else {
      console.log('  ⏭️  Verification embed already exists');
    }
  }

  // STEP 4: Set up webhooks for Farcaster feed
  console.log('\n🪝 Setting up webhooks...');
  const farcasterChannel = guild.channels.cache.find(
    c => c.name === 'farcaster-feed'
  ) as any;

  if (farcasterChannel) {
    const existingWebhooks = await farcasterChannel.fetchWebhooks();
    if (!existingWebhooks.find((w: any) => w.name === 'Farcaster Feed')) {
      const webhook = await farcasterChannel.createWebhook({
        name: 'Farcaster Feed',
        avatar: 'https://i.imgur.com/AfFp7pu.png', // Farcaster logo
        reason: 'Auto-post Farcaster updates'
      });
      console.log('  ✅ Created webhook for Farcaster feed');
      console.log(`  📋 Webhook URL: ${webhook.url}`);
    } else {
      console.log('  ⏭️  Webhook already exists');
    }
  }

  console.log('\n✅ Server setup complete!\n');
  console.log('Next steps:');
  console.log('1. Configure your .env with Supabase, Neynar, and Reservoir API keys');
  console.log('2. Run "npm run dev" to start the bot');
  console.log('3. Set up Wick/Carl-bot for moderation and auto-roles');
  console.log('4. Set up Noctaly for reaction roles');
  console.log('5. Pin important messages in channels\n');
}

// Run the setup
client.once('ready', async () => {
  try {
    await setupProtardioServer();
    console.log('🎉 All done! Disconnecting...');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during setup:', error);
    process.exit(1);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);