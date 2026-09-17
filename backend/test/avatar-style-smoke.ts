/** Local DB integration check. Every simulated change is rolled back. */
import assert from 'node:assert/strict';
import { PrismaService } from '../src/prisma/prisma.service';
import { AdminService } from '../src/modules/admin/admin.service';
import { WalletService } from '../src/modules/wallet/wallet.service';

const prisma = new PrismaService();
const rollback = new Error('avatar smoke rollback');
async function main() {
  const before = await prisma.digitalEmployee.findMany({ orderBy: { id: 'asc' } });
  assert(before.length >= 2, 'Need at least two local employees');
  let verified = false;
  try {
    await prisma.$transaction(async (tx) => {
      const service = new AdminService(new Proxy(tx, {
        get(target, prop) { return prop === '$transaction' ? (work: (db: typeof tx) => unknown) => work(tx) : Reflect.get(target, prop); },
      }) as unknown as PrismaService, {} as WalletService);
      const initial = await service.getAvatarStyles();
      assert(initial.styles.find((style) => style.id === 'silicon-3d')?.canSetDefault);
      await service.updateEmployeeAvatarStyle(before[0].id, 'silicon-3d', 'local-smoke');
      await service.updateEmployee(before[1].id, { avatar: 'https://example.com/smoke-custom.webp' }, 'local-smoke');
      const switched = await service.batchUpdateAvatarStyle('cartoon:adventurer', 'local-smoke');
      assert.equal(switched.updated, before.length - 2);
      assert.equal((await tx.digitalEmployee.findUniqueOrThrow({ where: { id: before[0].id } })).avatar, before[0].avatar);
      assert.equal((await tx.digitalEmployee.findUniqueOrThrow({ where: { id: before[1].id } })).avatar, 'https://example.com/smoke-custom.webp');
      await service.batchUpdateAvatarStyle('silicon-3d', 'local-smoke');
      const restored = await tx.digitalEmployee.findMany({ orderBy: { id: 'asc' } });
      for (let index = 2; index < before.length; index++) assert.equal(restored[index].avatar, before[index].avatar);
      await service.registerAvatarStyle({ id: 'smoke-style', name: 'Smoke', description: 'Transient', category: 'test' });
      await service.bindEmployeeAvatar(before[0].id, 'smoke-style', { portraitUrl: '/assets/test/person.webp', faceUrl: '/assets/test/face.webp', version: '2' });
      const single = await service.updateEmployeeAvatarStyle(before[0].id, 'smoke-style', 'local-smoke');
      assert(single.avatarAsset?.faceUrl.endsWith('/assets/test/face.webp?v=2'));
      await assert.rejects(service.batchUpdateAvatarStyle('smoke-style', 'local-smoke'), /覆盖不完整/);
      verified = true;
      throw rollback;
    }, { isolationLevel: 'Serializable', timeout: 30000 });
  } catch (error) { if (error !== rollback) throw error; }
  assert(verified);
  assert.deepEqual(await prisma.digitalEmployee.findMany({ orderBy: { id: 'asc' } }), before);
  console.log(JSON.stringify({ verified: true, employees: before.length, restoredAfterRollback: true }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
