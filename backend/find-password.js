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
  
  // Test common passwords from seed files
  const testPasswords = [
    'Admin123456!',
    'sep-admin-2026',
    'admin123',
    'password',
    '123456',
    'Sep@2026',
  ];
  
  for (const pwd of testPasswords) {
    const matches = await bcrypt.compare(pwd, user.password);
    if (matches) {
      console.log(`✓ Found password: "${pwd}"`);
      return;
    }
  }
  
  console.log('Password not found in test list');
  console.log('Hash:', user.password);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
