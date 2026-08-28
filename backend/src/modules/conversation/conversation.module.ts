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
import { UploadModule } from '../upload/upload.module';
import { ComputeCreditModule } from '../compute-credit/compute-credit.module';
import { AttachmentContextService } from './attachment-context.service';

@Module({
  imports: [
    CapabilityModule,
    SubscriptionModule,
    ModelModule,
    SettingModule,
    KnowledgeModule,
    EnterpriseModelConfigModule,
    // 统一人民币算力账本：对话前余额闸门 + 对话后扣费
    ComputeCreditModule,
    // 附件：归属校验（UploadService）+ 取回字节（StorageService）
    UploadModule,
  ],
  controllers: [ConversationController],
  providers: [
    ConversationService,
    ConversationStreamService,
    SessionLockService,
    AttachmentContextService,
  ],
  exports: [ConversationService],
})
export class ConversationModule {}
