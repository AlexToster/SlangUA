-- Translation.aiProvider (enum AIProvider) -> Translation.providerId (text).
--
-- Adding a provider used to mean an enum migration; it is now a config change,
-- so the column stores the configured instance id in lowercase ("openai",
-- "openrouter", "groq"). Existing rows are lowercased in place: the enum labels
-- were the uppercase spelling of exactly those ids.

-- RenameColumn
ALTER TABLE "Translation" RENAME COLUMN "aiProvider" TO "providerId";

-- AlterColumn (enum -> text, lowercased)
ALTER TABLE "Translation"
  ALTER COLUMN "providerId" TYPE TEXT USING lower("providerId"::text);

-- DropEnum
DROP TYPE "AIProvider";
