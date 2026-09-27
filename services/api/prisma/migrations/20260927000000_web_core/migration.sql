ALTER TABLE "Loan" ADD COLUMN "borrowerLentConfirmedAt" TIMESTAMP(3),
ADD COLUMN "ownerLentConfirmedAt" TIMESTAMP(3),
ADD COLUMN "borrowerReturnConfirmedAt" TIMESTAMP(3),
ADD COLUMN "ownerReturnConfirmedAt" TIMESTAMP(3),
ADD COLUMN "renewalRequestedAt" TIMESTAMP(3),
ADD COLUMN "renewedAt" TIMESTAMP(3);

CREATE TABLE "Session" (
  "id" TEXT NOT NULL,
  "familyId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_familyId_idx" ON "Session"("familyId");
ALTER TABLE "Session" ADD CONSTRAINT "Session_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LoginCode" (
  "phoneHash" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoginCode_pkey" PRIMARY KEY ("phoneHash")
);
