import { Global, Module } from '@nestjs/common';
import { GatewayLifecycleService } from './gateway-lifecycle.service';

@Global()
@Module({ providers: [GatewayLifecycleService], exports: [GatewayLifecycleService] })
export class GatewayLifecycleModule {}
