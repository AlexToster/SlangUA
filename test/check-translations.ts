import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const translations = await prisma.translation.findMany({ where: { userId: 1 } });
  console.log('Total translations for user 1:', translations.length);
  translations.forEach(t => console.log('  -', t.id, t.originalText, t.translatedText, t.favorite));
  await prisma.$disconnect();
}

main().catch(console.error);