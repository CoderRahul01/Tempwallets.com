import { Injectable } from '@nestjs/common';
import { TokenBalance } from '../types/account.types.js';
import { MOCK_TOKEN_BALANCES, MOCK_TRANSACTIONS } from '../utils/dummyData.js';

@Injectable()
export class DummyBalanceService {
    getBalances(address: string, chain: string): TokenBalance[] {
        return MOCK_TOKEN_BALANCES.filter(t => t.chain === chain);
    }

    getTransactions(address: string, chain: string): any[] {
        return MOCK_TRANSACTIONS.filter(t => t.relationships.chain.data.id === chain);
    }
}
