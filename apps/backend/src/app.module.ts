import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './database/prisma.module.js';
import { WalletModule } from './wallet/wallet.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UserModule } from './user/user.module.js';
import { LightningNodeModule } from './lightning-node/lightning-node.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    WalletModule,
    AuthModule,
    UserModule,
    LightningNodeModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
