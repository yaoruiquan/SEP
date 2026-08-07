import { Module } from '@nestjs/common';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';
import { ConversationStreamService } from './conversation-stream.service';
import { SessionLockService } from './session-lock.service';
import { CapabilityModule } from '../capability/capability.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { ModelModule } from '../model/model.module';
import { SettingModule } from '../setting/setting.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { EnterpriseModelConfigModule } from '../enterprise-model-config/enterprise-model-config.module';

@Module({
  imports: [
    CapabilityModule,
    SubscriptionModule,
    ModelModule,
    SettingModule,
    KnowledgeModule,
    EnterpriseModelConfigModule,
  ],
  controllers: [ConversationController],
  providers: [
    ConversationService,
    ConversationStreamService,
    SessionLockService,
  ],
  exports: [ConversationService],
})
export class ConversationModule {}
