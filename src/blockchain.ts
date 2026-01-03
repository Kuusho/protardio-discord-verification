import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import dotenv from 'dotenv';

dotenv.config();

let client: ReturnType<typeof createPublicClient> | null = null;

function getClient() {
  if (!client) {
    client = createPublicClient({
      chain: base,
      transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org')
    });
  }
  return client;
}

function getContractAddress(): `0x${string}` {
  return process.env.PROTARDIO_CONTRACT_ADDRESS as `0x${string}`;
}

// ERC-721 balanceOf ABI
const ERC721_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }]
  }
] as const;

export async function checkProtardioOwnership(wallet: string): Promise<boolean> {
  try {
    const balance = await getClient().readContract({
      address: getContractAddress(),
      abi: ERC721_ABI,
      functionName: 'balanceOf',
      args: [wallet as `0x${string}`]
    });

    return balance > 0n;
  } catch (error) {
    console.error('Error checking NFT ownership:', error);
    return false;
  }
}

export async function getProtardioBalance(wallet: string): Promise<number> {
  try {
    const balance = await getClient().readContract({
      address: getContractAddress(),
      abi: ERC721_ABI,
      functionName: 'balanceOf',
      args: [wallet as `0x${string}`]
    });

    return Number(balance);
  } catch (error) {
    console.error('Error getting NFT balance:', error);
    return 0;
  }
}
