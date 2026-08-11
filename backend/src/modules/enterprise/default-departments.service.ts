import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 新企业的默认部门树。
 *
 * 存在理由：注册完进部门页看到一片空白，管理员得先想清楚"我该怎么建组织架构"
 * 才能开始用产品 —— 而这跟他来平台要解决的问题（雇硅基员工）没关系。
 * 给一套通用架构，他改名字比从零搭快得多。
 *
 * 数据模型上「组」不是独立实体：`Department.parentId` 指向父部门即为组，
 * 顶级部门 parentId 为 null（见 schema.prisma 的 DepartmentTree 自关联）。
 */

/** 一个顶级部门及其下属组；组名按 sortOrder 依数组顺序落地 */
interface DepartmentTemplate {
  name: string;
  groups: string[];
}

/**
 * 通用公司架构。覆盖大多数中小企业，管理员按需增删改名。
 * 不含行政/财务/法务 —— 这些部门通常不用硅基员工，留给管理员自己按需加。
 */
const DEFAULT_TREE: DepartmentTemplate[] = [
  { name: '技术部', groups: ['研发组', '测试组', '运维组'] },
  { name: '产品部', groups: ['设计组', '产品经理组'] },
  { name: '市场部', groups: ['品牌组', '增长组'] },
  { name: '销售部', groups: ['直销组', '渠道组'] },
  { name: '客户服务部', groups: ['技术支持组', '客户成功组'] },
];

@Injectable()
export class DefaultDepartmentsService {
  private readonly logger = new Logger(DefaultDepartmentsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 为新企业铺默认部门树（5 个顶级部门 + 11 个组）。
   *
   * 幂等：企业已有任何部门时直接返回，不追加也不覆盖 ——
   * 避免重复调用（或将来补数据脚本）把已被管理员改过的架构搞乱。
   *
   * 用嵌套 create 让 Prisma 自己发 cuid，不手工拼 ID：
   * 拼出来的 ID 既违反 schema 的 `@default(cuid())` 约定，
   * 也让"这条部门是不是默认建的"变成一个隐式契约。
   */
  async createDefaultDepartments(enterpriseId: string): Promise<void> {
    const existing = await this.prisma.department.findFirst({
      where: { enterpriseId },
      select: { id: true },
    });
    if (existing) {
      this.logger.debug(`企业 ${enterpriseId} 已有部门，跳过默认部门树`);
      return;
    }

    await this.prisma.$transaction(
      DEFAULT_TREE.map((dept, deptIndex) =>
        this.prisma.department.create({
          data: {
            enterpriseId,
            name: dept.name,
            sortOrder: deptIndex + 1,
            children: {
              create: dept.groups.map((groupName, groupIndex) => ({
                enterpriseId,
                name: groupName,
                sortOrder: groupIndex + 1,
              })),
            },
          },
        }),
      ),
    );

    const groupCount = DEFAULT_TREE.reduce((n, d) => n + d.groups.length, 0);
    this.logger.log(
      `企业 ${enterpriseId} 已创建默认部门树：${DEFAULT_TREE.length} 个部门 + ${groupCount} 个组`,
    );
  }
}
