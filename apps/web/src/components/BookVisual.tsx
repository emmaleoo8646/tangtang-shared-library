import type { Book } from "../api";
import { SharedBookCover } from "./SharedBookCover";

export function BookVisual({ books, series = false }: { books: Book[]; series?: boolean }) {
  return <span className={`book-visual ${series ? "book-visual--series" : ""}`}>
    {books.slice(0, series ? 3 : 1).map(book => <SharedBookCover key={book.id} book={book} />)}
  </span>;
}
