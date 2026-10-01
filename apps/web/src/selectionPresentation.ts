import { canBorrow } from "./catalogPresentation.ts";

type SelectableBook = { id: string; available: boolean; mine?: boolean; offShelf?: boolean; status?: string; shopId?: string };

export function selectionPresentation<T extends SelectableBook>(
  books: T[],
  selected: (book: T) => boolean,
  familyId?: string,
) {
  const eligible = [...new Map(books
    .filter((book) => canBorrow(book, familyId))
    .map((book) => [book.id, book])).values()];
  const remaining = eligible.filter((book) => !selected(book));
  return {
    remaining,
    total: eligible.length,
    selectedCount: eligible.length - remaining.length,
    allSelected: eligible.length > 0 && remaining.length === 0,
  };
}
