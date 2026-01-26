import { Module } from '@nestjs/common';
import { ChainMapService } from './chain-map.service.js';
import { BalanceService } from './balance.service.js';
import { ReceiveService } from './receive.service.js';
import { SendService } from './send.service.js';
import { ZerionService } from '../zerion.service.js';
import { NativeEoaFactory } from '../../factories/native-eoa.factory.js';
import { ChainConfigModule } from '../../config/chain-config.module.js';

@Module({
    imports: [ChainConfigModule],
    providers: [
        ChainMapService,
        BalanceService,
        ReceiveService,
        SendService,
        ZerionService,
        NativeEoaFactory,
    ],
    exports: [
        ChainMapService,
        BalanceService,
        ReceiveService,
        SendService,
        ZerionService,
        NativeEoaFactory,
    ],
})
export class StandardWalletModule { }
