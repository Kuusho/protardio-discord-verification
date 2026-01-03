import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

let supabaseClient: SupabaseClient | null = null;

/**
 * Creates a Supabase client with service role privileges.
 * Uses singleton pattern to avoid creating multiple clients.
 */
export function getSupabaseClient(): SupabaseClient {
  if (supabaseClient) {
    return supabaseClient;
  }

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error('Missing Supabase environment variables (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)');
  }

  supabaseClient = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return supabaseClient;
}

// Database types
export interface DiscordVerification {
  id?: number;
  fid: number;
  wallet: string;
  discord_id: string;
  discord_username: string | null;
  nft_balance: number;
  verified_at: string;
  last_checked: string;
}

export interface DiscordPendingVerification {
  id?: number;
  session_id: string;
  fid: number;
  wallet: string;
  created_at: string;
}

// Wallet-only pending verification (for non-Farcaster users)
export interface WalletPendingVerification {
  id?: number;
  session_id: string;
  wallet: string;
  nonce: string;
  signature?: string;
  verified: boolean;
  created_at: string;
}

export default getSupabaseClient;
