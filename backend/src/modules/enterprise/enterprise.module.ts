import { Global, Module } from "@nestjs/common";
import { EnterpriseContextService } from "./enterprise-context.service";
import { EnterpriseService } from "./enterprise.service";
import { DepartmentService } from "./department.service";
import { MemberService } from "./member.service";
import { InvitationService } from "./invitation.service";
import { GrantService } from "./grant.service";
import { EnterpriseController } from "./enterprise.controller";
import { DigitalEmployeeModule } from "../digital-employee/digital-employee.module";

/**
 * 企业上下文是多租户隔离的基础设施，几乎每个业务模块都要用，
 * 故声明为 @Global 避免在每个模块里重复 imports。
 *
 * 注意：@Global 只对 exports 生效（EnterpriseContextService、InvitationService、
 * MemberService），DepartmentService / GrantService 仅本模块内部使用。
 *
 * InvitationService 需导出：受邀注册在 AuthModule 里落地（要签发 token），
 * 但邀请校验的逻辑属于本模块。反向 import 会成环，靠 @Global + exports 解决。
 *
 * MemberService 需导出：主动离职挂在 /auth 下（无企业归属的用户碰不到
 * /enterprise 的上下文守卫），但离职处置逻辑属于本模块，且必须与管理员
 * 移除共用同一份实现。
 */
@Global()
@Module({
  // GrantService 需要 PackageService 来标注哪些模板有包可下。
  // 反向不成立（DigitalEmployeeModule 不 import 本模块，
  // 它用的 EnterpriseContextService 靠 @Global 拿到），故不成环。
  imports: [DigitalEmployeeModule],
  controllers: [EnterpriseController],
  providers: [
    EnterpriseContextService,
    EnterpriseService,
    DepartmentService,
    MemberService,
    InvitationService,
    GrantService,
  ],
  exports: [EnterpriseContextService, InvitationService, MemberService],
})
export class EnterpriseModule {}
