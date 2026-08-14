-- DropIndex
DROP INDEX "Translation_originalText_trgm_idx";

-- DropIndex
DROP INDEX "Translation_translatedText_trgm_idx";

-- DropIndex
DROP INDEX "Translation_userId_createdAt_id_idx";

-- AlterTable
ALTER TABLE "Translation" ADD COLUMN     "styleVersion" TEXT;

-- CreateIndex
CREATE INDEX "Translation_userId_createdAt_id_idx" ON "Translation"("userId", "createdAt", "id");
