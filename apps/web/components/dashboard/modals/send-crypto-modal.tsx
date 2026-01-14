"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/ui/dialog";
import { Button } from "@repo/ui/components/ui/button";
import { Input } from "@repo/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/ui/select";
import { Label } from "@repo/ui/components/ui/label";
import { Loader2, AlertCircle, CheckCircle2, ExternalLink, Zap, Clipboard } from "lucide-react";
import { walletApi, TokenBalance, ApiError, AnyChainAsset } from "@/lib/api";
import { useTokenIcon } from "@/lib/token-icons";
import { trackTransaction } from "@/lib/tempwallets-analytics";
import { MOCK_BALANCES } from "@/lib/dummy-data";
import { chains, getChainById } from "@/lib/chains";

interface SendCryptoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chain: string;
  userId: string;
  onSuccess?: () => void;
}

// Clean chain names (without technical suffixes)
const CHAIN_NAMES: Record<string, string> = {
  ethereum: "Ethereum",
  tron: "Tron",
  bitcoin: "Bitcoin",
  solana: "Solana",
  // EOA chains
  base: "Base",
  arbitrum: "Arbitrum",
  polygon: "Polygon",
  avalanche: "Avalanche",
  // Polkadot EVM Compatible chains
  moonbeamTestnet: "Moonbeam Testnet",
  astarShibuya: "Astar Shibuya",
  paseoPassetHub: "Paseo PassetHub",
  // Substrate/Polkadot chains
  polkadot: "Polkadot",
  hydrationSubstrate: "Hydration",
  bifrostSubstrate: "Bifrost",
  uniqueSubstrate: "Unique",
  paseo: "Paseo",
  paseoAssethub: "Paseo AssetHub",
  // Aptos chains
  aptos: "Aptos",
  aptosTestnet: "Aptos Testnet",
  // EIP-7702 Gasless chains
  ethereumGasless: "Ethereum",
  baseGasless: "Base",
  arbitrumGasless: "Arbitrum",
  optimismGasless: "Optimism",
  polygonGasless: "Polygon",
  sepoliaGasless: "Sepolia",
  baseSepoliaGasless: "Base Sepolia",
  // ERC-4337 Smart Account chains (from wallet-config.ts)
  ethereumErc4337: "Ethereum",
  baseErc4337: "Base",
  arbitrumErc4337: "Arbitrum",
  polygonErc4337: "Polygon",
  avalancheErc4337: "Avalanche",
};

// EIP-7702 chain ID mapping
// ✅ FIX: Include both base chain names and ERC4337 variants
const EIP7702_CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  base: 8453,
  baseErc4337: 8453, // ✅ Add ERC4337 variant
  arbitrum: 42161,
  arbitrumErc4337: 42161, // ✅ Add ERC4337 variant
  optimism: 10,
  polygon: 137,
  polygonErc4337: 137, // ✅ Add ERC4337 variant
  avalanche: 43114,
  avalancheErc4337: 43114, // ✅ Add ERC4337 variant
  // Only chains confirmed for EIP-7702 gasless flow
  sepolia: 11155111,
};

// ✅ FIX: Check both direct chain name and normalized version
const isEip7702Chain = (chain: string): boolean => {
  // Direct check
  if (chain in EIP7702_CHAIN_IDS) return true;

  // Normalize chain name (remove Erc4337 suffix for base chains)
  const normalized = chain.replace(/Erc4337$/i, '').toLowerCase();
  return normalized in EIP7702_CHAIN_IDS;
};

