import type { Book, OptionLists } from "./api.ts";
import { defaultChoice } from "./choicePresentation.ts";

export type PublishDraft = {
  title: string;
  author: string;
  categoryOptionId: string;
  ageOptionId: string;
  conditionOptionId: string;
  summary: string;
  nonChildren: boolean;
  coverImage: string;
  coverBytes: number;
  seriesId: string;
  seriesOrder: string;
  recognitionSucceeded: boolean;
  sources: { title: string; url: string }[];
};

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
// Keep unsaved input available during navigation if browser storage is blocked or full.
const unsavedDrafts = new Map<string, PublishDraft>();
export const publishDraftKey = (familyId: string) => `tt-publish-draft:${familyId}`;

export function emptyPublishDraft(options: OptionLists): PublishDraft {
  return {
    title: "", author: "", summary: "", nonChildren: false,
    categoryOptionId: defaultChoice("category-picture", options.categories),
    ageOptionId: defaultChoice("age-3-6", options.ages),
    conditionOptionId: defaultChoice("condition-like-new", options.conditions),
    coverImage: "", coverBytes: 0, seriesId: "", seriesOrder: "",
    recognitionSucceeded: false, sources: [],
  };
}

export function bookPublishDraft(book: Book): PublishDraft {
  return {
    title: book.title, author: book.author, summary: book.summary, nonChildren: book.nonChildren,
    categoryOptionId: book.categoryOptionId || "category-other",
    ageOptionId: book.ageOptionId || "age-3-6", conditionOptionId: book.conditionOptionId,
    coverImage: book.coverUrl || "", coverBytes: 0,
    seriesId: book.series?.id || "", seriesOrder: book.seriesOrder?.toString() || "",
    recognitionSucceeded: false, sources: [],
  };
}

function isDraft(value: unknown): value is PublishDraft {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return ["title", "author", "categoryOptionId", "ageOptionId", "conditionOptionId", "summary", "coverImage", "seriesId", "seriesOrder"]
    .every(key => typeof row[key] === "string")
    && typeof row.nonChildren === "boolean" && typeof row.recognitionSucceeded === "boolean"
    && typeof row.coverBytes === "number" && Number.isFinite(row.coverBytes) && row.coverBytes >= 0
    && (row.coverImage === "" || /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(row.coverImage as string))
    && Array.isArray(row.sources) && row.sources.every(source => source && typeof source.title === "string"
      && typeof source.url === "string" && /^https?:\/\//.test(source.url));
}

export function readPublishDraft(familyId: string, storage?: DraftStorage): { draft: PublishDraft | null; error: boolean } {
  const unsaved = unsavedDrafts.get(familyId);
  if (unsaved) return { draft: unsaved, error: true };
  try {
    const raw = (storage ?? window.localStorage).getItem(publishDraftKey(familyId));
    if (!raw) return { draft: null, error: false };
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return { draft: null, error: true };
    const envelope = value as { version?: unknown; draft?: unknown };
    if (envelope.version !== 1 || !isDraft(envelope.draft)) return { draft: null, error: true };
    return { draft: envelope.draft, error: false };
  } catch { return { draft: null, error: true }; }
}

export function savePublishDraft(familyId: string, draft: PublishDraft, storage?: DraftStorage) {
  try {
    (storage ?? window.localStorage).setItem(publishDraftKey(familyId), JSON.stringify({ version: 1, draft }));
    unsavedDrafts.delete(familyId);
    return true;
  } catch { unsavedDrafts.set(familyId, draft); return false; }
}

export function clearPublishDraft(familyId: string, storage?: DraftStorage) {
  try {
    (storage ?? window.localStorage).removeItem(publishDraftKey(familyId));
    unsavedDrafts.delete(familyId);
    return true;
  } catch { return false; }
}
