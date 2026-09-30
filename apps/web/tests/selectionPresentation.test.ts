import assert from "node:assert/strict";
import test from "node:test";
import { selectionPresentation } from "../src/selectionPresentation.ts";

const books = ["a", "b", "c"].map((id) => ({ id, available: true }));
test("bulk selection adds only the missing physical copies", () => {
  const result = selectionPresentation(books, (book) => book.id !== "b");
  assert.equal(result.selectedCount, 2);
  assert.deepEqual(result.remaining.map((book) => book.id), ["b"]);
  assert.equal(result.allSelected, false);
});
test("fully selected series has no further copies to add", () => {
  const result = selectionPresentation(books, () => true);
  assert.equal(result.allSelected, true);
  assert.deepEqual(result.remaining, []);
});
test("unavailable, own and off-shelf copies are excluded from bulk selection", () => {
  const result = selectionPresentation([
    ...books,
    { id: "reserved", available: false },
    { id: "own", available: true, mine: true },
    { id: "hidden", available: true, offShelf: true },
    books[0],
  ], () => false);
  assert.equal(result.total, 3);
  assert.deepEqual(result.remaining.map((book) => book.id), ["a", "b", "c"]);
});
test("a series without eligible copies is never presented as fully selected", () => {
  const result = selectionPresentation([{ id: "a", available: false }], () => true);
  assert.equal(result.total, 0);
  assert.equal(result.allSelected, false);
});