// Address validation per chain type
const validateAddress = (address: string, chain: string): string | null => {
  if (!address || address.trim().length === 0) {
    return "Recipient address is required";
  }

  const trimmed = address.trim();

  const evmChains = [
    "ethereum", "base", "arbitrum", "polygon", "avalanche",
    "optimism", "sepolia",
  ];
  if (evmChains.includes(chain)) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
      return "Invalid Ethereum address format (must start with 0x and be 42 characters)";
    }
  }

  // Tron
  if (chain === "tron") {
    if (!/^T[A-Za-z1-9]{33}$/.test(trimmed)) {
      return "Invalid Tron address format (must start with T and be 34 characters)";
    }
  }

  // Bitcoin
  if (chain === "bitcoin") {
    if (!/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-z0-9]{39,59}$/.test(trimmed)) {
      return "Invalid Bitcoin address format";
    }
  }

  // Solana
  if (chain === "solana") {
    if (trimmed.length < 32 || trimmed.length > 44) {
      return "Invalid Solana address format (must be 32-44 characters)";
    }
  }

  // Substrate/Polkadot chains (SS58 format)
  const SUBSTRATE_CHAINS = ["polkadot", "hydrationSubstrate", "bifrostSubstrate", "uniqueSubstrate", "paseo", "paseoAssethub"];
  if (SUBSTRATE_CHAINS.includes(chain)) {
    // SS58 addresses are typically 48 characters, but can vary
    // Basic validation: should be alphanumeric and reasonable length
    if (trimmed.length < 32 || trimmed.length > 50 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(trimmed)) {
      return "Invalid Substrate address format (SS58 encoded, typically 32-50 characters)";
    }
  }

  // Aptos chains (0x-prefixed hex, 64 characters)
  if (chain === "aptos" || chain === "aptosTestnet") {
    if (!/^0x[a-fA-F0-9]{64}$/.test(trimmed)) {
      return "Invalid Aptos address format (must start with 0x and be 66 characters)";
    }
  }

  return null;
};

/**
 * Format transaction hash for block explorer
 * Substrate chains need hash without 0x prefix for Subscan
 */
const formatTxHashForExplorer = (hash: string, isSubstrate: boolean = false): string => {
  if (!hash) return '';
  // Remove 0x prefix for Substrate chains (Subscan expects it without prefix)
  if (isSubstrate && hash.startsWith('0x')) {
    return hash.slice(2);
  }
  return hash;
};

const getExplorerUrl = (txHash: string, chain: string): string => {
  if (!txHash) return '#';

  // Determine if this is a testnet chain
  const isTestnet = chain === 'paseo' || chain === 'paseoAssethub' ||
    chain === 'moonbeamTestnet' || chain === 'astarShibuya' ||
    chain === 'paseoPassetHub';

  // EVM chains (testnet support)
  const evmExplorers: Record<string, { mainnet: string; testnet?: string }> = {
    ethereum: { mainnet: 'https://etherscan.io', testnet: 'https://sepolia.etherscan.io' },
    base: { mainnet: 'https://basescan.org', testnet: 'https://sepolia.basescan.org' },
    arbitrum: { mainnet: 'https://arbiscan.io', testnet: 'https://sepolia.arbiscan.io' },
    polygon: { mainnet: 'https://polygonscan.com', testnet: 'https://mumbai.polygonscan.com' },
    avalanche: { mainnet: 'https://snowtrace.io', testnet: 'https://testnet.snowtrace.io' },
    moonbeamTestnet: { mainnet: 'https://moonscan.io', testnet: 'https://moonbase.moonscan.io' },
    astarShibuya: { mainnet: 'https://astar.subscan.io', testnet: 'https://shibuya.subscan.io' },
    paseoPassetHub: { mainnet: 'https://assethub-polkadot.subscan.io', testnet: 'https://assethub-paseo.subscan.io' },
  };

  // Check if it's an EVM chain
  const evmChain = chain;
  if (evmExplorers[evmChain]) {
    const explorer = isTestnet && evmExplorers[evmChain].testnet
      ? evmExplorers[evmChain].testnet
      : evmExplorers[evmChain].mainnet;
    return `${explorer}/tx/${txHash}`;
  }

  // Non-EVM chains
  const nonEvmExplorers: Record<string, string> = {
    tron: `https://tronscan.org/#/transaction/${txHash}`,
    bitcoin: `https://blockstream.info/tx/${txHash}`,
    solana: `https://solscan.io/tx/${txHash}`,
    aptos: `https://explorer.aptoslabs.com/?network=mainnet&transaction=${txHash}`,
    aptosTestnet: `https://explorer.aptoslabs.com/?network=testnet&transaction=${txHash}`,
  };

  if (nonEvmExplorers[chain]) {
    return nonEvmExplorers[chain];
  }

  // Substrate/Polkadot chains - use Subscan
  const substrateExplorers: Record<string, { mainnet: string; testnet: string }> = {
    polkadot: {
      mainnet: 'https://polkadot.subscan.io',
      testnet: 'https://paseo.subscan.io'
    },
    hydrationSubstrate: {
      mainnet: 'https://hydradx.subscan.io',
      testnet: 'https://hydradx-testnet.subscan.io'
    },
    bifrostSubstrate: {
      mainnet: 'https://bifrost.subscan.io',
      testnet: 'https://bifrost-testnet.subscan.io'
    },
    uniqueSubstrate: {
      mainnet: 'https://unique.subscan.io',
      testnet: 'https://unique-testnet.subscan.io'
    },
    paseo: {
      mainnet: 'https://paseo.subscan.io',
      testnet: 'https://paseo.subscan.io'
    },
    paseoAssethub: {
      mainnet: 'https://assethub-polkadot.subscan.io',
      testnet: 'https://assethub-paseo.subscan.io'
    },
  };

  if (substrateExplorers[chain]) {
    const explorer = isTestnet ? substrateExplorers[chain].testnet : substrateExplorers[chain].mainnet;
    const formattedHash = formatTxHashForExplorer(txHash, true);
    return `${explorer}/extrinsic/${formattedHash}`;
  }

  return '#';
};

