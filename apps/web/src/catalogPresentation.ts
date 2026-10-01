type CatalogBook = {
  id: string;
  shopId: string;
  title: string;
  author: string;
  age: string;
  category: string;
  available: boolean;
  mine?: boolean;
  offShelf?: boolean;
  status?: string;
  series: { id: string; name: string } | null;
  seriesOrder: number | null;
};

export function isOwnBook(book: Pick<CatalogBook, "shopId" | "mine">, familyId?: string) {
  return Boolean(book.mine || (familyId && book.shopId === familyId));
}

export function canBorrow(book: {
  available: boolean; mine?: boolean; offShelf?: boolean; status?: string; shopId?: string;
}, familyId?: string) {
  return book.available && !book.offShelf && !book.mine &&
    (!book.status || book.status === "AVAILABLE") &&
    (!familyId || book.shopId !== familyId);
}

export type CatalogFilters = {
  query?: string;
  age?: string;
  category?: string;
  onlyAvailable?: boolean;
};

export function matchesCatalog(book: CatalogBook, filters: CatalogFilters, familyId?: string) {
  const term = filters.query?.trim().toLocaleLowerCase() || "";
  return (!filters.age || filters.age === "全部" || book.age === filters.age) &&
    (!filters.category || filters.category === "全部" || book.category === filters.category) &&
    (!filters.onlyAvailable || canBorrow(book, familyId)) &&
    (!term || `${book.title} ${book.author} ${book.series?.name || ""}`.toLocaleLowerCase().includes(term));
}

export type CatalogGroup<T> = {
  key: string;
  kind: "single" | "series";
  book: T;
  rows: T[];
  all: T[];
};

export function sortVolumes<T extends Pick<CatalogBook, "seriesOrder" | "title" | "id">>(books: T[]) {
  return [...books].sort((a, b) =>
    (a.seriesOrder ?? Infinity) - (b.seriesOrder ?? Infinity) ||
    a.title.localeCompare(b.title, "zh-CN") || a.id.localeCompare(b.id),
  );
}

/** Group physical copies by identity, while a specific volume search remains a single card. */
export function groupCatalog<T extends CatalogBook>(source: T[], matches: T[] = source, query = ""): CatalogGroup<T>[] {
  const series = new Map<string, T[]>();
  for (const book of new Map(source.map(book => [book.id, book])).values()) {
    if (!book.series) continue;
    const key = JSON.stringify([book.shopId, book.series.id]);
    const rows = series.get(key) || [];
    rows.push(book);
    series.set(key, rows);
  }
  const term = query.trim().toLocaleLowerCase();
  const groups = new Map<string, CatalogGroup<T>>();
  for (const book of new Map(matches.map(book => [book.id, book])).values()) {
    const grouped = book.series && (!term || book.series.name.toLocaleLowerCase().includes(term));
    const key = grouped ? JSON.stringify([book.shopId, book.series!.id]) : book.id;
    const existing = groups.get(key);
    if (existing) existing.rows.push(book);
    else groups.set(key, {
      key, kind: grouped ? "series" : "single", book,
      rows: [book], all: grouped ? sortVolumes(series.get(key) || [book]) : [book],
    });
  }
  return [...groups.values()].map(group => ({ ...group, rows: sortVolumes(group.rows) }));
}

export function shelfLabel(book: Pick<CatalogBook, "available" | "offShelf" | "status">) {
  if (book.offShelf || book.status === "OFF_SHELF") return "已下架";
  if (book.status === "DRAFT") return "草稿";
  if (book.available) return "可共享";
  if (book.status === "RESERVED") return "申请中";
  return "借出中";
}

export function seriesShelfSummary(books: Pick<CatalogBook, "available" | "offShelf" | "status">[]) {
  const counts = new Map<string, number>();
  for (const book of books) {
    const label = shelfLabel(book);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return ["可共享", "申请中", "借出中", "已下架", "草稿"]
    .filter(label => counts.has(label))
    .map(label => `${counts.get(label)}册${label === "借出中" ? "借出" : label === "已下架" ? "下架" : label}`)
    .join(" · ");
}
