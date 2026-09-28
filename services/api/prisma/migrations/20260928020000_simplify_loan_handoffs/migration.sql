-- A borrower who already confirmed receipt under the previous workflow has the book.
WITH started AS (
  UPDATE "Loan"
  SET status = 'LENT',
      "lentAt" = COALESCE("lentAt", "borrowerLentConfirmedAt"),
      "dueAt" = COALESCE("dueAt", "borrowerLentConfirmedAt" + INTERVAL '14 days'),
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE status = 'HANDOFF_AGREED'
    AND "borrowerLentConfirmedAt" IS NOT NULL
    AND "handoffDetailsCiphertext" IS NOT NULL
  RETURNING "bookId"
)
UPDATE "Book"
SET status = 'ON_LOAN', "updatedAt" = CURRENT_TIMESTAMP
WHERE id IN (SELECT "bookId" FROM started);

-- An owner who already confirmed receiving the returned book can close the loan.
WITH completed AS (
  UPDATE "Loan"
  SET status = 'RETURNED',
      "returnedAt" = COALESCE("returnedAt", "ownerReturnConfirmedAt"),
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE status = 'RETURN_REQUESTED'
    AND "ownerReturnConfirmedAt" IS NOT NULL
  RETURNING "bookId"
)
UPDATE "Book"
SET status = 'AVAILABLE', "updatedAt" = CURRENT_TIMESTAMP
WHERE id IN (SELECT "bookId" FROM completed);
