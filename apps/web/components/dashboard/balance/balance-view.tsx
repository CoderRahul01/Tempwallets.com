'use client';

import { useMemo, useState, useEffect } from 'react';
import Image from 'next/image';
import { Loader2, Zap, Info } from 'lucide-react';
import { walletApi, TokenBalance, AnyChainAsset, ApiError } from '@/lib/api';
import { TokenBalanceItem } from './token-balance-item';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@repo/ui/components/ui/tooltip';
import { useAuth } from '@/hooks/useAuth';

export const CHAIN_NAMES: Record<string, string> = {
  // Zerion canonical chain ids
  ethereum: 'Ethereum',
  base: 'Base',
  arbitrum: 'Arbitrum',
  polygon: 'Polygon',
  solana: 'Solana',
  avalanche: 'Avalanche',
  // Legacy/internal
  tron: 'Tron',
  bitcoin: 'Bitcoin',
  // Polkadot EVM Compatible chains
  moonbeamTestnet: 'Moonbeam Testnet',
  astarShibuya: 'Astar Shibuya',
  paseoPassetHub: 'Paseo PassetHub',
  // Substrate/Polkadot chains
  polkadot: 'Polkadot',
  hydrationSubstrate: 'Hydration',
  bifrostSubstrate: 'Bifrost',
  uniqueSubstrate: 'Unique',
  paseo: 'Paseo',
  paseoAssethub: 'Paseo AssetHub',
  // Testnets
  sepolia: 'Sepolia Testnet',
  // Gasless/Smart Account variants
  ethereumErc4337: 'Ethereum',
  baseErc4337: 'Base',
  arbitrumErc4337: 'Arbitrum',
  polygonErc4337: 'Polygon',
  avalancheErc4337: 'Avalanche',
  ethereumGasless: 'Ethereum',
  baseGasless: 'Base',
  arbitrumGasless: 'Arbitrum',
  polygonGasless: 'Polygon',
};

interface BalanceViewProps {
  selectedChainId: string;
}

/**
 * Container component that displays token balances
 * Fetches balances directly using walletApi to match send flow consistency
 */
export function BalanceView({ selectedChainId }: BalanceViewProps) {
  const { userId } = useAuth();
  const [balances, setBalances] = useState<AnyChainAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const fetchBalances = async () => {
      // Trace consistent ID usage
      if (!userId) return;

      setLoading(true);
      setError(null);
      // Clear previous balances while loading new chain to avoid confusion
      setBalances([]);

      try {
        // Fetch aggregated assets from all chains (Unified View)
        // FORCE refreshing to ensure we get latest data and clear any stale "empty" cache
        const allAssets = await walletApi.getAssetsAny(userId, true);

        if (mounted) {
          setBalances(allAssets);
        }
      } catch (err) {
        if (mounted) {
          console.error('[BalanceView] Failed to fetch balances:', err);
          setError('Failed to load balances');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    fetchBalances();

    return () => {
      mounted = false;
    };
  }, [userId]); // Removed selectedChainId dependency to show unified view

  const totalUsdForChain = useMemo(() => {
    return balances.reduce((sum, b) => sum + (b.usdValue || 0), 0);
  }, [balances]);

  // Sort: highest USD value first
  const sortedBalances = useMemo(() => {
    return [...balances].sort((a, b) => {
      const valA = a.usdValue || 0;
      const valB = b.usdValue || 0;
      return valB - valA; // Descending
    });
  }, [balances]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400 mb-4" />
        <p className="text-gray-500 font-rubik-normal text-center">
          Loading unified portfolio...
        </p>
      </div>
    );
  }

  // Show empty state
  if (balances.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 md:py-20">
        {/* Empty Mailbox GIF */}
        <div className="-mt-32">
          <Image
            src="/empty-mailbox-illustration-with-spiderweb-and-flie-2025-10-20-04-28-09-utc.gif"
            alt="Empty mailbox illustration"
            width={320}
            height={320}
            className="object-contain mix-blend-multiply"
          />
        </div>
        <p className="text-gray-600 text-lg md:text-xl font-rubik-medium z-10 -mt-16">
          {error ? error : "No Assets Found"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Total Balance and Unified Balance Button */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-sm text-gray-500 font-rubik-normal uppercase tracking-wider">Total Balance</span>
          <span className="text-2xl md:text-3xl font-bold text-gray-900 font-rubik-bold">
            ${totalUsdForChain.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                disabled
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-100 rounded-lg cursor-not-allowed opacity-60 border border-gray-200"
              >
                <Zap className="h-3.5 w-3.5" />
                Unified Balance
                <Info className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-xs">
              <p className="text-xs">
                Add funds to your Lightning Network unified balance for gasless transfers. Coming soon!
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="space-y-2">
        <div className="space-y-2">
          {sortedBalances.map((balance, index) => {
            const isNative = !balance.address;
            const key = `${balance.chain}-${balance.symbol}-${index}`;

            return (
              <TokenBalanceItem
                key={key}
                chain={balance.chain} // Use asset's specific chain
                symbol={balance.symbol}
                balance={balance.balance}
                decimals={balance.decimals}
                balanceHuman={balance.balanceHuman}
                isNative={isNative}
                usdValue={balance.usdValue}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

