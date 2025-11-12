"use client";

import { useState, useEffect } from "react";
import { Button } from "@repo/ui/components/ui/button";
import { Card } from "@repo/ui/components/ui/card";
import { Loader2, Send, RefreshCw, AlertCircle } from "lucide-react";
import { walletApi, TokenBalance, ApiError } from "@/lib/api";
import { useBrowserFingerprint } from "@/hooks/useBrowserFingerprint";
import { SendCryptoModal } from "@/components/dashboard/send-crypto-modal";
import RecentTransactions from "@/components/dashboard/recent-transactions";

const CHAIN_NAMES: Record<string, string> = {
  // Zerion canonical chain ids
  ethereum: "Ethereum",
  base: "Base",
  arbitrum: "Arbitrum",
  polygon: "Polygon",
  solana: "Solana",
  // Legacy/internal (not expected here but kept as fallback)
  tron: "Tron",
  bitcoin: "Bitcoin",
  ethereumErc4337: "Ethereum (ERC-4337)",
  baseErc4337: "Base (ERC-4337)",
  arbitrumErc4337: "Arbitrum (ERC-4337)",
  polygonErc4337: "Polygon (ERC-4337)",
};

const NATIVE_TOKEN_SYMBOLS: Record<string, string> = {
  // Zerion canonical chains
  ethereum: 'ETH',
  base: 'ETH',
  arbitrum: 'ETH',
  polygon: 'MATIC',
  solana: 'SOL',
  // Legacy/internal fallbacks
  tron: 'TRX',
  bitcoin: 'BTC',
  ethereumErc4337: 'ETH',
  baseErc4337: 'ETH',
  arbitrumErc4337: 'ETH',
  polygonErc4337: 'MATIC',
};

const getNativeTokenSymbol = (chain: string): string => {
  return NATIVE_TOKEN_SYMBOLS[chain] || 'TOKEN';
};

// All balances coming from assets-any are normalized to 18 decimals on the backend
const formatBalance = (balance: string): string => {
  const num = parseFloat(balance);
  if (isNaN(num)) return "0";
  return (num / Math.pow(10, 18)).toFixed(6).replace(/\.?0+$/, "");
};

interface ChainBalance {
  chain: string;
  nativeBalance: string;
  tokens: TokenBalance[];
}

