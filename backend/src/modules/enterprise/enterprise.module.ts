import { Global, Module } from "@nestjs/common";
import { EnterpriseContextService } from "./enterprise-context.service";

/**
 * 企业上下文是多租户隔离的基础设施，几乎每个业务模块都要用，
 * 故声明为 @Global 避免在每个模块里重复 imports。
 */
@Global()
@Module({
  providers: [EnterpriseContextService],
  exports: [EnterpriseContextService],
})
export class EnterpriseModule {}
