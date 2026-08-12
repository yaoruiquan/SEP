const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: 'admin@sep.local' },
    select: { email: true, name: true, password: true },
  });
  
  if (!user) {
    console.log('User not found');
    return;
  }
  
  console.log('User found:', user.email);
  console.log('Password hash starts with:', user.password.substring(0, 20));
  
  const testPassword = 'Admin123456!';
  const matches = await bcrypt.compare(testPassword, user.password);
  console.log(`Password "${testPassword}" matches:`, matches);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
