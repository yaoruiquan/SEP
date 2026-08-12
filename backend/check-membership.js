const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const userId = 'cmsfsa4u400017qquvy2oxs4m';
  
  // Check enterprise membership
  const member = await prisma.enterpriseMember.findFirst({
    where: { userId },
    select: { 
      userId: true, 
      enterpriseId: true,
      enterprise: { select: { name: true } }
    },
  });
  
  console.log('Enterprise membership:', JSON.stringify(member, null, 2));
  
  // Check KB
  const kb = await prisma.knowledgeBase.findUnique({
    where: { id: 'cmso3ga1p000j7q29tu716exk' },
    select: { id: true, name: true, enterpriseId: true },
  });
  
  console.log('Knowledge base:', JSON.stringify(kb, null, 2));
  
  await prisma.$disconnect();
}

main().catch(console.error);
