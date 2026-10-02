import { test } from "node:test";
import assert from "node:assert/strict";
import { groupLoans, loanNextStep, loanPresentation, needsAttention, prioritizeLoanGroups } from "../src/loanPresentation.ts";
import type { Loan } from "../src/api.ts";
const row = (stage: string, dueAt: string | null = null) => ({ stage, dueAt });
test("one returned volume does not complete the batch or hide the remaining due date", () => {
  const v = loanPresentation([
    row("RETURNED", "2026-10-01"),
    row("LENT", "2026-10-14"),
    row("REJECTED"),
  ]);
  assert.equal(v.done, false);
  assert.equal(v.step, 2);
  assert.equal(v.completedSteps, 2);
  assert.equal(v.nearestDueAt, "2026-10-14");
  assert.equal(v.summary, "1本借阅中，1本已归还，1本未同意");
});
test("an unreceived volume keeps pickup as the next step in a mixed batch", () => {
  const v = loanPresentation([
    row("HANDOFF_AGREED"),
    row("LENT", "2026-10-14"),
  ]);
  assert.equal(v.step, 1);
  assert.equal(v.completedSteps, 1);
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
  assert.equal(v.completedSteps, 4);
  assert.equal(v.nearestDueAt, null);
});
test("requested and legacy approved records take precedence over reading progress", () => {
  assert.equal(loanPresentation([row("REQUESTED"), row("LENT")]).step, 0);
  assert.equal(loanPresentation([row("APPROVED"), row("LENT")]).step, 1);
  assert.equal(loanPresentation([]).done, false);
});
test("a fully returned loan completes all four progress icons", () => {
  for (const loans of [[row("RETURNED")], [row("RETURNED"), row("RETURNED")]]) {
    const v = loanPresentation(loans);
    assert.equal(v.done, true);
    assert.equal(v.completedSteps, 4);
  }
});
test("an ended request without returns does not complete the return progress icon", () => {
  const v = loanPresentation([row("REJECTED"), row("CANCELLED"), row("EXPIRED")]);
  assert.equal(v.done, true);
  assert.equal(v.completedSteps, 3);
});

const now = new Date("2026-10-02T02:00:00Z");
function loan(stage: string, extra: Partial<Loan> = {}): Loan {
  return {
    id: "loan", groupId: "group", message: "", bookId: "book", bookTitle: "童书",
    owner: "糖糖书屋", borrower: "月亮书屋", isOwner: false, stage,
    place: "", contactPhone: null, dueAt: null, borrowerLoanConfirmed: false,
    ownerLoanConfirmed: false, borrowerReturnConfirmed: false, ownerReturnConfirmed: false,
    renewalRequested: false, renewed: false, requestedAt: "2026-10-01T00:00:00Z",
    approvedAt: null, lentAt: null, returnedAt: null, ...extra,
  };
}

test("next steps distinguish the viewer's action from waiting for the other household", () => {
  const cases: [string, boolean, string, boolean][] = [
    ["REQUESTED", true, "等你同意", true],
    ["REQUESTED", false, "等待书主同意", false],
    ["APPROVED", true, "请确认公共交接地点", true],
    ["APPROVED", false, "等待书主确认交接地点", false],
    ["HANDOFF_AGREED", true, "等待借方确认收到", false],
    ["HANDOFF_AGREED", false, "取书后确认收到", true],
    ["RETURN_REQUESTED", true, "请确认收回", true],
    ["RETURN_REQUESTED", false, "等待书主确认归还", false],
    ["LENT", true, "等借方归还", false],
    ["LENT", false, "请按时归还", false],
  ];
  for (const [stage, isOwner, next, attention] of cases) {
    const row = loan(stage, { isOwner });
    const result = loanNextStep([row], now);
    assert.equal(result.next, next);
    assert.equal(result.direction, isOwner ? "我借出" : "我借入");
    assert.equal(result.needsAttention, attention);
    assert.equal(needsAttention(row), attention);
  }
});

