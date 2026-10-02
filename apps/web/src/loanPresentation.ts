import type { Loan } from "./api.ts";

export function groupLoans(loans: Loan[]) {
  const groups: Loan[][] = [];
  const byId = new Map<string, Loan[]>();
  for (const loan of loans) {
    const group = loan.groupId ? byId.get(loan.groupId) : undefined;
    if (group) group.push(loan);
    else {
      const rows = [loan];
      groups.push(rows);
      if (loan.groupId) byId.set(loan.groupId, rows);
    }
  }
  return groups;
}

export function needsAttention(loan: Loan) {
  if (loan.stage === "REQUESTED" || loan.stage === "APPROVED") return loan.isOwner;
  if (loan.stage === "HANDOFF_AGREED") {
    return loan.isOwner
      ? !loan.groupId && loan.borrowerLoanConfirmed && !loan.ownerLoanConfirmed
      : !loan.borrowerLoanConfirmed;
  }
  if (loan.stage === "RETURN_REQUESTED") return loan.isOwner;
  return loan.stage === "LENT" && loan.isOwner && loan.renewalRequested && !loan.renewed;
}

export function prioritizeLoanGroups(groups: Loan[][]) {
  // Stable partition: keep the API's application-time ordering within each section.
  return [
    ...groups.filter(group => group.some(needsAttention)),
    ...groups.filter(group => !group.some(needsAttention)),
  ];
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
});
const dateParts = (date: Date) => Object.fromEntries(dateFormatter.formatToParts(date).map(part => [part.type, part.value]));
export function formatLoanDate(date: string) {
  const { month, day } = dateParts(new Date(date));
  return `${Number(month)} 月 ${Number(day)} 日`;
}
const calendarDay = (date: Date) => {
  const { year, month, day } = dateParts(date);
  return `${year}-${month}-${day}`;
};

export function loanNextStep(loans: Loan[], now = new Date()) {
  const owner = loans[0].isOwner;
  const presentation = loanPresentation(loans);
  const todos = [
    { stage: "REQUESTED", text: "等你同意" },
    { stage: "APPROVED", text: "请确认公共交接地点" },
    { stage: "HANDOFF_AGREED", text: owner ? "请完成交接确认" : "取书后确认收到" },
    { stage: "RETURN_REQUESTED", text: "请确认收回" },
    { stage: "LENT", text: "请处理续借申请" },
  ].map(item => ({ ...item, count: loans.filter(loan => loan.stage === item.stage && needsAttention(loan)).length }))
    .filter(item => item.count > 0);
  const reading = loans.filter(loan => loan.stage === "LENT" && !loan.borrowerReturnConfirmed);
  const dates = reading.filter(loan => loan.dueAt).map(loan => loan.dueAt!).sort();
  const nearestDueAt = dates[0] ?? null;
  const differentDates = new Set(dates.map(date => calendarDay(new Date(date)))).size > 1;
  const overdue = !!nearestDueAt && calendarDay(new Date(nearestDueAt)) < calendarDay(now);
  const dueText = nearestDueAt
    ? `${differentDates ? "最早 " : ""}${formatLoanDate(nearestDueAt)}前归还`
    : "请按时归还";
  let next = "本次借阅已结束";
  let hint = presentation.summary;
  if (todos.length) {
    next = todos[0].text;
    hint = todos[0].stage === "REQUESTED"
      ? "请填写公共交接地点后同意借阅，申请48小时内有效。"
      : todos[0].stage === "HANDOFF_AGREED" && !owner
        ? "取到书后确认收到，确认后开始14天借期。"
        : todos[0].stage === "RETURN_REQUESTED"
          ? "收到归还的书后，请在这里确认。"
          : todos[0].stage === "LENT"
            ? "同意后，所选图书的借期将延长14天。"
            : "请与对方确认公共地点交接。";
    if (todos[0].count !== loans.length) hint = `${todos[0].count} 本待处理 · ${hint}`;
  } else if (!presentation.done) {
    if (loans.some(loan => loan.stage === "REQUESTED")) {
      next = "等待书主同意";
      hint = "申请48小时内有效。";
    } else if (loans.some(loan => loan.stage === "APPROVED")) {
      next = "等待书主确认交接地点";
      hint = "地点确认后，请按约定取书。";
    } else if (loans.some(loan => loan.stage === "HANDOFF_AGREED")) {
      next = owner ? "等待借方确认收到" : "等待书主完成交接确认";
      hint = "借方确认收到后开始14天借期。";
    } else if (reading.length) {
      next = owner ? "等借方归还" : overdue ? "已逾期，请归还" : dueText;
      hint = owner
        ? nearestDueAt ? `${dueText}，收到书后可确认收回。` : "收到归还的书后可确认收回。"
        : overdue ? `原定 ${formatLoanDate(nearestDueAt!)}归还，请联系书主。`
          : reading.some(loan => loan.renewalRequested && !loan.renewed) ? "等待书主同意续借，当前归还期限仍有效。" : "阅读中 · 请按时归还";
      if (loans.some(loan => loan.stage === "RETURN_REQUESTED")) hint += " 部分已送还，等待书主确认归还。";
    } else if (loans.some(loan => loan.stage === "RETURN_REQUESTED")) {
      next = "等待书主确认归还";
      hint = "已送还，书主确认后本次借阅结束。";
    }
  }
  return {
    direction: owner ? "我借出" : "我借入",
    title: owner ? `${loans[0].borrower}向你借 ${loans.length} 本` : `向${loans[0].owner}借 ${loans.length} 本`,
    next, hint, todos, needsAttention: todos.length > 0, nearestDueAt,
  };
}
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
  const completedSteps = done && counts.RETURNED ? 4 : step;
  const summary = Object.keys(loanLabels)
    .filter((stage) => counts[stage])
    .map((stage) => `${counts[stage]}本${loanLabels[stage]}`)
    .join("，");
  const dates = loans
    .filter((l) => ["LENT", "RETURN_REQUESTED"].includes(l.stage) && l.dueAt)
    .map((l) => l.dueAt!)
    .sort();
  return { counts, done, step, completedSteps, summary, nearestDueAt: dates[0] ?? null };
}
