const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const userId = 'cmsfsa4u400017qquvy2oxs4m';
  const knowledgeBaseId = 'cmso3ga1p000j7q29tu716exk';
  
  // Step 1: Get enterprise membership (this is what getEnterpriseId does)
  const member = await prisma.enterpriseMember.findFirst({
    where: { userId },
    select: { enterpriseId: true },
  });
  
  console.log('Step 1 - Get enterpriseId from userId:', member?.enterpriseId);
  
  if (!member) {
    console.log('ERROR: No enterprise membership found');
    return;
  }
  
  const enterpriseId = member.enterpriseId;
  
  // Step 2: Find KB with both id AND enterpriseId (this is what getDocumentStatus does)
  const kb = await prisma.knowledgeBase.findFirst({
    where: { id: knowledgeBaseId, enterpriseId },
  });
  
  console.log('Step 2 - Find KB with id + enterpriseId:', kb ? 'FOUND' : 'NOT FOUND');
  
  if (!kb) {
    console.log('ERROR: Knowledge base check failed');
    console.log('Looking for KB where id =', knowledgeBaseId, 'AND enterpriseId =', enterpriseId);
    
    // Let's see what the actual KB looks like
    const actualKb = await prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
      select: { id: true, enterpriseId: true },
    });
    console.log('Actual KB enterpriseId:', actualKb?.enterpriseId);
  } else {
    console.log('SUCCESS: KB found');
  }
  
  await prisma.$disconnect();
}

main().catch(console.error);