// Component to render selected token in trigger with network icon
interface SelectedTokenDisplayProps {
  token: TokenBalance;
}

function SelectedTokenDisplay({ token }: SelectedTokenDisplayProps) {
  const NetworkIcon = useTokenIcon(token.chain || 'ethereum');

  // Format balance
  const formatBalance = (balance: string, decimals: number): string => {
    const num = parseFloat(balance);
    if (isNaN(num)) return "0";
    return (num / Math.pow(10, decimals)).toFixed(6).replace(/\.?0+$/, "");
  };

  return (
    <div className="flex items-center gap-2">
      <NetworkIcon className="h-4 w-4 flex-shrink-0" />
      <span>
        {token.symbol} - {formatBalance(token.balance, token.decimals)}
      </span>
    </div>
  );
}

// Component to render token with network icon in dropdown
interface TokenSelectItemProps {
  value: string;
  token: TokenBalance;
}

function TokenSelectItem({ value, token }: TokenSelectItemProps) {
  const NetworkIcon = useTokenIcon(token.chain || 'ethereum');

  // Format balance
  const formatBalance = (balance: string, decimals: number): string => {
    const num = parseFloat(balance);
    if (isNaN(num)) return "0";
    return (num / Math.pow(10, decimals)).toFixed(6).replace(/\.?0+$/, "");
  };

  return (
    <SelectItem
      value={value}
      className="text-sm focus:bg-white/10 focus:text-white"
    >
      <div className="flex items-center gap-2">
        <NetworkIcon className="h-4 w-4 flex-shrink-0" />
        <span className="flex-1">
          {token.symbol} - {formatBalance(token.balance, token.decimals)}
        </span>
      </div>
    </SelectItem>
  );
}

