import { test } from "node:test";
import assert from "node:assert/strict";
import { loanPresentation } from "../src/loanPresentation.ts";
const row = (stage: string, dueAt: string | null = null) => ({ stage, dueAt });
test("one returned volume does not complete the batch or hide the remaining due date", () => {
  const v = loanPresentation([
    row("RETURNED", "2026-10-01"),
    row("LENT", "2026-10-14"),
    row("REJECTED"),
  ]);
  assert.equal(v.done, false);
  assert.equal(v.step, 2);
  assert.equal(v.nearestDueAt, "2026-10-14");
  assert.equal(v.summary, "1本借阅中，1本已归还，1本未同意");
});
test("an unreceived volume keeps pickup as the next step in a mixed batch", () => {
  const v = loanPresentation([
    row("HANDOFF_AGREED"),
    row("LENT", "2026-10-14"),
  ]);
  assert.equal(v.step, 1);
  assert.equal(v.done, false);
  assert.equal(v.summary, "1本待取书，1本借阅中");
});
test("ended applies to every volume, including declined, cancelled and expired ones", () => {
  const v = loanPresentation([
    row("RETURNED"),
    row("REJECTED"),
    row("CANCELLED"),
    row("EXPIRED"),
  ]);
  assert.equal(v.done, true);
  assert.equal(v.step, 3);
  assert.equal(v.nearestDueAt, null);
});
test("requested and legacy approved records take precedence over reading progress", () => {
  assert.equal(loanPresentation([row("REQUESTED"), row("LENT")]).step, 0);
  assert.equal(loanPresentation([row("APPROVED"), row("LENT")]).step, 1);
  assert.equal(loanPresentation([]).done, false);
});
