import getSupabaseClient, { DiscordVerification, DiscordPendingVerification, WalletPendingVerification } from './supabase';

/**
 * Supabase-backed database operations for Discord verification
 * Drop-in replacement for SQLite database module
 */
export const supabaseDatabase = {
  // Store pending verification (before Discord OAuth)
  storePending: async (sessionId: string, fid: number, wallet: string): Promise<boolean> => {
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from('discord_pending_verifications')
      .upsert({
        session_id: sessionId,
        fid,
        wallet: wallet.toLowerCase(),
        created_at: new Date().toISOString()
      });

    if (error) {
      console.error('Error storing pending verification:', error);
      return false;
    }
    return true;
  },

  // Get pending verification
  getPending: async (sessionId: string): Promise<DiscordPendingVerification | null> => {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('discord_pending_verifications')
      .select('*')
      .eq('session_id', sessionId)
      .single();

    if (error || !data) {
      return null;
    }
    return data as DiscordPendingVerification;
  },

  // Delete pending verification
  deletePending: async (sessionId: string): Promise<boolean> => {
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from('discord_pending_verifications')
      .delete()
      .eq('session_id', sessionId);

    if (error) {
      console.error('Error deleting pending verification:', error);
      return false;
    }
    return true;
  },

  // Store completed verification
  storeVerification: async (
    fid: number,
    wallet: string,
    discordId: string,
    discordUsername: string,
    nftBalance: number = 0
  ): Promise<boolean> => {
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from('discord_verifications')
      .upsert({
        fid,
        wallet: wallet.toLowerCase(),
        discord_id: discordId,
        discord_username: discordUsername,
        nft_balance: nftBalance,
        verified_at: new Date().toISOString(),
        last_checked: new Date().toISOString()
      }, {
        onConflict: 'discord_id'
      });

    if (error) {
      console.error('Error storing verification:', error);
      return false;
    }
    return true;
  },

  // Update NFT balance for existing verification
  updateNftBalance: async (discordId: string, nftBalance: number): Promise<boolean> => {
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from('discord_verifications')
      .update({
        nft_balance: nftBalance,
        last_checked: new Date().toISOString()
      })
      .eq('discord_id', discordId);

    if (error) {
      console.error('Error updating NFT balance:', error);
      return false;
    }
    return true;
  },

  // Get verification by Discord ID
  getVerificationByDiscord: async (discordId: string): Promise<DiscordVerification | null> => {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('discord_verifications')
      .select('*')
      .eq('discord_id', discordId)
      .single();

    if (error || !data) {
      return null;
    }
    return data as DiscordVerification;
  },

  // Get verification by wallet
  getVerificationByWallet: async (wallet: string): Promise<DiscordVerification | null> => {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('discord_verifications')
      .select('*')
      .eq('wallet', wallet.toLowerCase())
      .single();

    if (error || !data) {
      return null;
    }
    return data as DiscordVerification;
  },

  // Get verification by FID
  getVerificationByFid: async (fid: number): Promise<DiscordVerification | null> => {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('discord_verifications')
      .select('*')
      .eq('fid', fid)
      .single();

    if (error || !data) {
      return null;
    }
    return data as DiscordVerification;
  },

  // Get all verifications
  getAllVerifications: async (): Promise<DiscordVerification[]> => {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('discord_verifications')
      .select('*')
      .order('verified_at', { ascending: false });

    if (error) {
      console.error('Error getting all verifications:', error);
      return [];
    }
    return (data || []) as DiscordVerification[];
  },

  // Get verification count
  getVerifiedCount: async (): Promise<number> => {
    const supabase = getSupabaseClient();

    const { count, error } = await supabase
      .from('discord_verifications')
      .select('*', { count: 'exact', head: true });

    if (error) {
      console.error('Error getting verified count:', error);
      return 0;
    }
    return count || 0;
  },

  // Delete verification by Discord ID
  deleteVerification: async (discordId: string): Promise<boolean> => {
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from('discord_verifications')
      .delete()
      .eq('discord_id', discordId);

    if (error) {
      console.error('Error deleting verification:', error);
      return false;
    }
    return true;
  },

  // Clean up old pending verifications (older than 1 hour)
  cleanupOldPending: async (): Promise<number> => {
    const supabase = getSupabaseClient();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('discord_pending_verifications')
      .delete()
      .lt('created_at', oneHourAgo)
      .select();

    if (error) {
      console.error('Error cleaning up old pending verifications:', error);
      return 0;
    }
    return data?.length || 0;
  },

  // Get all verifications that need re-checking (not checked in last 24 hours)
  getStaleVerifications: async (): Promise<DiscordVerification[]> => {
    const supabase = getSupabaseClient();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('discord_verifications')
      .select('*')
      .lt('last_checked', oneDayAgo)
      .order('last_checked', { ascending: true })
      .limit(100);

    if (error) {
      console.error('Error getting stale verifications:', error);
      return [];
    }
    return (data || []) as DiscordVerification[];
  },

  // === WALLET-ONLY VERIFICATION METHODS ===

  // Store wallet pending verification with nonce
  storeWalletPending: async (sessionId: string, wallet: string, nonce: string): Promise<boolean> => {
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from('wallet_pending_verifications')
      .upsert({
        session_id: sessionId,
        wallet: wallet.toLowerCase(),
        nonce,
        verified: false,
        created_at: new Date().toISOString()
      });

    if (error) {
      console.error('Error storing wallet pending verification:', error);
      return false;
    }
    return true;
  },

  // Get wallet pending verification
  getWalletPending: async (sessionId: string): Promise<WalletPendingVerification | null> => {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('wallet_pending_verifications')
      .select('*')
      .eq('session_id', sessionId)
      .single();

    if (error || !data) {
      return null;
    }
    return data as WalletPendingVerification;
  },

  // Mark wallet pending as signature verified
  markWalletVerified: async (sessionId: string, signature: string): Promise<boolean> => {
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from('wallet_pending_verifications')
      .update({
        signature,
        verified: true
      })
      .eq('session_id', sessionId);

    if (error) {
      console.error('Error marking wallet verified:', error);
      return false;
    }
    return true;
  },

  // Delete wallet pending verification
  deleteWalletPending: async (sessionId: string): Promise<boolean> => {
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from('wallet_pending_verifications')
      .delete()
      .eq('session_id', sessionId);

    if (error) {
      console.error('Error deleting wallet pending verification:', error);
      return false;
    }
    return true;
  },

  // Store verification without FID (wallet-only users)
  storeWalletOnlyVerification: async (
    wallet: string,
    discordId: string,
    discordUsername: string,
    nftBalance: number = 0
  ): Promise<boolean> => {
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from('discord_verifications')
      .upsert({
        fid: 0, // No Farcaster ID for wallet-only users
        wallet: wallet.toLowerCase(),
        discord_id: discordId,
        discord_username: discordUsername,
        nft_balance: nftBalance,
        verified_at: new Date().toISOString(),
        last_checked: new Date().toISOString()
      }, {
        onConflict: 'discord_id'
      });

    if (error) {
      console.error('Error storing wallet-only verification:', error);
      return false;
    }
    return true;
  },

  // Clean up old wallet pending verifications (older than 1 hour)
  cleanupOldWalletPending: async (): Promise<number> => {
    const supabase = getSupabaseClient();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('wallet_pending_verifications')
      .delete()
      .lt('created_at', oneHourAgo)
      .select();

    if (error) {
      console.error('Error cleaning up old wallet pending verifications:', error);
      return 0;
    }
    return data?.length || 0;
  }
};

export default supabaseDatabase;
