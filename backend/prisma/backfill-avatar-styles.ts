/** Run after prisma migrate deploy. Preserves current images; safe to rerun. */
import { PrismaService } from '../src/prisma/prisma.service';
import { canonicalAvatarStyleId, FOLLOW_DEFAULT_STYLE_ID, SILICON_3D_STYLE } from '../src/shared/dicebear-styles';
import { inferAvatarStyle, preservedAvatarBindings } from '../src/common/avatar-style';

const prisma = new PrismaService();
async function main() {
  const result = await prisma.$transaction(async (tx) => {
    const employees = await tx.digitalEmployee.findMany();
    let updated = 0;
    for (const employee of employees) {
      const actual = inferAvatarStyle(employee.avatar);
      const avatarStyle = employee.avatarStyle
        ? canonicalAvatarStyleId(employee.avatarStyle)
        : !employee.avatar || actual === SILICON_3D_STYLE.id ? FOLLOW_DEFAULT_STYLE_ID : actual;
      const avatarCustomUrl = employee.avatarCustomUrl || (avatarStyle === 'custom' ? employee.avatar : null);
      const avatarBindings = preservedAvatarBindings({ ...employee, avatarStyle });
      if (avatarStyle === employee.avatarStyle && avatarCustomUrl === employee.avatarCustomUrl && JSON.stringify(avatarBindings) === JSON.stringify(employee.avatarBindings)) continue;
      await tx.digitalEmployee.update({ where: { id: employee.id }, data: { avatarStyle, avatarCustomUrl, avatarBindings } });
      updated++;
    }
    return { scanned: employees.length, updated };
  }, { isolationLevel: 'Serializable', timeout: 30000 });
  console.log(JSON.stringify(result));
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