test("legacy handoff and renewal are actionable only for the responsible viewer", () => {
  const legacy = loan("HANDOFF_AGREED", { groupId: null, borrowerLoanConfirmed: true });
  assert.equal(loanNextStep([legacy], now).next, "等待书主完成交接确认");
  assert.equal(loanNextStep([{ ...legacy, isOwner: true }], now).next, "请完成交接确认");
  assert.equal(needsAttention({ ...legacy, isOwner: true, ownerLoanConfirmed: true }), false);
  assert.equal(needsAttention({ ...legacy, isOwner: true, groupId: "modern" }), false);
  const renewal = loan("LENT", { isOwner: true, renewalRequested: true });
  assert.equal(loanNextStep([renewal], now).next, "请处理续借申请");
  assert.equal(needsAttention({ ...renewal, renewed: true }), false);
  const borrower = loanNextStep([{ ...renewal, isOwner: false, dueAt: "2026-10-16" }], now);
  assert.equal(borrower.next, "10 月 16 日前归还");
  assert.match(borrower.hint, /等待书主同意续借/);
});

test("mixed batches prioritize my action over earlier waiting stages and retain every volume", () => {
  const received = loanNextStep([loan("REQUESTED"), loan("HANDOFF_AGREED"), loan("RETURNED")], now);
  assert.equal(received.next, "取书后确认收到");
  assert.equal(received.title, "向糖糖书屋借 3 本");
  assert.match(received.hint, /1 本待处理/);
  const owner = loanNextStep([
    loan("REQUESTED", { isOwner: true }), loan("RETURN_REQUESTED", { isOwner: true }),
    loan("LENT", { isOwner: true, renewalRequested: true }), loan("RETURNED", { isOwner: true }),
  ], now);
  assert.equal(owner.title, "月亮书屋向你借 4 本");
  assert.deepEqual(owner.todos.map(todo => todo.text), ["等你同意", "请确认收回", "请处理续借申请"]);
});

test("deadline excludes returned books, uses the earliest reading date and handles Shanghai calendar days", () => {
  const rows = [loan("RETURNED", { dueAt: "2026-09-01" }),
    loan("RETURN_REQUESTED", { dueAt: "2026-09-02" }),
    loan("LENT", { dueAt: "2026-10-16" }), loan("LENT", { dueAt: "2026-10-18" })];
  const result = loanNextStep(rows, now);
  assert.equal(result.next, "最早 10 月 16 日前归还");
  assert.equal(result.nearestDueAt, "2026-10-16");
  assert.match(result.hint, /部分已送还/);
  const midnight = loan("LENT", { dueAt: "2026-10-01T16:30:00Z" });
  assert.equal(loanNextStep([midnight], now).next, "10 月 2 日前归还");
  assert.equal(loanNextStep([midnight], new Date("2026-10-02T16:00:00Z")).next, "已逾期，请归还");
  assert.equal(loanNextStep([loan("RETURN_REQUESTED", { dueAt: "2026-09-01" })], now).nearestDueAt, null);
});

test("ended batches show an ended next step without inventing an action or deadline", () => {
  for (const stage of ["RETURNED", "REJECTED", "CANCELLED", "EXPIRED"]) {
    const result = loanNextStep([loan(stage, { dueAt: "2026-09-01" })], now);
    assert.equal(result.next, "本次借阅已结束");
    assert.equal(result.needsAttention, false);
    assert.equal(result.nearestDueAt, null);
  }
});

test("stable group prioritization counts a batch once, keeps mixed states and separates legacy records", () => {
  const rows = [loan("LENT", { id: "reading", groupId: "reading" }),
    loan("RETURNED", { id: "done", groupId: "mixed" }),
    loan("REQUESTED", { id: "todo-1", groupId: "mixed", isOwner: true }),
    loan("REQUESTED", { id: "todo-2", groupId: "mixed", isOwner: true }),
    loan("REQUESTED", { id: "waiting", groupId: null }),
    loan("REQUESTED", { id: "legacy-todo", groupId: null, isOwner: true })];
  const groups = groupLoans(rows);
  const ordered = prioritizeLoanGroups(groups);
  assert.deepEqual(ordered.map(group => group[0].id), ["done", "legacy-todo", "reading", "waiting"]);
  assert.equal(ordered[0].length, 3);
  assert.equal(ordered.filter(group => group.some(needsAttention)).length, 2);
  assert.deepEqual(groups.map(group => group[0].id), ["reading", "done", "waiting", "legacy-todo"]);
});
