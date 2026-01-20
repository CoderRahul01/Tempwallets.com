import { Injectable } from '@nestjs/common';
import { IBalanceProvider } from '../interfaces/balance-provider.interface.js';
import { ZerionService } from '../services/zerion.service.js';

@Injectable()
export class BalanceProviderFactory {
    constructor(
        private zerionService: ZerionService,
    ) { }

    /**
     * Get the best balance provider for a given chain
     * Now exclusively uses ZerionService.
     */
    getProvider(chain: string): IBalanceProvider {
        return this.zerionService as any as IBalanceProvider;
    }

    /**
     * Get all providers that support multi-chain balance fetching
     */
    getMultiChainProviders(): IBalanceProvider[] {
        return [this.zerionService as any as IBalanceProvider];
    }
}
