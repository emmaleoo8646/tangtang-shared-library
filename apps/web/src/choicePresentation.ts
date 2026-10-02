import type { CatalogOption } from "./api.ts";

export type ChoicesStatus = "loading" | "ready" | "error";
export type ChoiceOption = { value: string; label: string; disabled?: boolean };

export function defaultChoice(current: string, rows: CatalogOption[]) {
  return rows.some(row => row.id === current && row.active)
    ? current : rows.find(row => row.active)?.id ?? "";
}

export function catalogChoices(rows: CatalogOption[], value: string, originalValue?: string) : ChoiceOption[] {
  return rows.filter(row => row.active || row.id === value || row.id === originalValue)
    .map(row => ({ value: row.id, label: row.label + (row.active ? "" : "（已停用）"), disabled: !row.active }));
}

export function choicesStatusMessage(status: ChoicesStatus) {
  return status === "loading" ? "选项加载中…" : status === "error" ? "选项加载失败，请刷新页面重试。" : "";
}

export function catalogChoiceIssue(rows: CatalogOption[], value: string, status: ChoicesStatus, originalValue?: string) {
  const message = choicesStatusMessage(status);
  if (message) return message;
  const current = rows.find(row => row.id === value);
  if (current && (current.active || current.id === originalValue)) return "";
  if (!rows.some(row => row.active)) return "暂无可用选项，暂时无法保存。";
  return current ? "所选选项已停用，请重新选择。" : "请选择有效选项。";
}

export function restoreCatalogFilter(value: string, rows: CatalogOption[]) {
  return value === "全部" || rows.some(row => row.label === value) ? value : "全部";
}
