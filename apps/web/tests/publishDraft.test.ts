import assert from "node:assert/strict";
import test from "node:test";
import { clearPublishDraft, emptyPublishDraft, publishDraftKey, readPublishDraft, savePublishDraft } from "../src/publishDraft.ts";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}
const draft = {
  ...emptyPublishDraft({ categories: [], ages: [], conditions: [] }),
  title: "童书", author: "作者", summary: "识别填入的简介",
  categoryOptionId: "retired-category", ageOptionId: "age-3-6", conditionOptionId: "condition-like-new",
  coverImage: "data:image/jpeg;base64,Y292ZXI=", coverBytes: 5,
  seriesId: "series-one", seriesOrder: "2", recognitionSucceeded: true,
  sources: [{ title: "资料", url: "https://example.test/book" }],
};

test("draft round trips include the cover, AI metadata and unchanged option IDs, isolated by family", () => {
  const storage = memoryStorage();
  assert.deepEqual(readPublishDraft("first", storage), { draft: null, error: false });
  assert.equal(savePublishDraft("first", draft, storage), true);
  assert.deepEqual(readPublishDraft("first", storage), { draft, error: false });
  assert.deepEqual(readPublishDraft("second", storage), { draft: null, error: false });
  savePublishDraft("second", { ...draft, title: "另一本书" }, storage);
  assert.equal(clearPublishDraft("first", storage), true);
  assert.equal(readPublishDraft("first", storage).draft, null);
  assert.equal(readPublishDraft("second", storage).draft?.title, "另一本书");
  assert.equal(JSON.parse(storage.getItem(publishDraftKey("second"))!).draft.privacyConfirmed, undefined);
});

test("corrupt, unsupported and malformed drafts fail safely without silently deleting the data", () => {
  const storage = memoryStorage();
  for (const raw of ["broken JSON", "null", JSON.stringify({ version: 2, draft }),
    JSON.stringify({ version: 1, draft: { ...draft, sources: [{}] } }),
    JSON.stringify({ version: 1, draft: { ...draft, coverImage: "blob:expired" } }),
    JSON.stringify({ version: 1, draft: { ...draft, coverBytes: -1 } })]) {
    storage.setItem(publishDraftKey("family"), raw);
    assert.deepEqual(readPublishDraft("family", storage), { draft: null, error: true });
    assert.equal(storage.getItem(publishDraftKey("family")), raw);
  }
});

test("blocked or full storage is reported for reads, writes and removal", () => {
  const unavailable = () => { throw new Error("Storage unavailable"); };
  const storage = { getItem: unavailable, setItem: unavailable, removeItem: unavailable };
  assert.deepEqual(readPublishDraft("family", storage), { draft: null, error: true });
  assert.equal(savePublishDraft("family", draft, storage), false);
  assert.equal(clearPublishDraft("family", storage), false);
});
