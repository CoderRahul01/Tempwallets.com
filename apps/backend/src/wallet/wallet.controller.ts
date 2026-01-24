import {
  Controller,
  Post,
  Get,
  Delete,
  Query,
  Body,
  Param,
  Logger,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { WalletService } from './wallet.service.js';
import {
  CreateOrImportSeedDto,
  SendCryptoDto,
  SendStandardDto,
  WalletConnectSignDto,
} from './dto/wallet.dto.js';

import { SubstrateChainKey } from './substrate/config/substrate-chain.config.js';
import { AllChainTypes } from './types/chain.types.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { OptionalAuth } from '../auth/decorators/optional-auth.decorator.js';
import { UserId } from '../auth/decorators/user-id.decorator.js';
import { PimlicoConfigService } from './config/pimlico.config.js';
import { SendService } from './services/standard-wallet/send.service.js';
import { ReceiveService } from './services/standard-wallet/receive.service.js';
import { BalanceService } from './services/standard-wallet/balance.service.js';
import { ChainMapService } from './services/standard-wallet/chain-map.service.js';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
@OptionalAuth()
export class WalletController {
  private readonly logger = new Logger(WalletController.name);

  constructor(
    private readonly walletService: WalletService,
    private readonly pimlicoConfig: PimlicoConfigService,
    private readonly sendService: SendService,
    private readonly receiveService: ReceiveService,
    private readonly balanceService: BalanceService,
    private readonly chainMapService: ChainMapService,
  ) { }

  @Post('standard/send')
  @HttpCode(HttpStatus.OK)
  async sendStandard(
    @Body() dto: SendStandardDto,
    @UserId() userId?: string,
  ) {
    const finalUserId = userId || dto.userId;
    if (!finalUserId) {
      throw new BadRequestException('userId is required');
    }

    // Map numeric chainId to moniker
    const moniker = this.chainMapService.getChainFromId(dto.chainId);
    if (!moniker) {
      throw new BadRequestException(`Unsupported chain ID: ${dto.chainId}`);
    }

    const seedPhrase = await this.walletService.getSeedPhrase(finalUserId);
    const result = await this.sendService.send(seedPhrase, moniker, {
      to: dto.recipientAddress,
      amount: dto.amount,
      tokenAddress: dto.tokenAddress,
      decimals: dto.tokenDecimals,
    });

    return {
      hash: result.txHash,
      status: 'success',
      method: result.method
    };
  }

  @Get('standard/receive/:chain')
  async getStandardReceiveInfo(
    @Param('chain') chain: string,
    @UserId() userId?: string,
    @Query('userId') queryUserId?: string,
  ) {
    const finalUserId = userId || queryUserId;
    if (!finalUserId) {
      throw new BadRequestException('userId is required');
    }

    const addresses = await this.walletService.getAddresses(finalUserId);
    const address = addresses.ethereum; // Primary EVM address
    if (!address) throw new BadRequestException('No EVM address found');

    return this.receiveService.getReceiveInfo(address, chain);
  }

  @Get('standard/balances')
  async getStandardBalances(
    @UserId() userId?: string,
    @Query('userId') queryUserId?: string,
    @Query('chain') chain?: string,
  ) {
    const finalUserId = userId || queryUserId;
    if (!finalUserId) {
      throw new BadRequestException('userId is required');
    }

    const addresses = await this.walletService.getAddresses(finalUserId);
    const address = addresses.ethereum;
    if (!address) return [];

    return this.balanceService.getBalances(address, chain);
  }


  @Post('seed')
  async createOrImportSeed(
    @Body() dto: CreateOrImportSeedDto,
    @UserId() userId?: string,
  ) {
    const finalUserId = userId || dto.userId;
    if (!finalUserId) {
      throw new BadRequestException('userId is required');
    }

    this.logger.log(
      `${dto.mode === 'random' ? 'Creating' : 'Importing'} seed for user ${finalUserId}`,
    );

    try {
      await this.walletService.createOrImportSeed(
        finalUserId,
        dto.mode,
        dto.mnemonic,
      );

      return {
        ok: true,
      };
    } catch (error) {
      this.logger.error(
        `Failed to ${dto.mode === 'random' ? 'create' : 'import'} seed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  @Get('addresses')
  async getAddresses(
    @UserId() userId?: string,
    @Query('userId') queryUserId?: string,
  ) {
    const finalUserId = userId || queryUserId;
    if (!finalUserId) {
      throw new BadRequestException('userId is required');
    }

    this.logger.log(`Getting addresses for user ${finalUserId}`);

    try {
      const payload =
        await this.walletService.getUiWalletAddresses(finalUserId);

      return payload;
    } catch (error) {
      this.logger.error(
        `Failed to get addresses: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  /**
   * Get wallet history for authenticated users
   * GET /wallet/history
   */
  @Get('history')
  async getWalletHistory(@UserId() userId?: string) {
    if (!userId) {
      throw new BadRequestException('Authentication required');
    }

    // Only allow for authenticated users (non-temp IDs)
    if (userId.startsWith('temp-')) {
      return {
        wallets: [],
        message: 'Wallet history is only available for logged-in users',
      };
    }

    this.logger.log(`Getting wallet history for user ${userId}`);

    try {
      const wallets = await this.walletService.getWalletHistory(userId);
      return { wallets };
    } catch (error) {
      this.logger.error(
        `Failed to get wallet history: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  /**
   * Switch to a different wallet from history
   * POST /wallet/switch
   */
  @Post('switch')
  @HttpCode(HttpStatus.OK)
  async switchWallet(
    @Body() body: { walletId: string },
    @UserId() userId?: string,
  ) {
    if (!userId) {
      throw new BadRequestException('Authentication required');
    }

    if (!body.walletId) {
      throw new BadRequestException('walletId is required');
    }

    // Only allow for authenticated users (non-temp IDs)
    if (userId.startsWith('temp-')) {
      throw new BadRequestException(
        'Wallet switching is only available for logged-in users',
      );
    }

    this.logger.log(`Switching wallet for user ${userId} to ${body.walletId}`);

    try {
      const success = await this.walletService.switchWallet(
        userId,
        body.walletId,
      );

      if (!success) {
        throw new BadRequestException('Wallet not found or switch failed');
      }

      return { ok: true };
    } catch (error) {
      this.logger.error(
        `Failed to switch wallet: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  /**
   * Delete a wallet from history
   * DELETE /wallet/history/:walletId
   */
  @Delete('history/:walletId')
  @HttpCode(HttpStatus.OK)
  async deleteWalletHistory(
    @Param('walletId') walletId: string,
    @UserId() userId?: string,
  ) {
    if (!userId) {
      throw new BadRequestException('Authentication required');
    }

    if (!walletId) {
      throw new BadRequestException('walletId is required');
    }

    // Only allow for authenticated users (non-temp IDs)
    if (userId.startsWith('temp-')) {
      throw new BadRequestException(
        'Wallet history deletion is only available for logged-in users',
      );
    }

    this.logger.log(
      `Deleting wallet ${walletId} from history for user ${userId}`,
    );

    try {
      const success = await this.walletService.deleteWalletHistory(
        userId,
        walletId,
      );

      if (!success) {
        throw new BadRequestException('Wallet not found or deletion failed');
      }

      return { ok: true };
    } catch (error) {
      this.logger.error(
        `Failed to delete wallet: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  /**
   * @deprecated Use /walletconnect/accounts instead (new unified WalletConnect module)
   * This endpoint is kept for backward compatibility but will be removed in a future version
   */
  @Get('walletconnect/accounts')
  async getWalletConnectAccounts(
    @UserId() userId?: string,
    @Query('userId') queryUserId?: string,
  ) {
    const finalUserId = userId || queryUserId;
    if (!finalUserId) {
      throw new BadRequestException('userId is required');
    }

    this.logger.warn(`Deprecated endpoint /wallet/walletconnect/accounts called. Use /walletconnect/accounts instead.`);

    try {
      const namespaces =
        await this.walletService.getWalletConnectAccounts(finalUserId);
      // Return all namespaces (EIP155, Polkadot, etc.)
      return namespaces;
    } catch (error) {
      this.logger.error(
        `Failed to get WalletConnect accounts: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  @Get('balances')
  async getBalances(
    @UserId() userId?: string,
    @Query('userId') queryUserId?: string,
    @Query('refresh') refresh?: string,
  ) {
    const finalUserId = userId || queryUserId;
    if (!finalUserId) {
      throw new BadRequestException('userId is required');
    }

    const forceRefresh = refresh === 'true';
    this.logger.log(
      `Getting balances for user ${finalUserId}${forceRefresh ? ' (force refresh)' : ''}`,
    );

    try {
      const balances = await this.walletService.getBalances(
        finalUserId,
        forceRefresh,
      );

      return balances;
    } catch (error) {
      this.logger.error(
        `Failed to get balances: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  @Post('balances/refresh')
  @HttpCode(HttpStatus.OK)
  async refreshBalances(
    @Body() body: { userId: string },
    @UserId() userId?: string,
  ) {
    const finalUserId = userId || body.userId;
    if (!finalUserId) {
      throw new BadRequestException('userId is required');
    }

    this.logger.debug(`Refreshing balances for user ${finalUserId}`);

    try {
      const balances = await this.walletService.refreshBalances(finalUserId);

      return {
        success: true,
        balances,
      };
    } catch (error) {
      this.logger.error(
        `Failed to refresh balances: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }


  @Post('send')
  @HttpCode(HttpStatus.OK)
  async sendCrypto(@Body() dto: SendCryptoDto, @UserId() userId?: string) {
    const finalUserId = userId || dto.userId;
    if (!finalUserId) {
      throw new BadRequestException('userId is required');
    }

    const chain = dto.chain as AllChainTypes;

    this.logger.log(
      `Sending crypto for user ${finalUserId} on chain ${chain}`,
    );

    try {
      const result = await this.walletService.sendCrypto(
        finalUserId,
        chain,
        dto.recipientAddress,
        dto.amount,
        dto.tokenAddress,
        dto.tokenDecimals,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to send crypto: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      this.logger.error(
        `Stack trace: ${error instanceof Error ? error.stack : 'No stack trace'}`,
      );
      throw error;
    }
  }

  @Get('token-balances')
  async getTokenBalances(
    @UserId() userId?: string,
    @Query('userId') queryUserId?: string,
    @Query('chain') chain?: string,
    @Query('refresh') refresh?: string,
  ) {
    const finalUserId = userId || queryUserId;
    if (!finalUserId) {
      throw new BadRequestException('userId is required');
    }
    if (!chain) {
      throw new BadRequestException('chain is required');
    }

    const forceRefresh = refresh === 'true';
    this.logger.log(
      `Getting token balances for user ${finalUserId} on chain ${chain}${forceRefresh ? ' (force refresh)' : ''}`,
    );

    try {
      const balances = await this.walletService.getTokenBalances(
        finalUserId,
        chain,
        forceRefresh,
      );

      return balances;
    } catch (error) {
      this.logger.error(
        `Failed to get token balances: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  @Get('assets-any')
  async getAssetsAny(
    @UserId() userId?: string,
    @Query('userId') queryUserId?: string,
    @Query('refresh') refresh?: string,
  ) {
    const finalUserId = userId || queryUserId;
    if (!finalUserId) {
      throw new BadRequestException('userId is required');
    }

    const forceRefresh = refresh === 'true';
    this.logger.log(
      `Getting any-chain assets for user ${finalUserId}${forceRefresh ? ' (force refresh)' : ''}`,
    );

    try {
      const assets = await this.walletService.getTokenBalancesAny(
        finalUserId,
        forceRefresh,
      );
      return assets;
    } catch (error) {
      this.logger.error(
        `Failed to get any-chain assets: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  @Get('transactions')
  async getTransactionHistory(
    @UserId() userId?: string,
    @Query('userId') queryUserId?: string,
    @Query('chain') chain?: string,
    @Query('limit') limit?: string,
  ) {
    const finalUserId = userId || queryUserId;
    if (!finalUserId) {
      throw new BadRequestException('userId is required');
    }
    if (!chain) {
      throw new BadRequestException('chain is required');
    }

    this.logger.log(
      `Getting transaction history for user ${finalUserId} on chain ${chain}`,
    );

    const limitNum = limit ? parseInt(limit, 10) : 50;
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      throw new BadRequestException('limit must be between 1 and 100');
    }

    try {
      const transactions = await this.walletService.getTransactions(
        finalUserId,
        chain,
        limitNum,
      );

      return transactions;
    } catch (error) {
      this.logger.error(
        `Failed to get transaction history: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  @Get('transactions-any')
  async getTransactionHistoryAny(
    @UserId() userId?: string,
    @Query('userId') queryUserId?: string,
    @Query('limit') limit?: string,
  ) {
    const finalUserId = userId || queryUserId;
    if (!finalUserId) {
      throw new BadRequestException('userId is required');
    }

    this.logger.log(
      `Getting any-chain transaction history for user ${finalUserId}`,
    );

    const limitNum = limit ? parseInt(limit, 10) : 100;
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      throw new BadRequestException('limit must be between 1 and 100');
    }

    try {
      const transactions = await this.walletService.getTransactionsAny(
        finalUserId,
        limitNum,
      );
      return transactions;
    } catch (error) {
      this.logger.error(
        `Failed to get any-chain transactions: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  @Get('addresses-stream')
  async streamAddresses(
    @Res() res: Response,
    @UserId() userId?: string,
    @Query('userId') queryUserId?: string,
  ) {
    const finalUserId = userId || queryUserId;
    if (!finalUserId) {
      throw new BadRequestException('userId is required');
    }

    this.logger.debug(`Streaming addresses for user ${finalUserId}`);

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    try {
      // Stream addresses as they become available
      for await (const payload of this.walletService.streamAddresses(
        finalUserId,
      )) {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      }

      // Send completion message
      res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
      res.end();
    } catch (error) {
      this.logger.error(
        `Error streaming addresses: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      res.write(
        `event: error\ndata: ${JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' })}\n\n`,
      );
      res.end();
    }
  }

  @Get('balances-stream')
  async streamBalances(
    @Res() res: Response,
    @UserId() userId?: string,
    @Query('userId') queryUserId?: string,
  ) {
    const finalUserId = userId || queryUserId;
    if (!finalUserId) {
      throw new BadRequestException('userId is required');
    }

    this.logger.debug(`Streaming balances for user ${finalUserId}`);

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    try {
      // Stream balances as they're fetched from Zerion
      for await (const balance of this.walletService.streamBalances(
        finalUserId,
      )) {
        res.write(`data: ${JSON.stringify(balance)}\n\n`);
      }

      // Send completion message
      res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
      res.end();
    } catch (error) {
      this.logger.error(
        `Error streaming balances: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      res.write(
        `event: error\ndata: ${JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' })}\n\n`,
      );
      res.end();
    }
  }

  @Get('transactions-stream')
  async streamTransactions(
    @Res() res: Response,
    @UserId() userId?: string,
    @Query('userId') queryUserId?: string,
    @Query('poll') poll?: string,
  ) {
    const finalUserId = userId || queryUserId;
    if (!finalUserId) {
      throw new BadRequestException('userId is required');
    }

    const shouldPoll = poll === 'true';
    this.logger.debug(`Streaming transactions for user ${finalUserId} (poll: ${shouldPoll})`);

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    try {
      for await (const txs of this.walletService.streamTransactions(
        finalUserId,
        { poll: shouldPoll }
      )) {
        res.write(`data: ${JSON.stringify(txs)}\n\n`);
      }

      // If polling is enabled, this point is only reached if the stream is closed
      if (!shouldPoll) {
        // Send completion message for non-polling streams
        res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
      }
      res.end();
    } catch (error) {
      this.logger.error(
        `Error streaming transactions: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      res.write(
        `event: error\ndata: ${JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' })}\n\n`,
      );
      res.end();
    }
  }

  /**
   * @deprecated Use /walletconnect/sign instead (new unified WalletConnect module)
   * This endpoint is kept for backward compatibility but will be removed in a future version
   */
  @Post('walletconnect/sign')
  @HttpCode(HttpStatus.OK)
  async signWalletConnectTransaction(
    @Body() dto: WalletConnectSignDto,
    @UserId() userId?: string,
  ) {
    const finalUserId = userId || dto.userId;
    if (!finalUserId) {
      throw new BadRequestException('userId is required');
    }

    this.logger.warn(`Deprecated endpoint / wallet / walletconnect / sign called.Use / walletconnect / sign instead.`);

    this.logger.log(
      `Signing WalletConnect transaction for user ${finalUserId} on chain ${dto.chainId} `,
    );

    try {
      const result = await this.walletService.signWalletConnectTransaction(
        finalUserId,
        dto.chainId,
        {
          from: dto.from,
          to: dto.to,
          value: dto.value,
          data: dto.data,
          gas: dto.gas,
          gasPrice: dto.gasPrice,
          maxFeePerGas: dto.maxFeePerGas,
          maxPriorityFeePerGas: dto.maxPriorityFeePerGas,
          nonce: dto.nonce,
        },
      );

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to sign WalletConnect transaction: ${error instanceof Error ? error.message : 'Unknown error'} `,
      );
      this.logger.error(
        `Stack trace: ${error instanceof Error ? error.stack : 'No stack trace'} `,
      );
      throw error;
    }
  }
  @Get('health')
  async healthCheck() {
    return { status: 'ok' };
  }

  /**
   * Get Substrate addresses for a user
   * GET /wallet/substrate/addresses?userId=xxx&useTestnet=false
   */
  @Get('substrate/addresses')
  async getSubstrateAddresses(
    @UserId() userId?: string,
    @Query('userId') queryUserId?: string,
    @Query('useTestnet') useTestnet?: string,
  ) {
    const finalUserId = userId || queryUserId;
    if (!finalUserId) {
      throw new BadRequestException('userId is required');
    }

    const useTestnetBool = useTestnet === 'true';

    try {
      // Get Substrate addresses through WalletService
      const substrateAddresses = await this.walletService.getSubstrateAddresses(
        finalUserId,
        useTestnetBool,
      );

      return {
        userId: finalUserId,
        useTestnet: useTestnetBool,
        addresses: substrateAddresses,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get Substrate addresses: ${error instanceof Error ? error.message : 'Unknown error'} `,
      );
      throw error;
    }
  }

  /**
   * Get Substrate balances for a user
   * GET /wallet/substrate/balances?userId=xxx&useTestnet=false&refresh=false
   */
  @Get('substrate/balances')
  async getSubstrateBalances(
    @UserId() userId?: string,
    @Query('userId') queryUserId?: string,
    @Query('useTestnet') useTestnet?: string,
    @Query('refresh') refresh?: string,
  ) {
    const finalUserId = userId || queryUserId;
    if (!finalUserId) {
      throw new BadRequestException('userId is required');
    }

    const useTestnetBool = useTestnet === 'true';
    const forceRefresh = refresh === 'true';
    this.logger.log(
      `Getting Substrate balances for user ${finalUserId}(testnet: ${useTestnetBool}${forceRefresh ? ', force refresh' : ''})`,
    );

    try {
      const balances = await this.walletService.getSubstrateBalances(
        finalUserId,
        useTestnetBool,
        forceRefresh,
      );
      this.logger.log(
        `Successfully retrieved Substrate balances for user ${finalUserId}: ${Object.keys(balances).length} chains`,
      );
      return {
        userId: finalUserId,
        useTestnet: useTestnetBool,
        balances,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get Substrate balances for user ${finalUserId}: ${error instanceof Error ? error.message : 'Unknown error'} `,
      );
      throw error;
    }
  }

  /**
   * Get Substrate transaction history
   * GET /wallet/substrate/transactions?userId=xxx&chain=polkadot&useTestnet=false&limit=10&cursor=xxx
   */
  @Get('substrate/transactions')
  async getSubstrateTransactions(
    @UserId() userId?: string,
    @Query('userId') queryUserId?: string,
    @Query('chain') chain?: string,
    @Query('useTestnet') useTestnet?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const finalUserId = userId || queryUserId;
    if (!finalUserId) {
      throw new BadRequestException('userId is required');
    }
    if (!chain) {
      throw new BadRequestException('chain is required');
    }

    const useTestnetBool = useTestnet === 'true';
    const limitNum = limit ? parseInt(limit, 10) : 10;

    try {
      const history = await this.walletService.getSubstrateTransactions(
        finalUserId,
        chain as SubstrateChainKey,
        useTestnetBool,
        limitNum,
        cursor,
      );

      return {
        userId: finalUserId,
        chain,
        useTestnet: useTestnetBool,
        history,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get Substrate transactions: ${error instanceof Error ? error.message : 'Unknown error'} `,
      );
      throw error;
    }
  }

  /**
   * Send Substrate transfer
   * POST /wallet/substrate/send
   */
  @Post('substrate/send')
  @HttpCode(HttpStatus.OK)
  async sendSubstrateTransfer(
    @Body()
    body: {
      userId: string;
      chain: SubstrateChainKey;
      to: string;
      amount: string;
      useTestnet?: boolean;
      transferMethod?: 'transferAllowDeath' | 'transferKeepAlive';
    },
    @UserId() userId?: string,
  ) {
    const finalUserId = userId || body.userId;
    if (!finalUserId || !body.chain || !body.to || !body.amount) {
      throw new BadRequestException(
        'userId, chain, to, and amount are required',
      );
    }

    try {
      const result = await this.walletService.sendSubstrateTransfer(
        finalUserId,
        body.chain,
        body.to,
        body.amount,
        body.useTestnet || false,
        body.transferMethod,
        0, // accountIndex
      );

      return {
        success: result.status !== 'failed' && result.status !== 'error',
        txHash: result.txHash,
        status: result.status,
        blockHash: result.blockHash,
        error: result.error,
      };
    } catch (error) {
      this.logger.error(
        `Failed to send Substrate transfer: ${error instanceof Error ? error.message : 'Unknown error'} `,
      );
      throw error;
    }
  }

  /**
   * Health check for Substrate functionality
   * GET /wallet/substrate/health
   */
  @Get('substrate/health')
  async getSubstrateHealth() {
    try {
      // Access through a public method or create a health check method in WalletService
      // For now, return basic health status
      return {
        status: 'ok',
        message: 'Substrate functionality is available',
      };
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
