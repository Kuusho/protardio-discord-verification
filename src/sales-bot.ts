import { Client, TextChannel, EmbedBuilder } from 'discord.js';
import { getSalesSince, getCollectionStats, formatEth, formatUsd, truncateAddress, Sale } from './reservoir';
import dotenv from 'dotenv';

dotenv.config();

const SALES_CHANNEL_NAME = 'sales-feed';
const POLL_INTERVAL = 60 * 1000; // Check every minute

let lastCheckedTimestamp = Math.floor(Date.now() / 1000);
let salesChannel: TextChannel | null = null;

/**
 * Initialize sales bot
 */
export async function initSalesBot(client: Client): Promise<void> {
  // Find sales channel
  const guildId = process.env.DISCORD_GUILD_ID!;
  const guild = await client.guilds.fetch(guildId);

  const channel = guild.channels.cache.find(
    c => c.name.includes('sales') && c.isTextBased()
  ) as TextChannel | undefined;

  if (channel) {
    salesChannel = channel;
    console.log(`Sales bot initialized, posting to #${channel.name}`);
  } else {
    console.log('No sales channel found. Create a channel with "sales" in the name.');
  }

  // Start polling for new sales
  setInterval(checkForNewSales, POLL_INTERVAL);

  // Initial check
  setTimeout(checkForNewSales, 5000);
}

/**
 * Check for new sales and post them
 */
async function checkForNewSales(): Promise<void> {
  if (!salesChannel) return;

  try {
    const sales = await getSalesSince(lastCheckedTimestamp);

    if (sales.length > 0) {
      // Update timestamp to latest sale
      lastCheckedTimestamp = Math.max(...sales.map(s => s.timestamp)) + 1;

      // Post each sale (newest first, but post oldest first for chronological order)
      for (const sale of sales.reverse()) {
        await postSale(sale);
        // Small delay between posts to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  } catch (error) {
    console.error('Error checking for new sales:', error);
  }
}

/**
 * Post a sale to Discord
 */
async function postSale(sale: Sale): Promise<void> {
  if (!salesChannel) return;

  const priceEth = sale.price.amount.native;
  const priceUsd = sale.price.amount.usd;

  const embed = new EmbedBuilder()
    .setColor(0x10b981) // Green for sales
    .setTitle(`Protardio #${sale.token.tokenId} Sold!`)
    .setThumbnail(sale.token.image || 'https://protardio.xyz/logo.png')
    .addFields(
      { name: 'Price', value: `${formatEth(priceEth)} (${formatUsd(priceUsd)})`, inline: true },
      { name: 'From', value: truncateAddress(sale.from), inline: true },
      { name: 'To', value: truncateAddress(sale.to), inline: true }
    )
    .setFooter({ text: 'Protardion Prime' })
    .setTimestamp(new Date(sale.timestamp * 1000));

  // Add link to transaction
  const baseUrl = 'https://basescan.org/tx/';
  embed.setURL(`${baseUrl}${sale.txHash}`);

  try {
    await salesChannel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Error posting sale:', error);
  }
}

/**
 * Post collection stats on demand
 */
export async function postCollectionStats(channel: TextChannel): Promise<void> {
  const stats = await getCollectionStats();

  if (!stats) {
    await channel.send('Unable to fetch collection stats. Please try again later.');
    return;
  }

  const floorPrice = stats.floorAsk?.price?.amount;
  const floorDisplay = floorPrice
    ? `${formatEth(floorPrice.native)} (${formatUsd(floorPrice.usd)})`
    : 'No listings';

  const embed = new EmbedBuilder()
    .setColor(0x9333ea)
    .setTitle('Protardio Collection Stats')
    .setThumbnail('https://protardio.xyz/logo.png')
    .addFields(
      { name: 'Floor Price', value: floorDisplay, inline: true },
      { name: 'Total Supply', value: String(stats.tokenCount), inline: true },
      { name: 'Unique Holders', value: String(stats.ownerCount), inline: true },
      { name: '24h Volume', value: formatEth(stats.volume['1day']), inline: true },
      { name: '7d Volume', value: formatEth(stats.volume['7day']), inline: true },
      { name: '30d Volume', value: formatEth(stats.volume['30day']), inline: true },
      { name: '24h Sales', value: String(stats.salesCount['1day']), inline: true },
      { name: '7d Sales', value: String(stats.salesCount['7day']), inline: true },
      { name: 'All Time Sales', value: String(stats.salesCount.allTime), inline: true }
    )
    .setFooter({ text: 'Data from Reservoir' })
    .setTimestamp();

  await channel.send({ embeds: [embed] });
}

export default {
  initSalesBot,
  postCollectionStats
};
