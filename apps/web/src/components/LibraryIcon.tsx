export type LibraryIconName =
  | "search"
  | "shop"
  | "clock"
  | "home"
  | "book"
  | "chevron"
  | "plus"
  | "check"
  | "basket"
  | "close";
const paths: Record<LibraryIconName, string> = {
  search: "M17 17l4 4 M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0",
  shop: "M3 9l2-6h14l2 6 M4 12v9h16v-9 M8 21v-7h5v7 M3 9c0 3 4 3 4 0 0 3 5 3 5 0 0 3 5 3 5 0 0 3 4 3 4 0",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 6v6l4 2",
  home: "M3 10l9-7 9 7v10H3z M9 20v-7h6v7",
  book: "M3 4h6c2 0 3 1 3 2v15c0-2-2-3-4-3H3z M21 4h-6c-2 0-3 1-3 2v15c0-2 2-3 4-3h5z",
  chevron: "M9 5l7 7-7 7",
  plus: "M12 4v16 M4 12h16",
  check: "M5 12l4 4L19 6",
  basket: "M7 9l5-6 5 6 M3 9h18l-2 11H5z M9 12v5 M15 12v5",
  close: "M6 6l12 12 M18 6L6 18",
};
export function LibraryIcon({ name }: { name: LibraryIconName }) {
  return (
    <svg
      className="library-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
