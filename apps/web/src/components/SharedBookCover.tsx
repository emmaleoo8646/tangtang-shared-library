import type { Book } from "../api";
const palettes = [
  ["#d9e7ca", "#405d3b", "#819c64"],
  ["#f7e4aa", "#75532e", "#bc9449"],
  ["#f6ceae", "#815037", "#c38b67"],
  ["#d1e2ec", "#3e6279", "#87aebe"],
  ["#e3d8ea", "#725276", "#aa8eaf"],
];
export function SharedBookCover({
  book,
}: {
  book: Pick<Book, "id" | "title" | "coverUrl">;
}) {
  if (book.coverUrl)
    return (
      <img
        className="borrow-cover"
        src={book.coverUrl}
        alt={`${book.title}封面`}
      />
    );
  const hash = [...book.title].reduce((n, c) => n + c.codePointAt(0)!, 0);
  const [bg, ink, light] = palettes[hash % palettes.length];
  const chars = [...book.title],
    lines = [
      chars.slice(0, 8).join(""),
      chars.slice(8, 16).join("") + (chars.length > 16 ? "…" : ""),
    ].filter(Boolean);
  return (
    <div
      className="borrow-cover illustrated-cover"
      role="img"
      aria-label={`${book.title}，暂无封面照片`}
    >
      <svg viewBox="0 0 110 150" aria-hidden="true">
        <rect width="110" height="150" fill={bg} />
        <path d="M5 0v150" stroke={ink} opacity=".1" strokeWidth="3" />
        <text
          x="57"
          y="15"
          textAnchor="middle"
          fill={ink}
          opacity=".65"
          fontSize="5"
        >
          小书屋 · 封面待补充
        </text>
        {lines.map((line, i) => (
          <text
            key={i}
            x="56"
            y={32 + i * 11}
            textAnchor="middle"
            fill={ink}
            fontSize={chars.length > 7 ? "8" : "9.5"}
            fontWeight="600"
          >
            {line}
          </text>
        ))}
        <path d="M27 109l18-39 19 39z" fill={light} />
        <path d="M48 114l20-57 24 57z" fill={ink} opacity=".6" />
        <path d="M45 105v19M68 108v18" stroke={ink} strokeWidth="3" />
        <circle cx="27" cy="65" r="8" fill="#fff9df" />
        <path d="M18 128q34-7 76 0" stroke={ink} fill="none" opacity=".35" />
        <text
          x="56"
          y="143"
          textAnchor="middle"
          fill={ink}
          opacity=".7"
          fontSize="4.5"
        >
          一个故事，另一位小读者
        </text>
      </svg>
    </div>
  );
}
