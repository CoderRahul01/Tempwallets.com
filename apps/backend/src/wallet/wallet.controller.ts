import { Controller, Post, Get, Query, Body, Logger, HttpCode, HttpStatus, BadRequestException, Res } from '@nestjs/common';
import type { Response } from 'express';
import { WalletService } from './wallet.service.js';
import { CreateOrImportSeedDto, SendCryptoDto, WalletConnectSignDto } from './dto/wallet.dto.js';

@Controller('wallet')
export class WalletController {
  private readonly logger = new Logger(WalletController.name);

  constructor(private readonly walletService: WalletService) {}

  @Post('seed')
  async createOrImportSeed(@Body() dto: CreateOrImportSeedDto) {
    this.logger.log(`${dto.mode === 'random' ? 'Creating' : 'Importing'} seed for user ${dto.userId}`);
    
    try {
      await this.walletService.createOrImportSeed(dto.userId, dto.mode, dto.mnemonic);
      
      return {
        ok: true,
      };
    } catch (error) {
      this.logger.error(`Failed to ${dto.mode === 'random' ? 'create' : 'import'} seed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  @Get('addresses')
  async getAddresses(@Query('userId') userId: string) {
    this.logger.log(`Getting addresses for user ${userId}`);
    
    try {
      const addresses = await this.walletService.getAddresses(userId);
      
      return addresses;
    } catch (error) {
      this.logger.error(`Failed to get addresses: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  @Get('balances')
  async getBalances(@Query('userId') userId: string) {
    this.logger.log(`Getting balances for user ${userId}`);
    
    try {
      const balances = await this.walletService.getBalances(userId);
      
      return balances;
    } catch (error) {
      this.logger.error(`Failed to get balances: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  @Get('erc4337/paymaster-balances')
  async getErc4337PaymasterBalances(@Query('userId') userId: string) {
    this.logger.log(`Getting ERC-4337 paymaster balances for user ${userId}`);
    
    try {
      const balances = await this.walletService.getErc4337PaymasterBalances(userId);
      
      return balances;
    } catch (error) {
      this.logger.error(`Failed to get paymaster balances: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  @Post('send')
  @HttpCode(HttpStatus.OK)
  async sendCrypto(@Body() dto: SendCryptoDto) {
    this.logger.log(`Sending crypto for user ${dto.userId} on chain ${dto.chain}`);
    
    try {
      const result = await this.walletService.sendCrypto(
        dto.userId,
        dto.chain,
        dto.recipientAddress,
        dto.amount,
        dto.tokenAddress,
      );
      
      return result;
    } catch (error) {
      this.logger.error(`Failed to send crypto: ${error instanceof Error ? error.message : 'Unknown error'}`);
      this.logger.error(`Stack trace: ${error instanceof Error ? error.stack : 'No stack trace'}`);
      throw error;
    }
  }

  @Get('token-balances')
  async getTokenBalances(@Query('userId') userId: string, @Query('chain') chain: string) {
    this.logger.log(`Getting token balances for user ${userId} on chain ${chain}`);
    
    if (!userId) {
      throw new BadRequestException('userId is required');
    }
    if (!chain) {
      throw new BadRequestException('chain is required');
    }
    
    try {
      const balances = await this.walletService.getTokenBalances(userId, chain);
      
      return balances;
    } catch (error) {
      this.logger.error(`Failed to get token balances: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  @Get('assets-any')
  async getAssetsAny(@Query('userId') userId: string) {
    this.logger.log(`Getting any-chain assets for user ${userId}`);

    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    try {
      const assets = await this.walletService.getTokenBalancesAny(userId);
      return assets;
    } catch (error) {
      this.logger.error(`Failed to get any-chain assets: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  @Get('transactions')
  async getTransactionHistory(
    @Query('userId') userId: string,
    @Query('chain') chain: string,
    @Query('limit') limit?: string,
  ) {
    this.logger.log(`Getting transaction history for user ${userId} on chain ${chain}`);
    
    if (!userId) {
      throw new BadRequestException('userId is required');
    }
    if (!chain) {
      throw new BadRequestException('chain is required');
    }
    
    const limitNum = limit ? parseInt(limit, 10) : 50;
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      throw new BadRequestException('limit must be between 1 and 100');
    }
    
    try {
      const transactions = await this.walletService.getTransactionHistory(userId, chain, limitNum);
      
      return transactions;
    } catch (error) {
      this.logger.error(`Failed to get transaction history: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  @Get('transactions-any')
  async getTransactionHistoryAny(
    @Query('userId') userId: string,
    @Query('limit') limit?: string,
  ) {
    this.logger.log(`Getting any-chain transaction history for user ${userId}`);

    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    const limitNum = limit ? parseInt(limit, 10) : 100;
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      throw new BadRequestException('limit must be between 1 and 100');
    }

    try {
      const transactions = await this.walletService.getTransactionsAny(userId, limitNum);
      return transactions;
    } catch (error) {
      this.logger.error(`Failed to get any-chain transactions: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  @Get('addresses-stream')
  async streamAddresses(
    @Query('userId') userId: string,
    @Res() res: Response,
  ) {
    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    this.logger.log(`Streaming addresses for user ${userId}`);

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    try {
      // Stream addresses as they become available
      for await (const { chain, address } of this.walletService.streamAddresses(userId)) {
        res.write(`data: ${JSON.stringify({ chain, address })}\n\n`);
      }
      
      // Send completion message
      res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
      res.end();
    } catch (error) {
      this.logger.error(`Error streaming addresses: ${error instanceof Error ? error.message : 'Unknown error'}`);
      res.write(`event: error\ndata: ${JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' })}\n\n`);
      res.end();
    }
  }

  @Get('balances-stream')
  async streamBalances(
    @Query('userId') userId: string,
    @Res() res: Response,
  ) {
    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    this.logger.log(`Streaming balances for user ${userId}`);

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    try {
      // Stream balances as they're fetched from Zerion
      for await (const balance of this.walletService.streamBalances(userId)) {
        res.write(`data: ${JSON.stringify(balance)}\n\n`);
      }
      
      // Send completion message
      res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
      res.end();
    } catch (error) {
      this.logger.error(`Error streaming balances: ${error instanceof Error ? error.message : 'Unknown error'}`);
      res.write(`event: error\ndata: ${JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' })}\n\n`);
      res.end();
    }
  }

  @Post('walletconnect/sign')
  @HttpCode(HttpStatus.OK)
  async signWalletConnectTransaction(@Body() dto: WalletConnectSignDto) {
    this.logger.log(`Signing WalletConnect transaction for user ${dto.userId} on chain ${dto.chainId}`);
    
    try {
      const result = await this.walletService.signWalletConnectTransaction(
        dto.userId,
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
      this.logger.error(`Failed to sign WalletConnect transaction: ${error instanceof Error ? error.message : 'Unknown error'}`);
      this.logger.error(`Stack trace: ${error instanceof Error ? error.stack : 'No stack trace'}`);
      throw error;
    }
  }
}
