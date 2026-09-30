type SelectableBook = { id: string; available: boolean; mine?: boolean; offShelf?: boolean };

export function selectionPresentation<T extends SelectableBook>(
  books: T[],
  selected: (book: T) => boolean,
) {
  const eligible = [...new Map(books
    .filter((book) => book.available && !book.mine && !book.offShelf)
    .map((book) => [book.id, book])).values()];
  const remaining = eligible.filter((book) => !selected(book));
  return {
    remaining,
    total: eligible.length,
    selectedCount: eligible.length - remaining.length,
    allSelected: eligible.length > 0 && remaining.length === 0,
  };
}
