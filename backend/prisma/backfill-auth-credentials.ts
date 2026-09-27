import { PrismaClient } from '@prisma/client';

export interface PasswordCredentialAuditResult {
  scanned: number;
  complete: number;
  missing: number;
}

/**
 * 在移除旧 users.password 字段后，审计每个用户是否已经拥有本地密码凭据。
 *
 * 该脚本只读数据库，不接收密码、不输出 hash，也不修改任何数据。
 * 历史回填已在删除旧字段前完成；上线前可重复执行此审计确认没有遗漏。
 */
export async function auditPasswordCredentials(
  prisma: Pick<PrismaClient, 'user'>,
): Promise<PasswordCredentialAuditResult> {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      authCredentials: {
        where: { type: 'LOCAL_PASSWORD' },
        select: { id: true },
        take: 1,
      },
    },
  });

  const result: PasswordCredentialAuditResult = {
    scanned: users.length,
    complete: 0,
    missing: 0,
  };
  for (const user of users) {
    if (user.authCredentials.length > 0) result.complete += 1;
    else result.missing += 1;
  }
  return result;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const result = await auditPasswordCredentials(prisma);
    console.log(
      `认证凭据审计完成：扫描 ${result.scanned}，已有本地密码凭据 ${result.complete}，缺失 ${result.missing}`,
    );
    if (result.missing > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) void main();
