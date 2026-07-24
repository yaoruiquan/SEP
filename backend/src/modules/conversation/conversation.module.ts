import { Module } from '@nestjs/common';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';
import { ConversationStreamService } from './conversation-stream.service';
import { SessionLockService } from './session-lock.service';
import { CapabilityModule } from '../capability/capability.module';
import { SubscriptionModule } from '../subscription/subscription.module';

@Module({
  imports: [CapabilityModule, SubscriptionModule],
  controllers: [ConversationController],
  providers: [
    ConversationService,
    ConversationStreamService,
    SessionLockService,
  ],
  exports: [ConversationService],
})
export class ConversationModule {}
