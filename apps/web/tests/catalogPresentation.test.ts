import assert from "node:assert/strict";
import test from "node:test";
import { canBorrow, groupCatalog, matchesCatalog, seriesShelfSummary, sortVolumes } from "../src/catalogPresentation.ts";
import { selectionPresentation } from "../src/selectionPresentation.ts";

const book = (id: string, extra = {}) => ({
  id, shopId: "cloud", title: id, author: "作者", category: "绘本", age: "3–6岁",
  available: true, status: "AVAILABLE", mine: false, offShelf: false,
  series: null as { id: string; name: string } | null, seriesOrder: null as number | null, ...extra,
});
const science = { id: "science", name: "小小科学家" };

test("two singles followed by a series remain three ordered units with no duplicated volumes", () => {
  const rows = [book("a"), book("b"), book("c", { series: science }), book("d", { series: science }), book("e")];
  const groups = groupCatalog(rows);
  assert.deepEqual(groups.map(group => [group.kind, group.rows.map(row => row.id)]), [
    ["single", ["a"]], ["single", ["b"]], ["series", ["c", "d"]], ["single", ["e"]],
  ]);
});
test("namesake series across households and different series IDs never merge", () => {
  const groups = groupCatalog([
    book("a", { series: science }),
    book("b", { series: science, shopId: "tree" }),
    book("c", { series: { ...science, id: "second" } }),
  ]);
  assert.equal(groups.length, 3);
  assert.equal(new Set(groups.map(group => group.key)).size, 3);
  assert.ok(groups.every(group => group.kind === "series"));
});
test("my library retains a single-volume series and includes off-shelf or loaned volumes", () => {
  const groups = groupCatalog([
    book("a", { series: science, mine: true }),
    book("b", { series: science, available: false, offShelf: true, status: "OFF_SHELF", mine: true }),
    book("c", { series: science, available: false, status: "ON_LOAN", mine: true }),
    book("d", { series: { id: "solo", name: "单册系列" }, mine: true }),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].all.length, 3);
  assert.equal(groups[1].kind, "series");
  assert.equal(seriesShelfSummary(groups[0].all), "1册可共享 · 1册借出 · 1册下架");
});
test("only borrowable excludes own, reserved, lent, off-shelf and draft books", () => {
  const rows = [book("yes"), book("own", { mine: true }), book("fallback-own", { shopId: "me" }),
    ...["RESERVED", "ON_LOAN", "OFF_SHELF", "DRAFT"].map(status => book(status, { available: false, status }))];
  const visible = rows.filter(row => matchesCatalog(row, { onlyAvailable: true }, "me"));
  assert.deepEqual(visible.map(row => row.id), ["yes"]);
  assert.deepEqual(selectionPresentation(rows, () => false, "me").remaining, visible);
  assert.equal(canBorrow(book("inconsistent", { available: true, status: "DRAFT" })), false);
  assert.equal(canBorrow(book("guest")), true);
});
test("filter then group hides ineligible series and preserves complete counts for matching series", () => {
  const rows = [book("a", { series: science }), book("b", { series: science, available: false, status: "ON_LOAN" }),
    book("c", { series: { id: "mine", name: "本屋系列" }, mine: true }), book("d", { available: false, status: "ON_LOAN" })];
  const matches = rows.filter(row => matchesCatalog(row, { onlyAvailable: true }));
  const groups = groupCatalog(rows, matches);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].rows.length, 1);
  assert.equal(groups[0].all.length, 2);
});
test("volume search returns single matches and series search aggregates matching editions", () => {
  const rows = [book("奇妙的植物", { series: science }), book("天气的秘密", { series: science })];
  const volumeMatches = rows.filter(row => matchesCatalog(row, { query: " 植物 " }));
  assert.equal(groupCatalog(rows, volumeMatches, "植物")[0].kind, "single");
  const matches = rows.filter(row => matchesCatalog(row, { query: "小小科学家" }));
  assert.equal(groupCatalog(rows, matches, "小小科学家")[0].rows.length, 2);
});
test("volume order is deterministic, unnumbered editions follow numbered editions and copies deduplicate", () => {
  const rows = [book("z", { seriesOrder: null }), book("b", { seriesOrder: 2 }), book("a", { seriesOrder: 1 })];
  assert.deepEqual(sortVolumes(rows).map(row => row.id), ["a", "b", "z"]);
  const groups = groupCatalog([rows[0], rows[0]]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].rows.length, 1);
});
