ALTER TABLE "Family"
  ADD COLUMN "username" TEXT,
  ADD COLUMN "emailLookupHash" TEXT,
  ADD COLUMN "emailCiphertext" TEXT,
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "passwordHash" TEXT;

CREATE UNIQUE INDEX "Family_username_key" ON "Family"("username");
CREATE UNIQUE INDEX "Family_emailLookupHash_key" ON "Family"("emailLookupHash");

CREATE TYPE "EmailCodePurpose" AS ENUM ('REGISTER', 'RESET');

CREATE TABLE "EmailCode" (
  "emailHash" TEXT NOT NULL,
  "purpose" "EmailCodePurpose" NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sendCount" INTEGER NOT NULL DEFAULT 1,
  "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailCode_pkey" PRIMARY KEY ("emailHash","purpose")
);

CREATE INDEX "EmailCode_sentAt_idx" ON "EmailCode"("sentAt");

CREATE TABLE "AuthThrottle" (
  "identifierHash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "blockedUntil" TIMESTAMP(3),
  CONSTRAINT "AuthThrottle_pkey" PRIMARY KEY ("identifierHash")
);