export default function TransactionsPage() {
  const { fingerprint } = useBrowserFingerprint();
  const [chainBalances, setChainBalances] = useState<ChainBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedChain, setSelectedChain] = useState<string | null>(null);
  const [sendModalOpen, setSendModalOpen] = useState(false);
  // No per-chain error tracking needed with any-chain fetch

  useEffect(() => {
    if (fingerprint) {
      loadBalances();
    }
  }, [fingerprint]);

  const loadBalances = async () => {
    if (!fingerprint) return;

    setLoading(true);
    setError(null);
    setChainBalances([]);

    try {
      const assets = await walletApi.getAssetsAny(fingerprint);

      // Group assets by chain and split native vs tokens
      const map = new Map<string, ChainBalance>();
      for (const a of assets) {
        const existing = map.get(a.chain) || { chain: a.chain, nativeBalance: '0', tokens: [] as TokenBalance[] };
        if (a.address === null) {
          // Native token (already normalized to 18 decimals)
          existing.nativeBalance = a.balance;
        } else {
          existing.tokens.push({ address: a.address, symbol: a.symbol, balance: a.balance, decimals: 18 });
        }
        map.set(a.chain, existing);
      }

      setChainBalances(Array.from(map.values()));
    } catch (err) {
      const errorMessage = err instanceof ApiError ? err.message : 'Failed to load balances. Please try again.';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // Map Zerion chain ids to backend internal chain identifiers for sending
  const mapChainForSend = (chain: string): string | null => {
    const m: Record<string, string> = {
      ethereum: 'ethereum',
      base: 'baseErc4337',
      arbitrum: 'arbitrumErc4337',
      polygon: 'polygonErc4337',
      solana: 'solana',
    };
    return m[chain] || null;
  };

  const handleSendClick = (chain: string) => {
    const mapped = mapChainForSend(chain);
    if (!mapped) return;
    setSelectedChain(mapped);
    setSendModalOpen(true);
  };

  const handleSendSuccess = () => {
    // Reload balances after successful send
    if (fingerprint) {
      loadBalances();
    }
  };

  // No per-chain retry now; full reload is enough

  return (
    <div className="min-h-screen py-24 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-white">All Transactions</h1>
          <Button
            variant="outline"
            size="sm"
            onClick={loadBalances}
            disabled={loading}
            className="text-white border-white/20 hover:bg-white/10"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Balance Cards */}
        <div className="mb-8 space-y-4">
          {loading && chainBalances.length === 0 ? (
            <Card className="p-8 text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">Loading balances...</p>
            </Card>
          ) : error && chainBalances.length === 0 ? (
            <Card className="p-8 text-center border-destructive">
              <AlertCircle className="h-8 w-8 mx-auto mb-4 text-destructive" />
              <p className="text-destructive mb-4">{error}</p>
              <Button onClick={loadBalances} variant="outline">
                Retry
              </Button>
            </Card>
          ) : (
            <>
              {chainBalances
                .filter((chainBalance) => {
                  // Only show chains with non-zero balance
                  const nativeBalance = parseFloat(chainBalance.nativeBalance);
                  const hasTokenBalance = chainBalance.tokens.some(token => parseFloat(token.balance) > 0);
                  return nativeBalance > 0 || hasTokenBalance;
                })
                .length === 0 ? (
                <Card className="p-8 text-center">
                  <p className="text-muted-foreground">No balances found. Wallets are empty.</p>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {chainBalances
                    .filter((chainBalance) => {
                      // Only show chains with non-zero balance
                      const nativeBalance = parseFloat(chainBalance.nativeBalance);
                      const hasTokenBalance = chainBalance.tokens.some(token => parseFloat(token.balance) > 0);
                      return nativeBalance > 0 || hasTokenBalance;
                    })
                    .map((chainBalance) => {
                const chainName = CHAIN_NAMES[chainBalance.chain] || chainBalance.chain;
                const formattedNative = formatBalance(chainBalance.nativeBalance);
                
                // Format token balances (only non-zero)
                const formattedTokens = chainBalance.tokens
                  .filter(token => parseFloat(token.balance) > 0)
                  .map(token => {
                    const tokenBalanceNum = parseFloat(token.balance);
                    const formatted = (tokenBalanceNum / Math.pow(10, 18)).toFixed(6).replace(/\.?0+$/, "");
                    return { ...token, formatted };
                  });
                
                // Total tokens count (native + other tokens)
                const totalTokens = formattedTokens.length + (parseFloat(chainBalance.nativeBalance) > 0 ? 1 : 0);
                
                return (
                  <Card key={chainBalance.chain} className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-semibold text-lg mb-2">{chainName}</h3>
                        <div className="space-y-1">
                            {/* Native token balance */}
                            {parseFloat(chainBalance.nativeBalance) > 0 && (
                              <p className="text-xl font-bold text-muted-foreground">
                                {formattedNative} {getNativeTokenSymbol(chainBalance.chain)}
                              </p>
                            )}
                            {/* Token balances */}
                            {formattedTokens.map((token) => (
                              <p key={token.address} className="text-lg font-semibold text-muted-foreground/80">
                                {token.formatted} {token.symbol}
                              </p>
                            ))}
                        </div>
                      </div>
                      <Button
                        onClick={() => handleSendClick(chainBalance.chain)}
                        className="ml-4"
                      >
                        <Send className="h-4 w-4 mr-2" />
                        Send
                      </Button>
                    </div>
                  </Card>
                );
              })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Send Modal */}
        {selectedChain && fingerprint && (
          <SendCryptoModal
            open={sendModalOpen}
            onOpenChange={setSendModalOpen}
            chain={selectedChain}
            userId={fingerprint}
            onSuccess={handleSendSuccess}
          />
        )}

        {/* Transaction List */}
        <div className="mt-8">
          <RecentTransactions showAll={true} />
        </div>
      </div>
    </div>
  );
}