export function SendCryptoModal({ open, onOpenChange, chain, userId, onSuccess }: SendCryptoModalProps) {
  const [activeChainId, setActiveChainId] = useState(chain);
  // Get chain icon
  const ChainIcon = useTokenIcon(activeChainId);
  const [tokens, setTokens] = useState<TokenBalance[]>([]);
  const [selectedToken, setSelectedToken] = useState<TokenBalance | null>(null);
  const [amount, setAmount] = useState("");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ amount?: string; address?: string }>({});
  const [txHash, setTxHash] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const loadTokens = useCallback(async () => {
    setLoadingTokens(true);
    setError(null);
    try {
      // Check if this is a Substrate chain
      const SUBSTRATE_CHAINS = ["polkadot", "hydrationSubstrate", "bifrostSubstrate", "uniqueSubstrate", "paseo", "paseoAssethub"];
      const isSubstrate = SUBSTRATE_CHAINS.includes(chain);

      // Check if this is an Aptos chain
      const APTOS_CHAINS = ["aptos", "aptosTestnet"];
      const isAptos = APTOS_CHAINS.includes(chain);

      if (isSubstrate) {
        // Load Substrate balances
        const balances = await walletApi.getSubstrateBalances(userId, false);
        const chainBalance = balances[activeChainId];

        if (chainBalance && chainBalance.address) {
          // Create a single token entry for native Substrate token
          const tokenList: TokenBalance[] = [{
            address: null, // Native token
            symbol: chainBalance.token,
            balance: chainBalance.balance,
            decimals: chainBalance.decimals,
            chain: activeChainId,
          }];
          setTokens(tokenList);
          setSelectedToken(tokenList[0] ?? null);
        } else {
          setTokens([]);
          setError("No address found for this Substrate chain");
        }
      } else if (isAptos) {
        // Load Aptos balance
        const network = activeChainId === "aptosTestnet" ? "testnet" : "mainnet";
        const balanceData = await walletApi.getAptosBalance(userId, network);

        // Create a single token entry for native APT token
        const tokenList: TokenBalance[] = [{
          address: null, // Native token
          symbol: "APT",
          balance: (parseFloat(balanceData.balance) * Math.pow(10, 8)).toString(), // Convert to octas (8 decimals)
          decimals: 8,
          chain: activeChainId,
        }];
        setTokens(tokenList);
        setSelectedToken(tokenList[0] ?? null);
      } else {
        // Load aggregated assets once (any-chain). Zerion assets are the source of truth.
        const allAssets: AnyChainAsset[] = await walletApi.getAssetsAny(userId, true);

        // Map activeChainId to Zerion chain identifier
        // Technical IDs (like baseGasless, polygonErc4337) map to base chain names
        const getZerionChainId = (id: string): string => {
          const mapping: Record<string, string> = {
            ethereumErc4337: 'ethereum',
            baseErc4337: 'base',
            arbitrumErc4337: 'arbitrum',
            polygonErc4337: 'polygon',
            avalancheErc4337: 'avalanche',
            ethereumGasless: 'ethereum',
            baseGasless: 'base',
            arbitrumGasless: 'arbitrum',
            optimismGasless: 'optimism',
            polygonGasless: 'polygon',
            sepoliaGasless: 'sepolia',
            baseSepoliaGasless: 'baseSepolia',
          };
          return mapping[id] || id;
        };

        const targetChain = getZerionChainId(activeChainId);

        // Filter and merge assets for the target chain
        const matchingAssets = allAssets.filter(a => a.chain === targetChain);
        const matchingMocks = MOCK_BALANCES.filter(m => m.chain === targetChain);

        // Merge with mock data for UI testing if no real assets found or for demonstration
        const mergedAssets = [...matchingAssets, ...matchingMocks.filter(m =>
          !matchingAssets.some(a => a.symbol === m.symbol)
        )].map(m => ({
          ...m,
          name: (m as any).name || (m as any).symbol,
          price: (m as any).price || 0,
          value: (m as any).value || 0,
        }));

        // Sorting: native first if address null, then alphabetically by symbol.
        const tokenList: TokenBalance[] = mergedAssets
          .filter((a) => !!a.symbol)
          .map((a) => ({
            address: a.address,
            symbol: a.symbol,
            balance: a.balance,
            decimals: a.decimals,
            chain: a.chain, // Preserve the token's chain from Zerion
          }))
          .sort((a, b) => {
            if (a.address === null && b.address !== null) return -1;
            if (a.address !== null && b.address === null) return 1;
            return a.symbol.localeCompare(b.symbol);
          });

        setTokens(tokenList);
        if (tokenList.length > 0) {
          setSelectedToken(tokenList[0] ?? null);
        } else {
          setSelectedToken(null);
        }
      }
    } catch (err) {
      const errorMessage = err instanceof ApiError
        ? err.message
        : "Failed to load tokens. Please try again.";
      setError(errorMessage);
    } finally {
      setLoadingTokens(false);
    }
  }, [userId, activeChainId]);

  // Load tokens when modal opens
  useEffect(() => {
    if (open && userId && activeChainId) {
      loadTokens();
    } else {
      // Reset state when modal closes
      setTokens([]);
      setSelectedToken(null);
      setAmount("");
      setRecipientAddress("");
      setError(null);
      setFieldErrors({});
      setTxHash(null);
      setSuccess(false);
    }
  }, [open, userId, activeChainId, loadTokens]);

  // Sync activeChainId with chain prop when modal opens
  useEffect(() => {
    if (open) {
      setActiveChainId(chain);
    }
  }, [open, chain]);

  const validateForm = (): boolean => {
    const errors: { amount?: string; address?: string } = {};

    // Validate amount
    if (!amount || amount.trim().length === 0) {
      errors.amount = "Amount is required";
    } else {
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        errors.amount = "Amount must be a positive number";
      } else if (selectedToken) {
        // Convert balance from smallest units using actual token decimals
        const available = parseFloat(selectedToken.balance) / Math.pow(10, selectedToken.decimals);
        if (amountNum > available) {
          errors.amount = `Insufficient balance. Available: ${formatBalance(selectedToken.balance, selectedToken.decimals)} ${selectedToken.symbol}`;
        }
      }
    }

    // Validate recipient address
    const addressError = validateAddress(recipientAddress, chain);
    if (addressError) {
      errors.address = addressError;
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Convert balance from smallest units to human-readable using actual token decimals
  const formatBalance = (balance: string, decimals: number): string => {
    const num = parseFloat(balance);
    if (isNaN(num)) return "0";
    return (num / Math.pow(10, decimals)).toFixed(6).replace(/\.?0+$/, "");
  };

  // Handle pasting from clipboard
  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        setRecipientAddress(text.trim());
        // Clear any existing address errors when pasting
        if (fieldErrors.address) {
          setFieldErrors({ ...fieldErrors, address: undefined });
        }
      }
    } catch (err) {
      console.error('Failed to read clipboard:', err);
      setError('Failed to read clipboard. Please paste manually.');
    }
  };

  const handleSend = async () => {
    if (!validateForm() || !selectedToken) {
      return;
    }

    // CRITICAL: Validate that Zerion provided decimals for this token
    if (selectedToken.decimals === undefined || selectedToken.decimals === null) {
      setError(
        `Token data incomplete: ${selectedToken.symbol} is missing decimals information from Zerion. ` +
        `Please try refreshing your wallet data or contact support.`
      );
      return;
    }

    // Validate decimals are in valid range
    if (selectedToken.decimals < 0 || selectedToken.decimals > 36) {
      setError(
        `Invalid token decimals: ${selectedToken.decimals}. Decimals must be between 0 and 36.`
      );
      return;
    }

    // Validate that token has chain information
    if (!selectedToken.chain) {
      setError(
        `Token data incomplete: ${selectedToken.symbol} is missing chain information. ` +
        `Please try refreshing your wallet data or contact support.`
      );
      return;
    }

    // Track send button click (already tracked in wallet-info, but track here too for modal context)
    trackTransaction.sendClicked();

    setLoading(true);
    setError(null);

    try {
      // Use the selected token's chain, falling back to active modal chain
      const tokenChain = selectedToken.chain || activeChainId;

      // Log token send details for debugging
      console.log('[Send Debug] Sending token:', {
        symbol: selectedToken.symbol,
        address: selectedToken.address,
        decimals: selectedToken.decimals,
        amount: amount,
        tokenChain: tokenChain,
        modalChain: chain,
      });

      // 🔍 DETAILED CHAIN DETECTION DEBUG
      console.log('🔍 [Chain Detection] Avalanche EIP-7702 Check:', {
        selectedTokenChain: selectedToken.chain,
        modalChain: chain,
        finalTokenChain: tokenChain,
        isInEIP7702Mapping: tokenChain in EIP7702_CHAIN_IDS,
        chainIdFromMapping: EIP7702_CHAIN_IDS[tokenChain],
        allEIP7702Chains: Object.keys(EIP7702_CHAIN_IDS),
      });

      // Check if this is a Substrate chain
      const SUBSTRATE_CHAINS = ["polkadot", "hydrationSubstrate", "bifrostSubstrate", "uniqueSubstrate", "paseo", "paseoAssethub"];
      const isSubstrate = SUBSTRATE_CHAINS.includes(tokenChain);

      // Check if this is an Aptos chain
      const APTOS_CHAINS = ["aptos", "aptosTestnet"];
      const isAptos = APTOS_CHAINS.includes(tokenChain);

      // ✅ FIX: Check if this is an EIP-7702 gasless chain
      // Normalize chain name first (handle both 'base' and 'baseErc4337')
      const normalizedChain = tokenChain.replace(/Erc4337$/i, '').toLowerCase();
      const isGasless = isEip7702Chain(normalizedChain) || isEip7702Chain(tokenChain);

      // 🔍 LOG WHICH ENDPOINT WILL BE USED
      if (isGasless) {
        const chainId = EIP7702_CHAIN_IDS[normalizedChain] || EIP7702_CHAIN_IDS[tokenChain];
        console.log('✅ [Endpoint] Using EIP-7702 gasless endpoint (/wallet/eip7702/send)');
        console.log('✅ [ChainID]', chainId, `(from ${normalizedChain} or ${tokenChain})`);
      } else if (isSubstrate) {
        console.log('ℹ️ [Endpoint] Using Substrate endpoint');
      } else if (isAptos) {
        console.log('ℹ️ [Endpoint] Using Aptos endpoint');
      } else {
        console.log('⚠️ [Endpoint] Using regular sendCrypto endpoint (/wallet/send)');
        console.log('⚠️ [Reason] isGasless =', isGasless, ', tokenChain =', tokenChain);
      }

      let result: { txHash: string; userOpHash?: string; explorerUrl?: string; isFirstTransaction?: boolean };

      if (isGasless) {
        // ✅ FIX: Use EIP-7702 gasless endpoint
        // Try both normalized and original chain name
        const chainId = EIP7702_CHAIN_IDS[normalizedChain] || EIP7702_CHAIN_IDS[tokenChain];
        if (!chainId) {
          throw new Error(
            `Chain ID not found for ${tokenChain} (normalized: ${normalizedChain}). ` +
            `Available chains: ${Object.keys(EIP7702_CHAIN_IDS).join(', ')}`
          );
        }

        const gaslessResult = await walletApi.sendEip7702Gasless({
          userId,
          chainId,
          recipientAddress: recipientAddress.trim(),
          amount: amount, // Human-readable amount
          tokenAddress: selectedToken.address || undefined,
          tokenDecimals: selectedToken.decimals, // Always pass decimals from Zerion (validated above)
        });

        // Use transactionHash if available, otherwise use userOpHash
        result = {
          txHash: gaslessResult.transactionHash || gaslessResult.userOpHash,
          userOpHash: gaslessResult.userOpHash,
          explorerUrl: gaslessResult.explorerUrl,
          isFirstTransaction: gaslessResult.isFirstTransaction,
        };

        // If we only have userOpHash, wait for confirmation to get txHash
        if (!gaslessResult.transactionHash && gaslessResult.userOpHash) {
          try {
            const confirmResult = await walletApi.waitEip7702Confirmation({
              chainId,
              userOpHash: gaslessResult.userOpHash,
              timeoutMs: 60000,
            });
            result.txHash = confirmResult.transactionHash;
            result.explorerUrl = confirmResult.explorerUrl;
          } catch (waitError) {
            // Even if waiting fails, show the userOpHash
            console.warn('Failed to wait for confirmation:', waitError);
          }
        }
      } else if (isSubstrate) {
        // Convert human-readable amount to smallest units for Substrate
        const amountInSmallestUnits = (parseFloat(amount) * Math.pow(10, selectedToken.decimals)).toString();

        // Use Substrate send endpoint
        const substrateResult = await walletApi.sendSubstrateTransfer({
          userId,
          chain: tokenChain, // Use token's chain
          to: recipientAddress.trim(),
          amount: amountInSmallestUnits, // Amount in smallest units
          useTestnet: false, // TODO: Add testnet toggle if needed
          transferMethod: 'transferAllowDeath', // Default transfer method
        });

        result = { txHash: substrateResult.txHash };
      } else if (isAptos) {
        // Use Aptos send endpoint
        const network = tokenChain === "aptosTestnet" ? "testnet" : "mainnet"; // Use token's chain
        const aptosResult = await walletApi.sendAptosTransaction({
          userId,
          recipientAddress: recipientAddress.trim(),
          amount: parseFloat(amount), // Amount in APT (human-readable)
          network,
        });
        result = { txHash: aptosResult.transactionHash };
      } else {
        // Use regular EVM/other chain send endpoint
        const sendResult = await walletApi.sendCrypto({
          userId,
          chain: tokenChain, // Use token's chain, not modal's chain prop
          tokenAddress: selectedToken.address || undefined,
          tokenDecimals: selectedToken.decimals,
          amount: amount, // human-readable amount; server converts using ERC-20 decimals / Zerion
          recipientAddress: recipientAddress.trim(),
        });
        result = { txHash: sendResult.txHash };
      }

      setTxHash(result.txHash);
      setSuccess(true);

      // Track successful send transaction
      trackTransaction.sendCompleted(
        result.txHash,
        amount,
        selectedToken.symbol,
        tokenChain, // Use token's chain for analytics
      );

      // Call onSuccess callback after a short delay
      setTimeout(() => {
        if (onSuccess) {
          onSuccess();
        }
        // Close modal after 3 seconds
        setTimeout(() => {
          onOpenChange(false);
        }, 3000);
      }, 1000);
    } catch (err) {
      let errorMessage = "Failed to send transaction. Please try again.";
      let errorCode: string | number | undefined;

      if (err instanceof ApiError) {
        errorMessage = err.message;
        errorCode = err.status;

        // Parse specific error codes
        if (err.status === 422) {
          // Insufficient balance
          if (err.message.includes("balance")) {
            setFieldErrors({ amount: err.message });
            errorMessage = "";
          } else {
            errorMessage = err.message;
          }
        } else if (err.status === 400) {
          // Invalid input
          if (err.message.includes("address")) {
            setFieldErrors({ address: err.message });
            errorMessage = "";
          } else if (err.message.includes("amount")) {
            setFieldErrors({ amount: err.message });
            errorMessage = "";
          } else {
            errorMessage = err.message;
          }
        } else if (err.status === 503 || err.status === 408) {
          errorMessage = "Network error. Please check your connection and try again.";
        }
      }

      // Track failed send transaction
      trackTransaction.sendFailed(
        errorMessage,
        errorCode,
      );

      if (errorMessage) {
        setError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  const chainName = CHAIN_NAMES[chain] || chain;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/10 bg-black/95 text-white shadow-2xl backdrop-blur sm:max-w-[380px] p-0 rounded-[28px] [&>button]:text-white/40 [&>button]:hover:text-white [&>button]:hover:bg-white/10 [&>button]:opacity-100 [&>button]:top-5 [&>button]:right-5">
        <DialogHeader className="px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <DialogTitle className="text-xl font-bold flex items-center gap-2.5 tracking-tight group">
              <div className="flex items-center justify-center bg-white/5 rounded-full p-1.5 translate-y-[-1px]">
                <ChainIcon className="h-6 w-6" />
              </div>
              <span className="font-rubik-medium">{CHAIN_NAMES[activeChainId] || activeChainId}</span>
            </DialogTitle>

            <Select value={activeChainId} onValueChange={setActiveChainId}>
              <SelectTrigger className="w-auto h-7 bg-white/10 hover:bg-white/20 border border-white/10 rounded-full text-[10px] font-bold text-white transition-colors gap-1 px-3 flex items-center uppercase tracking-wider focus:ring-0">
                <span>CHANGE</span>
              </SelectTrigger>
              <SelectContent className="bg-black/95 border-white/10 text-white rounded-xl min-w-[140px]">
                {chains.filter(c => !c.isTestnet).map((c) => {
                  const Icon = c.icon;
                  const isSelected = activeChainId === c.id;
                  const displayName = c.name;

                  return (
                    <SelectItem
                      key={c.id}
                      value={c.id}
                      className="text-xs focus:bg-white/10 focus:text-white cursor-pointer py-2"
                    >
                      <div className="flex items-center justify-between w-full min-w-[140px]">
                        <div className="flex items-center gap-2">
                          <Icon className="w-4 h-4" />
                          <span>{displayName}</span>
                        </div>
                        {isSelected && (
                          <div className="h-1.5 w-1.5 rounded-full bg-[#007AFF] mr-1" />
                        )}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          <DialogDescription className="text-sm text-white/40 font-rubik-normal text-left mt-0.5 ml-0.5">
            Transfer to recipient address
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 pb-6 mt-2">
          {/* Token Selection */}
          <div className="space-y-1.5">
            <Label htmlFor="token" className="text-sm font-medium text-white/80">Token</Label>
            {loadingTokens ? (
              <div className="flex items-center justify-center gap-3 text-sm text-white/40 py-4 bg-white/5 rounded-xl border border-white/5">
                <Loader2 className="h-4 w-4 animate-spin text-[#007AFF]" />
                <span>Loading tokens...</span>
              </div>
            ) : tokens.length === 0 ? (
              <div className="text-xs text-red-400 py-2">
                No tokens available for this network from Zerion assets.
              </div>
            ) : (
              <Select
                value={selectedToken ? `${selectedToken.chain || 'unknown'}:${selectedToken.address || 'native'}` : undefined}
                onValueChange={(value) => {
                  const token = tokens.find(t => `${t.chain || 'unknown'}:${t.address || 'native'}` === value);
                  setSelectedToken(token ?? null);
                }}
              >
                <SelectTrigger id="token" className="h-9 rounded-xl border-white/20 bg-white/5 text-sm text-white hover:bg-white/10">
                  {selectedToken ? (
                    <SelectedTokenDisplay token={selectedToken} />
                  ) : (
                    <SelectValue placeholder="Select token" />
                  )}
                </SelectTrigger>
                <SelectContent className="rounded-xl border-white/20 bg-black/95 text-white">
                  {tokens.map((token) => {
                    const key = `${token.chain || 'unknown'}:${token.address || 'native'}`;
                    return (
                      <TokenSelectItem
                        key={key}
                        value={key}
                        token={token}
                      />
                    );
                  })}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Amount Input */}
          <div className="space-y-1.5">
            <Label htmlFor="amount" className="text-sm font-medium text-white/80">Amount</Label>
            <Input
              id="amount"
              type="number"
              step="any"
              placeholder="0.00"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                if (fieldErrors.amount) {
                  setFieldErrors({ ...fieldErrors, amount: undefined });
                }
              }}
              disabled={loading || !selectedToken}
              className="h-11 rounded-xl border-white/10 bg-white/5 text-base text-white placeholder:text-white/20 focus:border-[#007AFF]/50 focus:ring-[#007AFF]/20 transition-all font-rubik-medium px-4"
            />
            <div className="flex items-center justify-between px-0.5 mt-1">
              {selectedToken ? (
                <p className="text-[10px] md:text-xs text-white/40">
                  Available: {formatBalance(selectedToken.balance, selectedToken.decimals)} {selectedToken.symbol}
                </p>
              ) : <div />}

              {selectedToken && (
                <button
                  type="button"
                  onClick={() => {
                    const available = formatBalance(selectedToken.balance, selectedToken.decimals);
                    setAmount(available);
                    if (fieldErrors.amount) {
                      setFieldErrors({ ...fieldErrors, amount: undefined });
                    }
                  }}
                  className="text-[10px] md:text-xs font-bold text-[#007AFF] hover:text-[#007AFF]/80 transition-all px-2 py-0.5 rounded-md hover:bg-[#007AFF]/10 active:scale-95"
                >
                  Send MAX
                </button>
              )}
            </div>
            {fieldErrors.amount && (
              <p className="text-xs text-red-400 flex items-center gap-1 mt-1">
                <AlertCircle className="h-3 w-3" />
                {fieldErrors.amount}
              </p>
            )}
          </div>

          {/* Recipient Address Input */}
          <div className="space-y-1.5">
            <Label htmlFor="recipient" className="text-sm font-medium text-white/80">Recipient</Label>
            <div className="relative group">
              <Input
                id="recipient"
                placeholder="Enter address"
                value={recipientAddress}
                onChange={(e) => {
                  setRecipientAddress(e.target.value);
                  if (fieldErrors.address) {
                    setFieldErrors({ ...fieldErrors, address: undefined });
                  }
                }}
                disabled={loading}
                className="h-11 pr-11 rounded-xl border-white/10 bg-white/5 text-base text-white placeholder:text-white/20 focus:border-[#007AFF]/50 focus:ring-[#007AFF]/20 transition-all font-rubik-normal px-4"
              />
              <button
                type="button"
                onClick={handlePasteFromClipboard}
                disabled={loading}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1.5 text-white/40 hover:text-white transition-colors bg-white/5 hover:bg-white/10 rounded-lg"
                title="Paste from clipboard"
              >
                <Clipboard className="h-4 w-4" />
              </button>
            </div>
            {fieldErrors.address && (
              <p className="text-[10px] text-red-400 flex items-center gap-1 mt-1 font-medium px-1">
                <AlertCircle className="h-3 w-3" />
                {fieldErrors.address}
              </p>
            )}
          </div>

          {/* Error Display */}
          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-2.5">
              <p className="text-xs text-red-400 flex items-center gap-1.5">
                <AlertCircle className="h-3 w-3" />
                {error}
              </p>
            </div>
          )}

          {/* Success Display */}
          {success && txHash && (
            <div className="rounded-lg bg-green-500/10 border border-green-500/30 p-2.5">
              <p className="text-xs text-green-400 flex items-center gap-1.5 mb-1.5">
                <CheckCircle2 className="h-3 w-3" />
                Transaction sent!
              </p>
              <a
                href={getExplorerUrl(txHash, selectedToken?.chain || activeChainId)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-white/70 hover:text-white hover:underline flex items-center gap-1"
              >
                View explorer <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}

          <div className="flex gap-4 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
              className="flex-1 h-12 rounded-2xl border-white/10 text-white bg-transparent hover:bg-white/5 font-bold transition-all"
            >
              {success ? "Close" : "Cancel"}
            </Button>
            {!success && (
              <Button
                onClick={handleSend}
                disabled={loading || !selectedToken || !amount || !recipientAddress}
                className="flex-1 h-12 rounded-2xl bg-[#FE6A16] hover:bg-[#FE6A16]/90 text-white font-bold transition-all shadow-lg shadow-orange-500/10"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Send"
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
