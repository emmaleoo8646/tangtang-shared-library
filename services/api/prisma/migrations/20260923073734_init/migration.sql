-- CreateEnum
CREATE TYPE "FamilyStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AgeBand" AS ENUM ('AGE_0_3', 'AGE_4_6', 'AGE_7_9', 'AGE_10_12', 'AGE_13_PLUS');

-- CreateEnum
CREATE TYPE "BookCondition" AS ENUM ('LIKE_NEW', 'GOOD', 'FAIR', 'WELL_LOVED');

-- CreateEnum
CREATE TYPE "BookStatus" AS ENUM ('DRAFT', 'AVAILABLE', 'RESERVED', 'ON_LOAN', 'OFF_SHELF');

-- CreateEnum
CREATE TYPE "AiReviewStatus" AS ENUM ('NOT_REQUESTED', 'NEEDS_CONFIRMATION', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('REQUESTED', 'APPROVED', 'HANDOFF_AGREED', 'LENT', 'RETURN_REQUESTED', 'RETURNED', 'CANCELLED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Family" (
    "id" TEXT NOT NULL,
    "phoneLookupHash" TEXT,
    "phoneCiphertext" TEXT,
    "displayName" TEXT NOT NULL,
    "status" "FamilyStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Family_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChildProfile" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "ageBand" "AgeBand" NOT NULL,
    "readingPreferences" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChildProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Book" (
    "id" TEXT NOT NULL,
    "ownerFamilyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "summary" TEXT,
    "category" TEXT,
    "suggestedAgeBand" "AgeBand",
    "condition" "BookCondition" NOT NULL,
    "status" "BookStatus" NOT NULL DEFAULT 'DRAFT',
    "aiReviewStatus" "AiReviewStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
    "coverObjectKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Book_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "ownerFamilyId" TEXT NOT NULL,
    "borrowerFamilyId" TEXT NOT NULL,
    "status" "LoanStatus" NOT NULL DEFAULT 'REQUESTED',
    "handoffDetailsCiphertext" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "lentAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Family_phoneLookupHash_key" ON "Family"("phoneLookupHash");

-- CreateIndex
CREATE INDEX "ChildProfile_familyId_idx" ON "ChildProfile"("familyId");

-- CreateIndex
CREATE INDEX "Book_ownerFamilyId_status_idx" ON "Book"("ownerFamilyId", "status");

-- CreateIndex
CREATE INDEX "Book_title_idx" ON "Book"("title");

-- CreateIndex
CREATE INDEX "Book_category_suggestedAgeBand_idx" ON "Book"("category", "suggestedAgeBand");

-- CreateIndex
CREATE INDEX "Loan_bookId_status_idx" ON "Loan"("bookId", "status");

-- CreateIndex
CREATE INDEX "Loan_ownerFamilyId_status_idx" ON "Loan"("ownerFamilyId", "status");

-- CreateIndex
CREATE INDEX "Loan_borrowerFamilyId_status_idx" ON "Loan"("borrowerFamilyId", "status");

-- AddForeignKey
ALTER TABLE "ChildProfile" ADD CONSTRAINT "ChildProfile_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Book" ADD CONSTRAINT "Book_ownerFamilyId_fkey" FOREIGN KEY ("ownerFamilyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_ownerFamilyId_fkey" FOREIGN KEY ("ownerFamilyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_borrowerFamilyId_fkey" FOREIGN KEY ("borrowerFamilyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
