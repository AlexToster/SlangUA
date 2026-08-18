-- Restore the trigram GIN indexes that 20260814063109 dropped.
--
-- They were created by 20260804171200 in raw SQL only and never declared in
-- schema.prisma, so the next generated migration removed them as drift and
-- history search silently fell back to a sequential scan. They are declared in
-- schema.prisma now, which is what stops `prisma migrate dev` from dropping them
-- again; this file only brings existing databases back in line.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Backs the ILIKE '%term%' search in history.service.ts.
CREATE INDEX IF NOT EXISTS "Translation_originalText_trgm_idx" ON "Translation" USING GIN ("originalText" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Translation_translatedText_trgm_idx" ON "Translation" USING GIN ("translatedText" gin_trgm_ops);
