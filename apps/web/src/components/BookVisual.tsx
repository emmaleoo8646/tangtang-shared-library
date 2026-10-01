import type { Book } from "../api";
import { SharedBookCover } from "./SharedBookCover";

export function BookVisual({ books, series = false }: { books: Book[]; series?: boolean }) {
  const covers = books.slice(0, series ? 3 : 1);
  return <span className={`book-visual ${series ? `book-visual--series book-visual--count-${covers.length}` : ""}`}>
    {covers.map(book => series
      ? <span className="series-cover-slot" key={book.id}><SharedBookCover book={book} /></span>
      : <SharedBookCover key={book.id} book={book} />)}
  </span>;
}
