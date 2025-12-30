import { Client, GatewayIntentBits, Events } from 'discord.js';
import { database } from './database';
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

const HOLDER_ROLE_NAME = 'Protardio Holder';

function getGuildId(): string {
  return process.env.DISCORD_GUILD_ID!;
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
