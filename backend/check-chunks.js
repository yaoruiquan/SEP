const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const chunks = await prisma.textChunk.findMany({
    where: {
      knowledgeBase: {
        name: { startsWith: 'Phase2测试知识库' }
      }
    },
    select: {
      id: true,
      content: true,
      tokens: true,
      embedding: true,
      knowledgeBase: { select: { name: true } }
    },
    orderBy: { createdAt: 'desc' },
    take: 3
  });

  console.log(`Found ${chunks.length} chunks`);
  chunks.forEach((c, i) => {
    console.log(`\nChunk ${i + 1}:`);
    console.log(`  KB: ${c.knowledgeBase.name}`);
    console.log(`  Content preview: ${c.content.substring(0, 80)}...`);
    console.log(`  Tokens count: ${c.tokens?.length ?? 0}`);
    console.log(`  Has embedding: ${!!c.embedding}`);
    if (c.tokens?.length > 0) {
      console.log(`  Sample tokens: ${c.tokens.slice(0, 10).join(', ')}`);
    }
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
