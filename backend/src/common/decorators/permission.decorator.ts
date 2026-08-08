import { SetMetadata } from '@nestjs/common';
import type { EnterprisePermission } from 'shared';

export const PERMISSION_KEY = 'enterprise_permission';

/** Require the requesting enterprise member to hold a specific fine-grained permission. */
export const RequirePermission = (permission: EnterprisePermission) =>
  SetMetadata(PERMISSION_KEY, permission);
