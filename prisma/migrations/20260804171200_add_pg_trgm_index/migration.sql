-- Enable pg_trgm extension for trigram-based text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create GIN index on originalText for case-insensitive partial match search
CREATE INDEX "Translation_originalText_trgm_idx" ON "Translation" USING GIN ("originalText" gin_trgm_ops);

-- Create GIN index on translatedText for case-insensitive partial match search
CREATE INDEX "Translation_translatedText_trgm_idx" ON "Translation" USING GIN ("translatedText" gin_trgm_ops);