import { PrismaClient, SlangStyle, AIProvider } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();

  // Create some test translations for user 1
  await prisma.translation.createMany({
    data: [
      {
        userId: 1,
        originalText: 'Привіт, як справи?',
        translatedText: 'Привіт, як життя?',
        slangStyle: SlangStyle.GEN_Z,
        aiProvider: AIProvider.OLLAMA,
        favorite: false,
      },
      {
        userId: 1,
        originalText: 'Дякую за допомогу',
        translatedText: 'Дякую, ти кращий!',
        slangStyle: SlangStyle.STREET,
        aiProvider: AIProvider.OLLAMA,
        favorite: true,
      },
      {
        userId: 1,
        originalText: 'Це дуже круто',
        translatedText: 'Це просто бомба!',
        slangStyle: SlangStyle.IT_SLANG,
        aiProvider: AIProvider.OLLAMA,
        favorite: false,
      },
      {
        userId: 1,
        originalText: 'Я не знаю',
        translatedText: 'Немає уявлення',
        slangStyle: SlangStyle.GEN_Z,
        aiProvider: AIProvider.OLLAMA,
        favorite: false,
      },
      {
        userId: 1,
        originalText: 'Поговоримо пізніше',
        translatedText: 'Зв\'яжемося пізніше',
        slangStyle: SlangStyle.STREET,
        aiProvider: AIProvider.OLLAMA,
        favorite: true,
      },
    ],
  });
  console.log('Test translations created');

  const translations = await prisma.translation.findMany({ where: { userId: 1 } });
  console.log('Total translations for user 1:', translations.length);
  translations.forEach(t => console.log('  -', t.id, t.originalText, t.translatedText, t.favorite));

  await prisma.$disconnect();
}

main().catch(console.error);