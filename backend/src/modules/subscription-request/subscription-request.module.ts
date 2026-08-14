import { Module } from '@nestjs/common';
import { SubscriptionRequestController } from './subscription-request.controller';
import { SubscriptionRequestService } from './subscription-request.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SubscriptionModule } from '../subscription/subscription.module';

@Module({
  imports: [PrismaModule, NotificationsModule, SubscriptionModule],
  controllers: [SubscriptionRequestController],
  providers: [SubscriptionRequestService],
  exports: [SubscriptionRequestService],
})
export class SubscriptionRequestModule {}