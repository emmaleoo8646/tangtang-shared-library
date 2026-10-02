import assert from "node:assert/strict";
import test from "node:test";
import { catalogChoices, catalogChoiceIssue, defaultChoice, restoreCatalogFilter } from "../src/choicePresentation.ts";

const rows = [
  { id: "retired", label: "旧年龄", active: false, kind: "AGE" as const, sortOrder: 0 },
  { id: "first", label: "小童", active: true, kind: "AGE" as const, sortOrder: 10 },
  { id: "second", label: "大童", active: true, kind: "AGE" as const, sortOrder: 20 },
];

test("defaults retain an active choice, skip retired defaults and never invent a missing ID", () => {
  assert.equal(defaultChoice("second", rows), "second");
  assert.equal(defaultChoice("retired", rows), "first");
  assert.equal(defaultChoice("missing", []), "");
  assert.equal(defaultChoice("retired", [rows[0]]), "");
});

test("only the stored original choice can remain valid after being retired", () => {
  assert.equal(catalogChoiceIssue(rows, "retired", "ready", "retired"), "");
  assert.match(catalogChoiceIssue(rows, "retired", "ready", "first"), /停用/);
  assert.match(catalogChoiceIssue(rows, "missing", "ready"), /请选择/);
  assert.match(catalogChoiceIssue([], "first", "ready"), /暂无/);
  assert.match(catalogChoiceIssue(rows, "first", "loading"), /加载中/);
  assert.match(catalogChoiceIssue(rows, "first", "error"), /加载失败/);
});

test("retired original and invalid current choices remain visible but cannot be reselected", () => {
  assert.deepEqual(catalogChoices(rows, "first"), [
    { value: "first", label: "小童", disabled: false },
    { value: "second", label: "大童", disabled: false },
  ]);
  const choices = catalogChoices(rows, "first", "retired");
  assert.equal(choices[0].label, "旧年龄（已停用）");
  assert.equal(choices[0].disabled, true);
  assert.equal(catalogChoices(rows, "retired")[0].disabled, true);
});

test("expired filters reset to all, while filters for retired books remain usable", () => {
  assert.equal(restoreCatalogFilter("改名前的年龄", rows), "全部");
  assert.equal(restoreCatalogFilter("旧年龄", rows), "旧年龄");
  assert.equal(restoreCatalogFilter("小童", rows), "小童");
  assert.equal(restoreCatalogFilter("全部", []), "全部");
});
