import { Global, Module } from "@nestjs/common";
import { EnterpriseContextService } from "./enterprise-context.service";
import { DepartmentService } from "./department.service";
import { MemberService } from "./member.service";
import { InstanceService } from "./instance.service";
import { EnterpriseController } from "./enterprise.controller";

/**
 * 企业上下文是多租户隔离的基础设施，几乎每个业务模块都要用，
 * 故声明为 @Global 避免在每个模块里重复 imports。
 *
 * 注意：@Global 只对 exports 生效（EnterpriseContextService），
 * DepartmentService / MemberService / InstanceService 仅本模块内部使用。
 */
@Global()
@Module({
  controllers: [EnterpriseController],
  providers: [
    EnterpriseContextService,
    DepartmentService,
    MemberService,
    InstanceService,
  ],
  exports: [EnterpriseContextService],
})
export class EnterpriseModule {}
