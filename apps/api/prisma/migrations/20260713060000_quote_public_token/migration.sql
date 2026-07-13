-- Phase 6: self-serve customer quote link. Only the token's SHA-256 is stored.
ALTER TABLE "Quote" ADD COLUMN "publicTokenHash" TEXT;
CREATE UNIQUE INDEX "Quote_publicTokenHash_key" ON "Quote"("publicTokenHash");
