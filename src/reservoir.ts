import dotenv from 'dotenv';

dotenv.config();

const RESERVOIR_API_KEY = process.env.RESERVOIR_API_KEY;
const RESERVOIR_BASE_URL = 'https://api-base.reservoir.tools';
const CONTRACT_ADDRESS = process.env.PROTARDIO_CONTRACT_ADDRESS!;

interface TokenData {
  token: {
    contract: string;
    tokenId: string;
    name: string;
    image: string;
  };
  market: {
    floorAsk: {
      price: {
        amount: {
          native: number;
          usd: number;
        };
      } | null;
    };
  };
}

interface CollectionStats {
  floorAsk: {
    price: {
      amount: {
        native: number;
        usd: number;
      };
    } | null;
  };
  tokenCount: number;
  ownerCount: number;
  volume: {
    '1day': number;
    '7day': number;
    '30day': number;
    allTime: number;
  };
  volumeChange: {
    '1day': number;
    '7day': number;
    '30day': number;
  };
  floorSale: {
    '1day': number;
    '7day': number;
    '30day': number;
  };
  salesCount: {
    '1day': number;
    '7day': number;
    '30day': number;
    allTime: number;
  };
}

export interface Sale {
  id: string;
  saleId: string;
  token: {
    contract: string;
    tokenId: string;
    name: string;
    image: string;
  };
  price: {
    currency: {
      symbol: string;
      decimals: number;
    };
    amount: {
      raw: string;
      decimal: number;
      usd: number;
      native: number;
    };
  };
  from: string;
  to: string;
  timestamp: number;
  txHash: string;
}

interface SalesResponse {
  sales: Sale[];
  continuation: string | null;
}

/**
 * Get collection statistics (floor price, volume, holders)
 */
export async function getCollectionStats(): Promise<CollectionStats | null> {
  const headers: Record<string, string> = {
    'accept': 'application/json'
  };

  if (RESERVOIR_API_KEY) {
    headers['x-api-key'] = RESERVOIR_API_KEY;
  }

  try {
    const response = await fetch(
      `${RESERVOIR_BASE_URL}/collections/v7?id=${CONTRACT_ADDRESS}`,
      { headers }
    );

    if (!response.ok) {
      console.error('Reservoir API error:', await response.text());
      return null;
    }

    const data = await response.json();
    const collection = data.collections?.[0];

    if (!collection) {
      return null;
    }

    return {
      floorAsk: collection.floorAsk,
      tokenCount: collection.tokenCount || 0,
      ownerCount: collection.ownerCount || 0,
      volume: collection.volume || { '1day': 0, '7day': 0, '30day': 0, allTime: 0 },
      volumeChange: collection.volumeChange || { '1day': 0, '7day': 0, '30day': 0 },
      floorSale: collection.floorSale || { '1day': 0, '7day': 0, '30day': 0 },
      salesCount: collection.salesCount || { '1day': 0, '7day': 0, '30day': 0, allTime: 0 }
    };
  } catch (error) {
    console.error('Error fetching collection stats:', error);
    return null;
  }
}

/**
 * Get recent sales
 */
export async function getRecentSales(limit: number = 10): Promise<Sale[]> {
  const headers: Record<string, string> = {
    'accept': 'application/json'
  };

  if (RESERVOIR_API_KEY) {
    headers['x-api-key'] = RESERVOIR_API_KEY;
  }

  try {
    const response = await fetch(
      `${RESERVOIR_BASE_URL}/sales/v6?collection=${CONTRACT_ADDRESS}&limit=${limit}`,
      { headers }
    );

    if (!response.ok) {
      console.error('Reservoir API error:', await response.text());
      return [];
    }

    const data = await response.json() as SalesResponse;
    return data.sales || [];
  } catch (error) {
    console.error('Error fetching sales:', error);
    return [];
  }
}

/**
 * Get sales since a specific timestamp
 */
export async function getSalesSince(timestamp: number): Promise<Sale[]> {
  const headers: Record<string, string> = {
    'accept': 'application/json'
  };

  if (RESERVOIR_API_KEY) {
    headers['x-api-key'] = RESERVOIR_API_KEY;
  }

  try {
    const response = await fetch(
      `${RESERVOIR_BASE_URL}/sales/v6?collection=${CONTRACT_ADDRESS}&startTimestamp=${timestamp}&limit=50`,
      { headers }
    );

    if (!response.ok) {
      console.error('Reservoir API error:', await response.text());
      return [];
    }

    const data = await response.json() as SalesResponse;
    return data.sales || [];
  } catch (error) {
    console.error('Error fetching sales:', error);
    return [];
  }
}

/**
 * Get floor price in ETH
 */
export async function getFloorPrice(): Promise<{ eth: number; usd: number } | null> {
  const stats = await getCollectionStats();

  if (!stats?.floorAsk?.price) {
    return null;
  }

  return {
    eth: stats.floorAsk.price.amount.native,
    usd: stats.floorAsk.price.amount.usd
  };
}

/**
 * Format ETH value for display
 */
export function formatEth(value: number): string {
  if (value >= 1) {
    return `${value.toFixed(3)} ETH`;
  }
  return `${value.toFixed(4)} ETH`;
}

/**
 * Format USD value for display
 */
export function formatUsd(value: number): string {
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(1)}K`;
  }
  return `$${value.toFixed(2)}`;
}

/**
 * Truncate address for display
 */
export function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default {
  getCollectionStats,
  getRecentSales,
  getSalesSince,
  getFloorPrice,
  formatEth,
  formatUsd,
  truncateAddress
};
