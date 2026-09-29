CREATE TYPE "OptionKind" AS ENUM ('CATEGORY', 'AGE', 'CONDITION');

CREATE TABLE "CatalogOption" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "kind" "OptionKind" NOT NULL,
  "label" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "CatalogOption_kind_label_key" ON "CatalogOption"("kind", "label");
CREATE INDEX "CatalogOption_kind_active_sortOrder_idx" ON "CatalogOption"("kind", "active", "sortOrder");

INSERT INTO "CatalogOption" ("id", "kind", "label", "sortOrder") VALUES
 ('category-picture', 'CATEGORY', '绘本', 10),
 ('category-story', 'CATEGORY', '故事', 20),
 ('category-science', 'CATEGORY', '科普', 30),
 ('category-other', 'CATEGORY', '其他', 40),
 ('age-0-3', 'AGE', '0—3 岁', 5),
 ('age-3-6', 'AGE', '3—6 岁', 10),
 ('age-6-9', 'AGE', '6—9 岁', 20),
 ('age-9-12', 'AGE', '9—12 岁', 30),
 ('age-13-plus', 'AGE', '13 岁以上', 40),
 ('condition-like-new', 'CONDITION', '九成新', 10),
 ('condition-good', 'CONDITION', '八成新', 20),
 ('condition-fair', 'CONDITION', '七成新', 30),
 ('condition-well-loved', 'CONDITION', '有明显使用痕迹', 40);

INSERT INTO "CatalogOption" ("id", "kind", "label", "sortOrder")
SELECT 'legacy-cat-' || md5("category"), 'CATEGORY', "category", 100
FROM (SELECT DISTINCT "category" FROM "Book" WHERE "category" IS NOT NULL) categories
ON CONFLICT ("kind", "label") DO NOTHING;

ALTER TABLE "Book" ADD COLUMN "categoryOptionId" TEXT,
  ADD COLUMN "ageOptionId" TEXT,
  ADD COLUMN "conditionOptionId" TEXT;
UPDATE "Book" AS b SET "categoryOptionId" = o."id"
FROM "CatalogOption" AS o WHERE o."kind" = 'CATEGORY' AND o."label" = b."category";
UPDATE "Book" SET "ageOptionId" = CASE "suggestedAgeBand"::text
  WHEN 'AGE_0_3' THEN 'age-0-3' WHEN 'AGE_4_6' THEN 'age-3-6'
  WHEN 'AGE_7_9' THEN 'age-6-9' WHEN 'AGE_10_12' THEN 'age-9-12'
  WHEN 'AGE_13_PLUS' THEN 'age-13-plus' ELSE NULL END;
UPDATE "Book" SET "conditionOptionId" = CASE "condition"::text
  WHEN 'LIKE_NEW' THEN 'condition-like-new' WHEN 'GOOD' THEN 'condition-good'
  WHEN 'FAIR' THEN 'condition-fair' WHEN 'WELL_LOVED' THEN 'condition-well-loved' END;
ALTER TABLE "Book" ALTER COLUMN "conditionOptionId" SET NOT NULL;
ALTER TABLE "Book" DROP COLUMN "category", DROP COLUMN "suggestedAgeBand", DROP COLUMN "condition";
DROP INDEX IF EXISTS "Book_category_suggestedAgeBand_idx";
CREATE INDEX "Book_categoryOptionId_ageOptionId_idx" ON "Book"("categoryOptionId", "ageOptionId");
ALTER TABLE "Book" ADD CONSTRAINT "Book_categoryOptionId_fkey" FOREIGN KEY ("categoryOptionId") REFERENCES "CatalogOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Book" ADD CONSTRAINT "Book_ageOptionId_fkey" FOREIGN KEY ("ageOptionId") REFERENCES "CatalogOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Book" ADD CONSTRAINT "Book_conditionOptionId_fkey" FOREIGN KEY ("conditionOptionId") REFERENCES "CatalogOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ChildProfile" ADD COLUMN "ageOptionId" TEXT;
UPDATE "ChildProfile" SET "ageOptionId" = CASE "ageBand"::text
  WHEN 'AGE_0_3' THEN 'age-0-3' WHEN 'AGE_4_6' THEN 'age-3-6'
  WHEN 'AGE_7_9' THEN 'age-6-9' WHEN 'AGE_10_12' THEN 'age-9-12'
  WHEN 'AGE_13_PLUS' THEN 'age-13-plus' END;
ALTER TABLE "ChildProfile" ALTER COLUMN "ageOptionId" SET NOT NULL;
ALTER TABLE "ChildProfile" DROP COLUMN "ageBand";
ALTER TABLE "ChildProfile" ADD CONSTRAINT "ChildProfile_ageOptionId_fkey" FOREIGN KEY ("ageOptionId") REFERENCES "CatalogOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AdminAccount" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "username" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "AdminAccount_username_key" ON "AdminAccount"("username");
CREATE TABLE "AdminSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "adminId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminSession_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AdminSession_tokenHash_key" ON "AdminSession"("tokenHash");
CREATE INDEX "AdminSession_adminId_idx" ON "AdminSession"("adminId");
CREATE TABLE "AdminAuditEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "adminId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminAuditEvent_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
