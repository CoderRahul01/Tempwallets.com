'use client';

import { formatBalance, formatBalanceSmart } from '@/lib/balance-utils';
import { useTokenIcon } from '@/lib/token-icons';
import { useWalletConfig } from '@/hooks/useWalletConfig';
import { CHAIN_NAMES } from './balance-view';

interface TokenBalanceItemProps {
  chain: string;
  symbol: string;
  balance: string;
  decimals: number;
  balanceHuman?: string;
  isNative?: boolean;
  chainName?: string;
  usdValue?: number;
}


/**
 * Presentational component for single token balance
 * Layout: Logo + Chain name on left, Balance + Symbol on right
 */
export function TokenBalanceItem({
  chain,
  symbol,
  balance,
  decimals,
  balanceHuman,
  usdValue,
}: TokenBalanceItemProps) {
  const Icon = useTokenIcon(chain, symbol);
  const walletConfig = useWalletConfig();
  const displayBalance = balanceHuman || formatBalanceSmart(balance, decimals);
  const chainName = CHAIN_NAMES[chain] || chain; // Derive chainName internally

  // Map Zerion/Internal chain IDs to config IDs to get the correct color
  const chainMap: Record<string, string> = {
    ethereum: 'ethereumErc4337',
    base: 'baseErc4337',
    arbitrum: 'arbitrumErc4337',
    polygon: 'polygonErc4337',
    avalanche: 'avalancheErc4337',
  };

  const configId = chainMap[chain] || chain;
  const config = walletConfig.getById(configId);
  const iconColor = config?.color || '#627EEA';

  return (
    <div className="flex items-center p-3 md:p-4 rounded-2xl border border-gray-100 bg-white hover:border-gray-200 transition-all shadow-sm">
      <div className="flex items-center w-full overflow-hidden">
        {/* Icon (Fixed Width) */}
        <div className="flex-shrink-0 flex items-center justify-center bg-gray-50 rounded-full p-2 mr-3 sm:mr-4">
          <Icon
            className="w-6 h-6 md:w-8 md:h-8"
            style={{ fill: 'currentColor', color: iconColor }}
          />
        </div>

        {/* Symbol (Fixed Width) */}
        <div className="flex-shrink-0 w-14 sm:w-16">
          <div className="text-base md:text-lg font-bold text-gray-900 font-rubik-medium truncate uppercase">
            {symbol}
          </div>
        </div>

        {/* Chain Tag (Fixed Width) */}
        <div className="flex-shrink-0 w-20 sm:w-24 ml-2 sm:ml-4">
          {chainName && (
            <div className="text-[9px] md:text-[10px] text-blue-500 font-rubik-medium bg-blue-500/10 px-2 py-0.5 rounded-full leading-tight whitespace-nowrap inline-block">
              {chainName}
            </div>
          )}
        </div>

        {/* Balance (Aligned Left) */}
        <div className="flex-shrink-0 ml-4 sm:ml-8 flex flex-col items-end">
          <div className="text-lg md:text-xl font-bold text-gray-900 font-rubik-bold">
            {displayBalance}
          </div>
          {usdValue !== undefined && (
            <div className="text-xs md:text-sm text-gray-500 font-rubik-normal">
              ${usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
