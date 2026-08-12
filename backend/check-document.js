const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const docs = await prisma.document.findMany({
    where: {
      knowledgeBase: {
        name: { startsWith: 'Phase2测试知识库' }
      }
    },
    select: {
      id: true,
      originalName: true,
      status: true,
      lastError: true,
      processedAt: true,
      knowledgeBase: { select: { name: true } },
      chunks: { select: { id: true, content: true } }
    },
    orderBy: { createdAt: 'desc' },
    take: 1
  });

  console.log(`Found ${docs.length} documents`);
  docs.forEach(d => {
    console.log(`\nDocument: ${d.originalName}`);
    console.log(`  KB: ${d.knowledgeBase.name}`);
    console.log(`  Status: ${d.status}`);
    console.log(`  Processed: ${d.processedAt}`);
    console.log(`  Error: ${d.lastError}`);
    console.log(`  Chunks: ${d.chunks.length}`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
