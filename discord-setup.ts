// discord-setup.ts
// Run this once to automatically set up your entire Discord server

import { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } from 'discord.js';
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

  // STEP 1: Create Roles
  console.log('📝 Creating roles...');
  
  let verifiedHumanRole = guild.roles.cache.find(r => r.name === 'Verified Human');
  if (!verifiedHumanRole) {
    verifiedHumanRole = await guild.roles.create({
      name: 'Verified Human',
      color: 0x3b82f6, // Blue
      reason: 'Anti-sybil verified users',
      permissions: []
    });
    console.log('  ✅ Created: Verified Human');
  } else {
    console.log('  ⏭️  Already exists: Verified Human');
  }

  let holderRole = guild.roles.cache.find(r => r.name === 'Protardio Citizen');
  if (!holderRole) {
    holderRole = await guild.roles.create({
      name: 'Protardio Citizen',
      color: 0x9333ea, // Purple
      reason: 'NFT holders',
      permissions: []
    });
    console.log('  ✅ Created: Protardio Citizen');
  } else {
    console.log('  ⏭️  Already exists: Protardio Citizen');
  }

  // STEP 2: Create Categories and Channels
  console.log('\n📁 Creating categories and channels...');

  // PUBLIC CATEGORY
  let publicCategory = guild.channels.cache.find(
    c => c.name === 'PUBLIC' && c.type === ChannelType.GuildCategory
  );
  
  if (!publicCategory) {
    publicCategory = await guild.channels.create({
      name: '📢 PUBLIC',
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        {
          id: guild.id, // @everyone
          allow: [PermissionFlagsBits.ViewChannel],
          deny: [PermissionFlagsBits.SendMessages]
        }
      ]
    });
    console.log('  ✅ Created category: PUBLIC');
  } else {
    console.log('  ⏭️  Already exists: PUBLIC');
  }

  // Welcome channel
  if (!guild.channels.cache.find(c => c.name === 'welcome')) {
    const welcomeChannel = await guild.channels.create({
      name: '👋welcome',
      type: ChannelType.GuildText,
      parent: publicCategory.id,
      permissionOverwrites: [
        {
          id: guild.id,
          allow: [PermissionFlagsBits.ViewChannel],
          deny: [PermissionFlagsBits.SendMessages]
        }
      ]
    });
    console.log('  ✅ Created: #welcome');

    // Pin welcome message
    await welcomeChannel.send({
      embeds: [{
        title: 'Welcome to Protardio! 🟪',
        description: `Welcome to the official Protardio community!\n\n**To access holder channels:**\n1️⃣ Complete anti-sybil verification\n2️⃣ Verify your Protardio NFT ownership in our mini app\n\n**Links:**\n• Mini App: [coming soon]\n• Farcaster: @protardio\n• Website: protardio.xyz`,
        color: 0x9333ea,
        footer: { text: 'Wartime PFPs for Farcaster' }
      }]
    }).then(msg => msg.pin());
  } else {
    console.log('  ⏭️  Already exists: #welcome');
  }

  // Verify channel
  if (!guild.channels.cache.find(c => c.name === 'verify-here')) {
    await guild.channels.create({
      name: '🔐verify-here',
      type: ChannelType.GuildText,
      parent: publicCategory.id,
      permissionOverwrites: [
        {
          id: guild.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
        }
      ],
      topic: 'Complete verification steps to access holder channels'
    });
    console.log('  ✅ Created: #verify-here');
  } else {
    console.log('  ⏭️  Already exists: #verify-here');
  }

  // VERIFIED HUMANS CATEGORY
  let verifiedCategory = guild.channels.cache.find(
    c => c.name === 'VERIFIED HUMANS' && c.type === ChannelType.GuildCategory
  );
  
  if (!verifiedCategory) {
    verifiedCategory = await guild.channels.create({
      name: '🔐 VERIFIED HUMANS',
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        {
          id: guild.id,
          deny: [PermissionFlagsBits.ViewChannel]
        },
        {
          id: verifiedHumanRole.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
        }
      ]
    });
    console.log('  ✅ Created category: VERIFIED HUMANS');
  } else {
    console.log('  ⏭️  Already exists: VERIFIED HUMANS');
  }

  // General chat
  if (!guild.channels.cache.find(c => c.name === 'general-chat')) {
    await guild.channels.create({
      name: '💬general-chat',
      type: ChannelType.GuildText,
      parent: verifiedCategory.id,
      topic: 'General discussion for verified members'
    });
    console.log('  ✅ Created: #general-chat');
  } else {
    console.log('  ⏭️  Already exists: #general-chat');
  }

  // Introductions
  if (!guild.channels.cache.find(c => c.name === 'introductions')) {
    await guild.channels.create({
      name: '👋introductions',
      type: ChannelType.GuildText,
      parent: verifiedCategory.id,
      topic: 'Introduce yourself!'
    });
    console.log('  ✅ Created: #introductions');
  } else {
    console.log('  ⏭️  Already exists: #introductions');
  }

  // PROTARDIO HOLDERS CATEGORY
  let holdersCategory = guild.channels.cache.find(
    c => c.name === 'PROTARDIO HOLDERS' && c.type === ChannelType.GuildCategory
  );
  
  if (!holdersCategory) {
    holdersCategory = await guild.channels.create({
      name: '🟪 PROTARDIO HOLDERS',
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        {
          id: guild.id,
          deny: [PermissionFlagsBits.ViewChannel]
        },
        {
          id: holderRole.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
        }
      ]
    });
    console.log('  ✅ Created category: PROTARDIO HOLDERS');
  } else {
    console.log('  ⏭️  Already exists: PROTARDIO HOLDERS');
  }

  // Holder channels
  const holderChannels = [
    { name: '📢announcements', topic: 'Official Protardio announcements', readOnly: true },
    { name: '💬holder-chat', topic: 'General chat for holders' },
    { name: '🔥alpha', topic: 'Alpha leaks and insights' },
    { name: '🎯raids', topic: 'Coordinate Farcaster engagement' },
    { name: '😂memes', topic: 'Protardio memes only' },
    { name: '📱farcaster-feed', topic: 'Auto-posted Farcaster updates', readOnly: true },
    { name: '💡feedback', topic: 'Share your feedback and ideas' }
  ];

  for (const channel of holderChannels) {
    if (!guild.channels.cache.find(c => c.name === channel.name.replace(/[^\w-]/g, ''))) {
      const permissionOverwrites: any[] = [
        {
          id: guild.id,
          deny: [PermissionFlagsBits.ViewChannel]
        },
        {
          id: holderRole.id,
          allow: [PermissionFlagsBits.ViewChannel]
        }
      ];

      // If read-only, deny send messages for holders
      if (channel.readOnly) {
        permissionOverwrites.push({
          id: holderRole.id,
          allow: [PermissionFlagsBits.ViewChannel],
          deny: [PermissionFlagsBits.SendMessages]
        });
      } else {
        permissionOverwrites.push({
          id: holderRole.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
        });
      }

      await guild.channels.create({
        name: channel.name,
        type: ChannelType.GuildText,
        parent: holdersCategory.id,
        topic: channel.topic,
        permissionOverwrites
      });
      console.log(`  ✅ Created: #${channel.name}`);
    } else {
      console.log(`  ⏭️  Already exists: #${channel.name}`);
    }
  }

  // STEP 3: Set up webhooks for Farcaster feed
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
  console.log('1. Add your verification bot (Verify.xyz or similar)');
  console.log('2. Configure the Farcaster feed webhook');
  console.log('3. Pin important messages in channels');
  console.log('4. Set up server icon and banner\n');
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