import type { Loan } from "./api.ts";
export const activeLoanStages = new Set([
  "REQUESTED",
  "APPROVED",
  "HANDOFF_AGREED",
  "LENT",
  "RETURN_REQUESTED",
]);
export const loanLabels: Record<string, string> = {
  REQUESTED: "待审批",
  APPROVED: "待确认地点",
  HANDOFF_AGREED: "待取书",
  LENT: "借阅中",
  RETURN_REQUESTED: "待收回",
  RETURNED: "已归还",
  REJECTED: "未同意",
  CANCELLED: "已取消",
  EXPIRED: "已超时",
};
export function loanPresentation(loans: Pick<Loan, "stage" | "dueAt">[]) {
  const counts = loans.reduce<Record<string, number>>((v, l) => {
    v[l.stage] = (v[l.stage] || 0) + 1;
    return v;
  }, {});
  const done =
    loans.length > 0 && loans.every((l) => !activeLoanStages.has(l.stage));
  const step = counts.REQUESTED
    ? 0
    : counts.APPROVED || counts.HANDOFF_AGREED
      ? 1
      : done
        ? 3
        : 2;
  const summary = Object.keys(loanLabels)
    .filter((stage) => counts[stage])
    .map((stage) => `${counts[stage]}本${loanLabels[stage]}`)
    .join("，");
  const dates = loans
    .filter((l) => ["LENT", "RETURN_REQUESTED"].includes(l.stage) && l.dueAt)
    .map((l) => l.dueAt!)
    .sort();
  return { counts, done, step, summary, nearestDueAt: dates[0] ?? null };
}
