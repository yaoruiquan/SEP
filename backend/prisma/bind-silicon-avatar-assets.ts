/** 发布 Web 图片和后端素材清单后运行；默认只预览，--apply 才写入绑定。 */
import { PrismaService } from '../src/prisma/prisma.service';
import { readAvatarBindings } from '../src/common/avatar-style';
import registry from '../src/common/employee-avatar-assets.json';
import { siliconAvatarUrl } from './seed/employee-avatar-map';

const prisma = new PrismaService();
const apply = process.argv.includes('--apply');

async function main() {
  const employees = await prisma.digitalEmployee.findMany({
    select: { id: true, name: true, avatarBindings: true },
  });
  const missing = employees.filter((employee) => !readAvatarBindings(employee.avatarBindings)['silicon-3d']);
  const unmatched = missing.filter((employee) => {
    const path = siliconAvatarUrl(employee.name);
    return !path || !(path in registry);
  });
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', total: employees.length, alreadyBound: employees.length - missing.length, toBind: missing.length - unmatched.length, unmatched: unmatched.map((employee) => ({ id: employee.id, name: employee.name })) }));
  if (unmatched.length) throw new Error('部分员工没有已登记的硅基素材，未写入任何绑定');
  if (!apply) return;

  const updated = await prisma.$transaction(async (tx) => {
    const current = await tx.digitalEmployee.findMany({
      select: { id: true, name: true, avatarBindings: true },
    });
    const pending = current.filter((employee) => !readAvatarBindings(employee.avatarBindings)['silicon-3d']);
    if (pending.some((employee) => {
      const path = siliconAvatarUrl(employee.name);
      return !path || !(path in registry);
    })) throw new Error('员工或素材映射在预检后发生变化，未写入任何绑定');
    for (const employee of pending) {
      const asset = registry[siliconAvatarUrl(employee.name)! as keyof typeof registry];
      await tx.digitalEmployee.update({
        where: { id: employee.id },
        data: { avatarBindings: {
          ...readAvatarBindings(employee.avatarBindings),
          'silicon-3d': { portraitUrl: asset.portraitPath, faceUrl: asset.facePath, version: asset.version },
        } },
      });
    }
    return pending.length;
  }, { isolationLevel: 'Serializable', timeout: 30000 });
  console.log(JSON.stringify({ updated }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
