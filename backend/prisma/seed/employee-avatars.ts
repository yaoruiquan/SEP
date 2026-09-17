/**
 * 把历史员工的 ui-avatars.com 外链头像回填成本地素材路径。
 *
 * 背景：03-import-50-employees 当年写入的是 ui-avatars.com 随机头像，
 * 无法体现岗位，也依赖第三方服务。这里按姓名映射到
 * web/public/assets/employees/silicon/<slug>.webp，幂等执行。
 *
 * 只改“外链头像或空头像”的员工；管理员手工换过的本地头像不覆盖。
 */
import type { PrismaClient } from '@prisma/client';
import { SILICON_AVATAR_SLUG_BY_NAME, SILICON_AVATAR_DIR } from './employee-avatar-map';

export async function backfillEmployeeAvatars(prisma: PrismaClient) {
  const names = Object.keys(SILICON_AVATAR_SLUG_BY_NAME);
  const employees = await prisma.digitalEmployee.findMany({
    where: { name: { in: names } },
    select: { id: true, name: true, avatar: true, avatarStyle: true },
  });

  let updated = 0;
  for (const employee of employees) {
    // Explicit style choices and their persisted bindings belong to the avatar manager.
    if (employee.avatarStyle) continue;
    const slug = SILICON_AVATAR_SLUG_BY_NAME[employee.name];
    if (!slug) continue;
    const target = `${SILICON_AVATAR_DIR}/${slug}.webp`;
    if (employee.avatar === target) continue;
    const isPlaceholder = !employee.avatar || employee.avatar.includes('ui-avatars.com') || employee.avatar.includes('dicebear.com');
    if (!isPlaceholder) continue;
    await prisma.digitalEmployee.update({ where: { id: employee.id }, data: { avatar: target } });
    updated += 1;
  }

  return { scanned: employees.length, updated };
}
