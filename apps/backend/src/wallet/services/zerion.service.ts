import { Injectable, Logger } from '@nestjs/common';
import { TokenBalance } from '../types/account.types.js';

@Injectable()
export class ZerionService {
  private readonly logger = new Logger(ZerionService.name);

  constructor() { }

  async getBalances(address: string, chain: string): Promise<TokenBalance[]> {
    this.logger.debug(`[Mock] Getting balances from Zerion (deprecated) for ${address} on ${chain}`);
    return [];
  }
}
