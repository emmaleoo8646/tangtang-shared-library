import type { Book } from "../api";
import { canBorrow, isOwnBook, shelfLabel } from "../catalogPresentation";
import { FamilyAvatar } from "./FamilyAvatar";
import { BookVisual } from "./BookVisual";

export function BookDetails({ book, familyId, onShop, onSeries, actions }: {
  book: Book;
  familyId?: string;
  onShop?: () => void;
  onSeries?: () => void;
  actions?: React.ReactNode;
}) {
  const own = isOwnBook(book, familyId);
  return <div className="book-detail-layout">
    <div className="book-detail-cover"><h1 className="mobile-detail-title">{book.title}</h1><BookVisual books={[book]} /></div>
    <div className="book-detail-info">
      <span className={`status ${canBorrow(book, familyId) || (own && book.available) ? "available" : "unavailable"}`}>
        {own ? book.available ? "可共享 · 本屋藏书" : shelfLabel(book) : canBorrow(book, familyId) ? "可借" : shelfLabel(book)}
      </span>
      <h1 className="desktop-detail-title">{book.title}</h1>
      {book.author && <p className="detail-author">作者：{book.author}</p>}
      <p className="detail-metadata">{book.category} · {book.age} · {book.condition}</p>
      {book.nonChildren && <span className="non-child-badge">非儿童读物</span>}
      {book.series && <button className="series-tag" disabled={!onSeries} onClick={onSeries}>
        {book.series.name}{book.seriesOrder ? ` · 第${book.seriesOrder}册` : ""}{onSeries ? " ›" : ""}
      </button>}
      {onShop && <button className="detail-owner" onClick={onShop}>
        <FamilyAvatar name={book.owner} src={book.ownerAvatarUrl} decorative />
        <span><strong>{book.owner}</strong><small>来自这家书屋</small></span>
        <span className="detail-owner-link">进书屋 ›</span>
      </button>}
      <section className="detail-summary"><h2>关于这本书</h2><p>{book.summary || "书主暂未填写简介。"}</p></section>
      <div className="detail-safety"><p>收到实体书后开始14天借期</p><p>由家长操作，在公共地点交接；书主收回后确认归还。</p></div>
      {actions && <div className="detail-actions">{actions}</div>}
    </div>
  </div>;
}
