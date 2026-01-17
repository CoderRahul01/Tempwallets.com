import { Injectable } from '@nestjs/common';
import { IBalanceProvider } from '../interfaces/balance-provider.interface.js';
import { RpcBalanceService } from '../services/rpc-balance.service.js';
import { ZerionService } from '../services/zerion.service.js';
import { PolkadotEvmRpcService } from '../services/polkadot-evm-rpc.service.js';

@Injectable()
export class BalanceProviderFactory {
    constructor(
        private rpcBalanceService: RpcBalanceService,
        private zerionService: ZerionService,
        private polkadotEvmRpcService: PolkadotEvmRpcService,
    ) { }

    /**
     * Get the best balance provider for a given chain
     */
    getProvider(chain: string): IBalanceProvider {
        // 1. Check if it's a Polkadot EVM chain
        const polkadotEvmChains = [
            'moonbeamTestnet',
            'astarShibuya',
            'paseoPassetHub',
        ];
        if (polkadotEvmChains.includes(chain)) {
            return this.polkadotEvmRpcService as any as IBalanceProvider;
        }

        // 2. Check if RPC provider supports it (EVM chains)
        if (this.rpcBalanceService.isChainSupported(chain)) {
            return this.rpcBalanceService;
        }

        // 3. Fallback to Zerion if supported
        if (this.zerionService.isChainSupported(chain)) {
            return this.zerionService;
        }

        // Default to RPC as it's our primary source now
        return this.rpcBalanceService;
    }

    /**
     * Get all providers that support multi-chain balance fetching
     */
    getMultiChainProviders(): IBalanceProvider[] {
        return [this.zerionService, this.rpcBalanceService];
    }
}
