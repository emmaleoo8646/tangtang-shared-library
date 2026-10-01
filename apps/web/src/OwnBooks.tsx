import { useState } from "react";
import type { Book } from "./api";
import { groupCatalog, seriesShelfSummary, shelfLabel, sortVolumes } from "./catalogPresentation";
import { BookVisual } from "./components/BookVisual";
import { SharedBookCover } from "./components/SharedBookCover";
import { Sheet } from "./Borrowing";

export function OwnBooks({ books, busy, showBook, editBook, setShelf, publish, organize }: {
  books: Book[];
  busy: boolean;
  showBook: (id: string) => void;
  editBook: (book: Book) => void;
  setShelf: (book: Book) => void;
  publish: () => void;
  organize: (name: string, summary: string, ids: string[]) => Promise<boolean>;
}) {
  const [organizing, setOrganizing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const groups = groupCatalog(books).sort((a, b) => Number(b.kind === "series") - Number(a.kind === "series"));
  const seriesRows = sortVolumes(books.filter(book => book.series?.id === seriesId));
  function endOrganizing() {
    setOrganizing(false); setSelectedIds([]); setName(""); setSummary("");
  }
  function controls(book: Book) {
    return <div className="shelf-book-controls">
      <button className="secondary-button" disabled={!book.editable || busy}
        title={book.editable ? "编辑图书" : "借阅申请或借出期间不能编辑"} onClick={() => editBook(book)}>编辑</button>
      {(book.available || book.offShelf) && <button className="secondary-button" disabled={busy} onClick={() => setShelf(book)}>
        {book.available ? "下架" : "上架"}</button>}
    </div>;
  }
  const items = organizing ? books.map(book => ({ key: book.id, kind: "single" as const, book, all: [book], rows: [book] })) : groups;
  return <>
    <div className="library-heading"><p>{books.length}本藏书 · {groups.filter(group => group.kind === "series").length}个系列</p>
      {books.length > 0 && <button className="secondary-button" disabled={busy} aria-pressed={organizing}
        onClick={() => organizing ? endOrganizing() : setOrganizing(true)}>{organizing ? "取消整理" : "整理系列"}</button>}
    </div>
    {organizing && <section className="series-organizer">
      <div><h3>多选藏书，整理为系列</h3><p>从下方选择分册。已有系列的书会移入新系列。</p></div>
      {selectedIds.length > 0 && <>
        <div className="field-grid"><label>系列名称<input maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>
          <label>系列介绍（选填）<input maxLength={1000} value={summary} onChange={e => setSummary(e.target.value)} /></label></div>
        <button className="primary-button" disabled={busy || !name.trim()} onClick={async () => {
          if (await organize(name, summary, selectedIds)) endOrganizing();
        }}>将{selectedIds.length}本整理为系列</button>
      </>}
    </section>}
    {!books.length && <div className="empty-state"><h3>给书屋添一本好书吧</h3><p>把读过的童书分享给下一位小读者。</p>
      <button className="secondary-button" onClick={publish}>发布第一本书</button></div>}
    <div className="reading-grid own-book-grid">{items.map(group => {
      const book = group.book, series = group.kind === "series";
      return <article className={`reading-card shelf-book-card ${selectedIds.includes(book.id) ? "is-selected" : ""}`} key={group.key}>
        {organizing && <label className="organize-check"><input type="checkbox" checked={selectedIds.includes(book.id)}
          aria-label={`选择${book.title}整理系列`} onChange={e => setSelectedIds(prev => e.target.checked ? [...prev, book.id] : prev.filter(id => id !== book.id))} />选择</label>}
        <button className="cover-link" aria-label={series ? `管理${book.series!.name}分册` : `查看${book.title}详情`}
          onClick={() => series ? setSeriesId(book.series!.id) : showBook(book.id)}>
          <BookVisual books={group.all} series={series} />
          {series && <span className="series-count">系列 · {group.all.length}册</span>}
        </button>
        <div className="reading-card-content">
          <h3><button className="plain-link" onClick={() => series ? setSeriesId(book.series!.id) : showBook(book.id)}>{series ? book.series!.name : book.title}</button></h3>
          {series ? <p className="shelf-summary">{seriesShelfSummary(group.all)}</p> : <>
            <p>{book.category} · {book.age}</p>
            <span className={`shelf-status ${book.available ? "available" : ""}`}>{shelfLabel(book)}</span>
            {book.nonChildren && <span className="non-child-badge">非儿童读物</span>}
          </>}
          {series ? <button className="secondary-button manage-series" onClick={() => setSeriesId(book.series!.id)}>管理分册 ›</button> : controls(book)}
        </div>
      </article>;
    })}</div>
    {seriesId && <Sheet title={seriesRows[0]?.series?.name || "管理分册"} variant="series" close={() => setSeriesId(null)}
      description={`全${seriesRows.length}册 · ${seriesShelfSummary(seriesRows)}`}>
      <div className="series-detail-layout"><aside className="series-introduction">
        <BookVisual books={seriesRows} series />
        <h3>关于这个系列</h3><p>{seriesRows[0]?.series?.summary || "书主暂未填写系列介绍。"}</p>
      </aside><section className="series-volumes"><h3>管理分册</h3><p>每本书的上架状态与借阅进展独立管理。</p>
        {seriesRows.map(book => <div className="volume-row volume-row--manage" key={book.id}>
          <button className="cover-link" onClick={() => { setSeriesId(null); showBook(book.id); }} aria-label={`查看${book.title}详情`}><SharedBookCover book={book} /></button>
          <div><button className="plain-link" onClick={() => { setSeriesId(null); showBook(book.id); }}><strong>{book.title}</strong></button>
            <p>{book.seriesOrder ? `第${book.seriesOrder}册 · ` : ""}{shelfLabel(book)}</p></div>{controls(book)}
        </div>)}
      </section></div>
    </Sheet>}
  </>;
}
