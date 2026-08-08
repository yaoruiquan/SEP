import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { EnterpriseContextService } from '../../modules/enterprise/enterprise-context.service';
import { PERMISSION_KEY } from '../decorators/permission.decorator';
import type { EnterprisePermission } from 'shared';
import { DEFAULT_ROLE_PERMISSIONS } from 'shared';

/**
 * Fine-grained enterprise permission guard.
 *
 * Resolution order:
 *  1. PLATFORM_ADMIN / SUPER_ADMIN → always allowed.
 *  2. ENTERPRISE_ADMIN built-in role → full permission set.
 *  3. customRole.permissions (if member has one assigned).
 *  4. Fallback to built-in MEMBER permission set from DEFAULT_ROLE_PERMISSIONS.
 *
 * Pair with @RequirePermission('resource:action') on a controller method.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly ctx: EnterpriseContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<EnterprisePermission | undefined>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No @RequirePermission() decorator → skip check.
    if (!required) return true;

    const request = context.switchToHttp().getRequest();
    const user: { id: string; role?: string } | undefined = request.user;

    if (!user) throw new ForbiddenException('Not authenticated');

    // Platform admins bypass enterprise-level permission checks.
    if (user.role === 'PLATFORM_ADMIN' || user.role === 'SUPER_ADMIN') return true;

    // Resolve enterprise membership and optionally the custom role.
    const member = await this.prisma.enterpriseMember.findFirst({
      where: { userId: user.id },
      include: { customRole: { select: { permissions: true } } },
    });

    if (!member) throw new ForbiddenException('Not an enterprise member');

    // ENTERPRISE_ADMIN has every permission.
    if (member.role === 'ENTERPRISE_ADMIN') return true;

    // Determine effective permission set.
    let effectivePerms: string[];

    if (member.customRole) {
      effectivePerms = member.customRole.permissions;
    } else {
      // Fall back to the built-in role defaults.
      effectivePerms = DEFAULT_ROLE_PERMISSIONS[member.role] ?? DEFAULT_ROLE_PERMISSIONS['MEMBER'];
    }

    if (!effectivePerms.includes(required)) {
      throw new ForbiddenException(`Missing permission: ${required}`);
    }

    return true;
  }
}
