CREATE TABLE "BookSeries" (
 "id" TEXT NOT NULL PRIMARY KEY, "ownerFamilyId" TEXT NOT NULL REFERENCES "Family"("id") ON DELETE CASCADE,
 "name" TEXT NOT NULL, "summary" TEXT NOT NULL DEFAULT '', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "BookSeries_ownerFamilyId_idx" ON "BookSeries"("ownerFamilyId");
ALTER TABLE "Book" ADD COLUMN "seriesId" TEXT REFERENCES "BookSeries"("id") ON DELETE SET NULL, ADD COLUMN "seriesOrder" INTEGER;
CREATE INDEX "Book_seriesId_seriesOrder_idx" ON "Book"("seriesId", "seriesOrder");
CREATE TABLE "LoanGroup" (
 "id" TEXT NOT NULL PRIMARY KEY, "ownerFamilyId" TEXT NOT NULL, "borrowerFamilyId" TEXT NOT NULL,
 "idempotencyKey" TEXT NOT NULL, "requestFingerprint" TEXT NOT NULL, "message" TEXT NOT NULL DEFAULT '',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "LoanGroup_borrowerFamilyId_idempotencyKey_key" ON "LoanGroup"("borrowerFamilyId", "idempotencyKey");
CREATE INDEX "LoanGroup_ownerFamilyId_createdAt_idx" ON "LoanGroup"("ownerFamilyId", "createdAt");
ALTER TABLE "Loan" ADD COLUMN "groupId" TEXT REFERENCES "LoanGroup"("id") ON DELETE RESTRICT;
CREATE INDEX "Loan_groupId_idx" ON "Loan"("groupId");
