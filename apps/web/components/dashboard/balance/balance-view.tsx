'use client';

import { useMemo } from 'react';
import Image from 'next/image';
import { Loader2, Zap, Info } from 'lucide-react';
import { useWalletData } from '@/hooks/useWalletData';
import { TokenBalanceItem } from './token-balance-item';
import { NormalizedBalance } from '@/types/wallet-data';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@repo/ui/components/ui/tooltip';

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
 * Uses useWalletData hook to get balances from provider
 */
export function BalanceView({ selectedChainId }: BalanceViewProps) {
  const { balances: realBalances, loading, errors } = useWalletData();

  const balances = useMemo(() => {
    return realBalances.filter(b => b.chain === selectedChainId);
  }, [realBalances, selectedChainId]);

  const totalUsdForChain = useMemo(() => {
    // Each entry in realBalances for this chain has totalBalanceUsd
    // We just need it from any one entry, or we can sum usdValue
    return balances.reduce((sum, b) => sum + (b.usdValue || 0), 0);
  }, [balances]);

  // Group balances by chain and filter to show only non-zero balances
  const groupedBalances = useMemo(() => {
    // Group by chain
    const byChain = new Map<string, NormalizedBalance[]>();

    for (const balance of balances) {
      // Only include balances that are greater than 0
      const balanceValue = parseFloat(balance.balance);
      if (balanceValue <= 0) continue;

      const existing = byChain.get(balance.chain) || [];
      existing.push(balance);
      byChain.set(balance.chain, existing);
    }

    // Convert to array and sort by chain name
    const grouped: Array<{ chain: string; balances: NormalizedBalance[] }> = [];

    for (const [chain, chainBalances] of byChain.entries()) {
      // Sort: native first, then by symbol
      const sorted = chainBalances.sort((a, b) => {
        if (a.isNative && !b.isNative) return -1;
        if (!a.isNative && b.isNative) return 1;
        return a.symbol.localeCompare(b.symbol);
      });

      grouped.push({ chain, balances: sorted });
    }

    // Sort groups by chain name
    grouped.sort((a, b) => a.chain.localeCompare(b.chain));

    return grouped;
  }, [balances]);

  // Show loading state if explicitly loading (e.g., manual refresh or switch)
  // or if we have no data yet
  const isRefreshing = loading.balances;
  const hasNoData = groupedBalances.length === 0;

  if (isRefreshing && hasNoData) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400 mb-4" />
        <p className="text-gray-500 font-rubik-normal text-center">
          Searching for balances...
        </p>
      </div>
    );
  }

  // Show empty state (including when there are errors)
  if (groupedBalances.length === 0 || (errors.balances && balances.length === 0)) {
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
          No Balance Available
        </p>
      </div>
    );
  }

  // Render balances grouped by chain
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

      {groupedBalances.map(({ chain, balances: chainBalances }) => (
        <div key={chain} className="space-y-2">
          <div className="space-y-2">
            {chainBalances.map((balance, index) => {
              // Only non-zero balances are shown (filtered in groupedBalances)
              const key = balance.isNative
                ? `${chain}-native-${index}`
                : `${chain}-${balance.address || balance.symbol}-${index}`;

              return (
                <TokenBalanceItem
                  key={key}
                  chain={balance.chain}
                  symbol={balance.symbol}
                  balance={balance.balance}
                  decimals={balance.decimals}
                  balanceHuman={balance.balanceHuman}
                  isNative={balance.isNative}
                  chainName={CHAIN_NAMES[chain] || chain}
                  usdValue={balance.usdValue}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

