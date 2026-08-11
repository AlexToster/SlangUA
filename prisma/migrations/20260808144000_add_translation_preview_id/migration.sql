ALTER TABLE "Translation" ADD COLUMN "previewId" TEXT;

CREATE UNIQUE INDEX "Translation_previewId_key" ON "Translation"("previewId");
