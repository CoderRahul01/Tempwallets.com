import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChainConfigService } from './chain.config.js';

@Module({
    imports: [ConfigModule],
    providers: [ChainConfigService],
    exports: [ChainConfigService],
})
export class ChainConfigModule { }
