-- Supports stable keyset pagination for a user's translation history.
CREATE INDEX "Translation_userId_createdAt_id_idx"
ON "Translation"("userId", "createdAt" DESC, "id" DESC);
