import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../database/prisma.module.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { LightningNodeController } from './lightning-node.controller.js';
import { LightningNodeService } from './lightning-node.service.js';

@Module({
  imports: [ConfigModule, PrismaModule, WalletModule],
  controllers: [LightningNodeController],
  providers: [LightningNodeService],
  exports: [LightningNodeService],
})
export class LightningNodeModule {}
