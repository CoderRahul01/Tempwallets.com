const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';

export interface WalletAddresses {
  ethereum: string | null;
  base: string | null;
  arbitrum: string | null;
  polygon: string | null;
  tron: string | null;
  bitcoin: string | null;
  solana: string | null;
  ethereumErc4337: string | null;
  baseErc4337: string | null;
  arbitrumErc4337: string | null;
  polygonErc4337: string | null;
}

export interface WalletBalance {
  chain: string;
  balance: string;
}

export interface TokenBalance {
  address: string | null;
  symbol: string;
  balance: string;
  decimals: number;
}

// Any-chain aggregated asset returned by backend /wallet/assets-any
export interface AnyChainAsset {
  chain: string; // zerion chain id, e.g., ethereum | base | arbitrum | polygon | solana
  address: string | null; // null for native
  symbol: string;
  balance: string; // 18-decimal normalized string
  decimals: number;
}

export interface Transaction {
  txHash: string;
  from: string;
  to: string | null;
  value: string;
  timestamp: number | null;
  blockNumber: number | null;
  status: 'success' | 'failed' | 'pending';
  chain: string;
  tokenSymbol?: string;
  tokenAddress?: string;
}

export interface SendCryptoRequest {
  userId: string;
  chain: string;
  tokenAddress?: string;
  amount: string;
  recipientAddress: string;
}

export interface SendCryptoResponse {
  txHash: string;
}

export interface CreateOrImportSeedRequest {
  userId: string;
  mode: 'random' | 'mnemonic';
  mnemonic?: string;
}

export interface CreateOrImportSeedResponse {
  ok: boolean;
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      ...options,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorMessage = 'API request failed';
      try {
        const errorData = await response.json();
        errorMessage = errorData.message || errorData.error || errorMessage;
      } catch {
        const errorText = await response.text();
        errorMessage = errorText || errorMessage;
      }
      throw new ApiError(response.status, errorMessage);
    }

    return response.json();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError(408, 'Request timeout');
    }
    if (error instanceof Error && error.message.includes('fetch')) {
      throw new ApiError(503, 'Network error. Please check your connection.');
    }
    throw new ApiError(500, error instanceof Error ? error.message : 'Unknown error');
  }
}

export const walletApi = {
  /**
   * Create or import a wallet seed phrase
   */
  async createOrImportSeed(data: CreateOrImportSeedRequest): Promise<CreateOrImportSeedResponse> {
    return fetchApi<CreateOrImportSeedResponse>('/wallet/seed', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
   * Get all wallet addresses for a user
   */
  async getAddresses(userId: string): Promise<WalletAddresses> {
    return fetchApi<WalletAddresses>(`/wallet/addresses?userId=${encodeURIComponent(userId)}`);
  },

  /**
   * Get balances for all chains
   */
  async getBalances(userId: string): Promise<WalletBalance[]> {
    return fetchApi<WalletBalance[]>(`/wallet/balances?userId=${encodeURIComponent(userId)}`);
  },

  /**
   * Get ERC-4337 paymaster token balances
   */
  async getErc4337PaymasterBalances(userId: string): Promise<WalletBalance[]> {
    return fetchApi<WalletBalance[]>(`/wallet/erc4337/paymaster-balances?userId=${encodeURIComponent(userId)}`);
  },

  /**
   * Send crypto to a recipient address
   */
  async sendCrypto(data: SendCryptoRequest): Promise<SendCryptoResponse> {
    return fetchApi<SendCryptoResponse>('/wallet/send', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
   * Get token balances for a specific chain
   */
  async getTokenBalances(userId: string, chain: string): Promise<TokenBalance[]> {
    return fetchApi<TokenBalance[]>(
      `/wallet/token-balances?userId=${encodeURIComponent(userId)}&chain=${encodeURIComponent(chain)}`
    );
  },

  /**
   * Get transaction history for a specific chain
   */
  async getTransactionHistory(userId: string, chain: string, limit: number = 50): Promise<Transaction[]> {
    return fetchApi<Transaction[]>(
      `/wallet/transactions?userId=${encodeURIComponent(userId)}&chain=${encodeURIComponent(chain)}&limit=${limit}`
    );
  },

  /**
   * Get aggregated assets (any-chain) for primary addresses (EOA, ERC-4337, Solana)
   */
  async getAssetsAny(userId: string): Promise<AnyChainAsset[]> {
    return fetchApi<AnyChainAsset[]>(`/wallet/assets-any?userId=${encodeURIComponent(userId)}`);
  },

  /**
   * Get aggregated transactions (any-chain) for primary addresses
   */
  async getTransactionsAny(userId: string, limit: number = 100): Promise<Transaction[]> {
    return fetchApi<Transaction[]>(`/wallet/transactions-any?userId=${encodeURIComponent(userId)}&limit=${limit}`);
  },

  /**
   * Sign a WalletConnect transaction
   */
  async signWalletConnectTransaction(data: {
    userId: string;
    chainId: string;
    from: string;
    to?: string;
    value?: string;
    data?: string;
    gas?: string;
    gasPrice?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    nonce?: string;
  }): Promise<{ txHash: string }> {
    return fetchApi<{ txHash: string }>('/wallet/walletconnect/sign', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

/**
 * Helper function to subscribe to Server-Sent Events
 */
export function subscribeToSSE<T>(
  url: string,
  onMessage: (data: T) => void,
  onError?: (error: Error) => void,
  onComplete?: () => void,
): () => void {
  const eventSource = new EventSource(url);
  let isClosed = false;

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'complete') {
        if (onComplete) onComplete();
        eventSource.close();
        isClosed = true;
        return;
      }
      onMessage(data);
    } catch (error) {
      console.error('Error parsing SSE message:', error);
    }
  };

  eventSource.onerror = (error) => {
    console.error('SSE error:', error);
    if (onError) {
      onError(new Error('SSE connection error'));
    }
    if (!isClosed) {
      eventSource.close();
      isClosed = true;
    }
  };

  // Return cleanup function
  return () => {
    if (!isClosed) {
      eventSource.close();
      isClosed = true;
    }
  };
}

export { ApiError };
