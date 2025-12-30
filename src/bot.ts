import { Client, GatewayIntentBits, Events, Partials } from 'discord.js';
import { database } from './database';
import dotenv from 'dotenv';

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Reaction]
});

const HOLDER_ROLE_NAME = 'Protardio Citizen';

// Reaction role mapping: emoji -> role name
const REACTION_ROLES: Record<string, string> = {
  '🛠️': 'Builder',
  '🎨': 'Creator',
  '📺': 'Streamer',
  '⚔️': 'Raider'
};

function getGuildId(): string {
  return process.env.DISCORD_GUILD_ID!;
}

function getRolePickerMessageId(): string | undefined {
  return process.env.ROLE_PICKER_MESSAGE_ID;
}

let isReady = false;

client.once('ready', () => {
  console.log(`Discord bot logged in as ${client.user?.tag}`);
  isReady = true;
});

client.on('error', (error) => {
  console.error('Discord bot error:', error);
});

// Simple command handler
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  if (message.content === '!verify') {
    const verification = database.getVerificationByDiscord(message.author.id);

    if (verification) {
      message.reply(`You're verified! Wallet: ${verification.wallet.slice(0, 6)}...${verification.wallet.slice(-4)}`);
    } else {
      message.reply('Not verified. Visit the Protardio mini app to verify your NFT ownership.');
    }
  }

  if (message.content === '!stats') {
    const count = database.getVerifiedCount();
    message.reply(`Total verified Protardio holders: ${count}`);
  }
});

// Reaction role handler - add role
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;

  // Handle partial reactions
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      console.error('Error fetching reaction:', error);
      return;
    }
  }

  const messageId = getRolePickerMessageId();
  if (!messageId || reaction.message.id !== messageId) return;

  const emoji = reaction.emoji.name;
  if (!emoji || !REACTION_ROLES[emoji]) return;

  const roleName = REACTION_ROLES[emoji];

  try {
    const guild = await client.guilds.fetch(getGuildId());
    const member = await guild.members.fetch(user.id);
    const role = guild.roles.cache.find(r => r.name === roleName);

    if (role) {
      await member.roles.add(role);
      console.log(`Added ${roleName} role to ${user.tag}`);
    }
  } catch (error) {
    console.error('Error adding reaction role:', error);
  }
});

// Reaction role handler - remove role
client.on(Events.MessageReactionRemove, async (reaction, user) => {
  if (user.bot) return;

  // Handle partial reactions
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      console.error('Error fetching reaction:', error);
      return;
    }
  }

  const messageId = getRolePickerMessageId();
  if (!messageId || reaction.message.id !== messageId) return;

  const emoji = reaction.emoji.name;
  if (!emoji || !REACTION_ROLES[emoji]) return;

  const roleName = REACTION_ROLES[emoji];

  try {
    const guild = await client.guilds.fetch(getGuildId());
    const member = await guild.members.fetch(user.id);
    const role = guild.roles.cache.find(r => r.name === roleName);

    if (role && member.roles.cache.has(role.id)) {
      await member.roles.remove(role);
      console.log(`Removed ${roleName} role from ${user.tag}`);
    }
  } catch (error) {
    console.error('Error removing reaction role:', error);
  }
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
    const guild = await client.guilds.fetch(getGuildId());
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
    console.log(`Assigned role to ${member.user.tag}`);

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
