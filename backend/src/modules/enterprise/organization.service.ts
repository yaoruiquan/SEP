import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import {
  EnterpriseContext,
  EnterpriseContextService,
} from "./enterprise-context.service";

@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contexts: EnterpriseContextService,
  ) {}

  async overview(userId: string) {
    const context = await this.contexts.resolve(userId);
    const { grants: _grants, ...overview } = await this.directory(
      context,
      new Date(),
    );
    return overview;
  }

  async organization(userId: string) {
    const context = await this.contexts.resolve(userId);
    const [directory, departments, members] = await Promise.all([
      this.directory(context, new Date()),
      this.prisma.department.findMany({
        where: { enterpriseId: context.enterpriseId },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          parentId: true,
          leaderId: true,
          sortOrder: true,
        },
      }),
      this.prisma.enterpriseMember.findMany({
        where: { enterpriseId: context.enterpriseId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          userId: true,
          departmentId: true,
          position: true,
          user: { select: { name: true, avatar: true } },
        },
      }),
    ]);

    return {
      ...directory,
      departments,
      members: members.map(({ user, ...member }) => ({
        ...member,
        name: user.name,
        avatar: user.avatar,
      })),
    };
  }

  private async directory(context: EnterpriseContext, now: Date) {
    const isAdmin = context.role === "ENTERPRISE_ADMIN";
    const ownTargets: Prisma.EmployeeGrantWhereInput[] = [
      { memberId: context.memberId },
      ...(context.departmentId ? [{ departmentId: context.departmentId }] : []),
    ];
    const [enterprise, subscriptions, grants] = await Promise.all([
      this.prisma.enterprise.findUniqueOrThrow({
        where: { id: context.enterpriseId },
        select: { id: true, name: true, logo: true },
      }),
      this.prisma.subscription.findMany({
        where: { enterpriseId: context.enterpriseId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          employeeId: true,
          name: true,
          status: true,
          endDate: true,
          employee: {
            select: {
              name: true,
              avatar: true,
              position: true,
              description: true,
              status: true,
            },
          },
        },
      }),
      this.prisma.employeeGrant.findMany({
        where: {
          subscription: {
            enterpriseId: context.enterpriseId,
            status: "ACTIVE",
            OR: [{ endDate: null }, { endDate: { gt: now } }],
          },
          AND: [
            { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
            // Validate both sides of the relation, including historical malformed grants.
            {
              OR: [
                {
                  departmentId: null,
                  member: { enterpriseId: context.enterpriseId },
                },
                {
                  memberId: null,
                  department: { enterpriseId: context.enterpriseId },
                },
              ],
            },
            ...(!isAdmin ? [{ OR: ownTargets }] : []),
          ],
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          subscriptionId: true,
          memberId: true,
          departmentId: true,
          expiresAt: true,
        },
      }),
    ]);

    const availableIds = new Set(
      grants
        .filter(
          (grant) =>
            grant.memberId === context.memberId ||
            (context.departmentId !== null &&
              grant.departmentId === context.departmentId),
        )
        .map((grant) => grant.subscriptionId),
    );
    const employees = subscriptions.map((subscription) => {
      const active =
        subscription.status === "ACTIVE" &&
        (subscription.endDate === null || subscription.endDate > now);
      return {
        employeeId: subscription.employeeId,
        subscriptionId: subscription.id,
        name: subscription.name ?? subscription.employee.name,
        avatar: subscription.employee.avatar,
        position: subscription.employee.position,
        description: subscription.employee.description,
        status: subscription.status,
        employeeStatus: subscription.employee.status,
        endDate: subscription.endDate?.toISOString() ?? null,
        active,
        currentUserCanUse: active && availableIds.has(subscription.id),
      };
    });

    return {
      enterprise,
      permissions: {
        grantVisibility: isAdmin ? ("ENTERPRISE" as const) : ("SELF" as const),
        departmentGrantInheritance: "DIRECT_DEPARTMENT_ONLY" as const,
        personalReportingSupported: false,
      },
      statistics: {
        employeeCount: new Set(employees.map((employee) => employee.employeeId))
          .size,
        subscriptionCount: subscriptions.length,
        activeEmployeeCount: new Set(
          employees
            .filter((employee) => employee.active)
            .map((employee) => employee.employeeId),
        ).size,
        currentUserAvailableEmployeeCount: new Set(
          employees
            .filter((employee) => employee.currentUserCanUse)
            .map((employee) => employee.employeeId),
        ).size,
      },
      employees,
      grants: grants.map((grant) => ({
        ...grant,
        expiresAt: grant.expiresAt?.toISOString() ?? null,
      })),
    };
  }
}
