import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Connecting to database...');
  
  try {
    const count = await prisma.systemSetting.count();
    console.log(`Total system_settings records: ${count}`);
    
    const settings = await prisma.systemSetting.findMany({
      where: {
        key: {
          startsWith: 'alipay',
        },
      },
      orderBy: {
        key: 'asc',
      },
    });

    console.log(`\nAlipay settings (${settings.length}):`);
    if (settings.length === 0) {
      console.log('  (no alipay settings found)');
    } else {
      settings.forEach((s) => {
        console.log(`  ${s.key} = ${s.value || '(empty)'}`);
      });
    }
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
