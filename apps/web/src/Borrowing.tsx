import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  allBooks,
  ApiError,
  type Book,
  type Family,
  type Loan,
  type OptionLists,
} from "./api";
import { SharedBookCover } from "./components/SharedBookCover";
import { LibraryIcon } from "./components/LibraryIcon";
import { loanPresentation } from "./loanPresentation";
import { selectionPresentation } from "./selectionPresentation";
import { canBorrow, groupCatalog, isOwnBook, matchesCatalog, sortVolumes } from "./catalogPresentation";
import { BookVisual } from "./components/BookVisual";
import { FamilyAvatar } from "./components/FamilyAvatar";
import { BookDetails } from "./components/BookDetails";
import type { ReactNode } from "react";
import { NativeSelect } from "./components/Choices";
import { choicesStatusMessage, restoreCatalogFilter, type ChoicesStatus } from "./choicePresentation";

type Cart = {
  shopId: string;
  owner: string;
  books: Book[];
  message: string;
  key: string;
};
const storageKey = (id: string) => `tt-borrow-cart-v1:${id}`;
function readCarts(id: string): Cart[] {
  try {
    const v = JSON.parse(localStorage.getItem(storageKey(id)) || "[]");
    return Array.isArray(v)
      ? v.filter(
          (c) =>
            typeof c.shopId === "string" &&
            Array.isArray(c.books) &&
            typeof c.key === "string",
        )
      : [];
  } catch {
    return [];
  }
}
const newKey = () => crypto.randomUUID();
export function useBorrowCart(
  family: Family | null,
  ready: boolean,
  books: Book[],
  refresh: () => Promise<void>,
  login: () => void,
  flash: (text: string) => void,
) {
  const [carts, setCarts] = useState<Cart[]>([]);
  const [cartAccount, setCartAccount] = useState("");
  const [activeShop, setActiveShop] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<{
    shopId: string;
    ids: string[];
  } | null>(null);
  const [success, setSuccess] = useState<Cart | null>(null);
  const identity = useRef("");
  const lock = useRef(false);
  const account = family?.id || "guest";
  useEffect(() => {
    if (!ready || identity.current === account) return;
    let next = readCarts(account);
    if (account !== "guest") {
      for (const guest of readCarts("guest")) {
        if (guest.shopId === account) continue;
        const current = next.find((c) => c.shopId === guest.shopId);
        if (current) {
          current.books = [
            ...current.books,
            ...guest.books.filter(
              (b) => !current.books.some((a) => a.id === b.id),
            ),
          ];
          current.key = newKey();
        } else next.push({ ...guest, key: newKey() });
      }
      localStorage.removeItem(storageKey("guest"));
    }
    next = next.filter(c => c.shopId !== account);
    identity.current = account;
    setCarts(next);
    setCartAccount(account);
    setActiveShop((previous) =>
      next.some((c) => c.shopId === previous)
        ? previous
        : next[0]?.shopId || "",
    );
    setConflict(null);
    setSuccess(null);
    setOpen(false);
  }, [account, ready]);
  useEffect(() => {
    if (ready && cartAccount === account)
      localStorage.setItem(storageKey(account), JSON.stringify(carts));
  }, [carts, account, ready, cartAccount]);
  const currentBooks = (cart: Cart) =>
    cart.books.map((saved) => {
      const current = books.find((b) => b.id === saved.id) ?? {
        ...saved,
        available: false,
        status: "OFF_SHELF",
      };
      return conflict?.shopId === cart.shopId &&
        conflict.ids.includes(saved.id) &&
        current.available
        ? { ...current, available: false, status: "UNAVAILABLE" }
        : current;
    });
  function choose(rows: Book[], toggle = false) {
    const eligible = rows.filter(
      (b) => canBorrow(b, family?.id),
    );
    if (!eligible.length) return;
    const first = eligible[0];
    setActiveShop(first.shopId);
    setSuccess(null);
    setConflict(null);
    setCarts((prev) => {
      const next = prev.map((c) => ({ ...c, books: [...c.books] }));
      let cart = next.find((c) => c.shopId === first.shopId);
      if (!cart) {
        cart = {
          shopId: first.shopId,
          owner: first.owner,
          books: [],
          message: "",
          key: newKey(),
        };
        next.push(cart);
      }
      for (const book of eligible.filter((b) => b.shopId === first.shopId)) {
        const present = cart.books.some((b) => b.id === book.id);
        if (toggle && present)
          cart.books = cart.books.filter((b) => b.id !== book.id);
        else if (!present) cart.books.push(book);
      }
      cart.key = newKey();
      return next.filter((c) => c.books.length);
    });
  }
  function remove(shopId: string, id: string) {
    setConflict(null);
    setCarts((prev) =>
      prev
        .map((c) =>
          c.shopId === shopId
            ? { ...c, books: c.books.filter((b) => b.id !== id), key: newKey() }
            : c,
        )
        .filter((c) => c.books.length),
    );
  }
  function message(shopId: string, value: string) {
    setCarts((prev) =>
      prev.map((c) =>
        c.shopId === shopId ? { ...c, message: value, key: newKey() } : c,
      ),
    );
  }
  async function submit(cart: Cart, availableOnly = false) {
    if (!family) {
      setOpen(false);
      login();
      return;
    }
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const rows = currentBooks(cart);
      // Send the original key even if availability changed: the server may already have
      // committed this request before a previous response was lost.
      const ids = (availableOnly ? rows.filter((b) => canBorrow(b, family?.id)) : rows).map(
        (b) => b.id,
      );
      if (!ids.length) {
        flash("没有仍可借的图书");
        return;
      }
      const key = availableOnly ? newKey() : cart.key;
      // Persist the explicit revised request before network I/O so a retry keeps the same key.
      const submitted = {
        ...cart,
        key,
        books: cart.books.filter((b) => ids.includes(b.id)),
      };
      if (availableOnly) {
        const revised = carts.map((c) =>
          c.shopId === cart.shopId ? submitted : c,
        );
        localStorage.setItem(storageKey(account), JSON.stringify(revised));
        setCarts(revised);
        setConflict(null);
      }
      await api("/loan-groups", "POST", {
        shopId: cart.shopId,
        bookIds: ids,
        message: cart.message,
        idempotencyKey: key,
      });
      setCarts((prev) => prev.filter((c) => c.shopId !== cart.shopId));
      setConflict(null);
      setSuccess(submitted);
      setOpen(false);
      await refresh();
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        error.unavailableIds.length
      ) {
        setConflict({ shopId: cart.shopId, ids: error.unavailableIds });
        setOpen(true);
        await refresh().catch(() => {});
      }
      flash((error as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const selected = (book: Book) =>
    carts.some((c) => c.books.some((b) => b.id === book.id));
  return {
    familyId: family?.id,
    carts,
    activeShop,
    setActiveShop,
    open,
    setOpen,
    busy,
    conflict,
    success,
    setSuccess,
    currentBooks,
    choose,
    remove,
    message,
    submit,
    selected,
  };
}
export type BorrowCart = ReturnType<typeof useBorrowCart>;
export function Cover({ book }: { book: Book }) {
  return <SharedBookCover book={book} />;
}
const stateLabel = (b: Book) =>
  b.mine ? "本屋藏书" : b.status === "AVAILABLE"
    ? "可借"
    : b.status === "RESERVED"
      ? "申请中"
      : b.status === "ON_LOAN"
        ? "借出中"
        : b.status === "OFF_SHELF"
          ? "已下架"
          : "暂不可借";
export function SelectBook({ book, cart }: { book: Book; cart: BorrowCart }) {
  const chosen = cart.selected(book);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (restoreFocus.current) {
      buttonRef.current?.focus({ preventScroll: true });
      restoreFocus.current = false;
    }
  }, [chosen]);
  if (chosen) return (
    <div className="book-selection-control" role="group" aria-label={`${book.title}已选1本`}>
      <button
        ref={buttonRef}
        aria-label={`移除《${book.title}》`}
        disabled={cart.busy}
        onClick={() => {
          restoreFocus.current = true;
          cart.remove(book.shopId, book.id);
        }}
      >−</button>
      <span><LibraryIcon name="check" />已选1本</span>
    </div>
  );
  return (
    <button
      ref={buttonRef}
      className="select-book"
      aria-label={canBorrow(book, cart.familyId) ? `选这本《${book.title}》` : undefined}
      aria-pressed={false}
      disabled={!canBorrow(book, cart.familyId) || cart.busy}
      onClick={() => {
        restoreFocus.current = true;
        cart.choose([book]);
      }}
    >
      {isOwnBook(book, cart.familyId) ? "本屋藏书" : !canBorrow(book, cart.familyId) ? stateLabel(book) : "＋ 选这本"}
    </button>
  );
}
function SeriesSelect({ rows, cart, filtering, complete, primary = false }: {
  rows: Book[]; cart: BorrowCart; filtering: boolean; complete: () => void; primary?: boolean;
}) {
  const selection = selectionPresentation(rows, cart.selected, cart.familyId);
  return <button
    className={`${primary ? "primary-button" : "select-book"} ${selection.allSelected ? "chosen" : ""}`}
    disabled={cart.busy || !selection.total}
    onClick={() => selection.allSelected ? complete() : cart.choose(selection.remaining)}
  >
    {!selection.total ? rows.length > 0 && rows.every((b) => b.mine) ? "本屋藏书" : "暂无可借分册"
    : selection.allSelected
    ? primary ? "完成选书" : `✓ 已选${selection.total}本`
    : selection.selectedCount ? `选剩余${selection.remaining.length}本`
    : `${filtering ? "选符合条件的" : "选可借"}${selection.total}本`}</button>;
}
export function Sheet({
  title,
  close,
  children,
  footer,
  eyebrow,
  description,
  variant,
}: {
  eyebrow?: string;
  description?: string;
  variant?: "book" | "series";
  title: string;
  close: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const focus = document.activeElement as HTMLElement | null;
    const selectedOption = ref.current?.querySelector<HTMLElement>(
      '[role="option"][aria-selected="true"]',
    );
    (selectedOption || ref.current)?.focus();
    const key = (e: KeyboardEvent) => {
      const sheets = document.querySelectorAll(".borrow-sheet");
      if (sheets[sheets.length - 1] !== ref.current) return;
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        close();
      }
      if (e.key === "Tab") {
        const nodes = Array.from(ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,textarea,select,a[href],[tabindex="0"]',
        ) || []).filter(node => !node.hasAttribute("disabled") && node.getClientRects().length > 0);
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            !ref.current?.contains(document.activeElement) ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !ref.current?.contains(document.activeElement))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
      focus?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div className="borrow-backdrop" onClick={close}>
      <div
        ref={ref}
        tabIndex={-1}
        className={`borrow-sheet ${variant ? `borrow-sheet--${variant}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          {variant && <button className="sheet-back" onClick={close}>‹ 返回{variant === "book" ? "找书" : "图书列表"}</button>}
          <div className="sheet-heading">
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h2>{title}</h2>
            {description && <p className="sheet-description">{description}</p>}
          </div>
          <button aria-label="关闭" onClick={close}>
            ×
          </button>
        </header>
        <div className="borrow-sheet-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}
export function Shops({
  books,
  enterShop,
}: {
  books: Book[];
  enterShop: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const shops = [
    ...new Map(
      books
        .filter((b) => !b.offShelf && b.status !== "DRAFT")
        .map((b) => [b.shopId, b]),
    ).values(),
  ];
  return (
    <>
      <div className="page-title">
        <p className="eyebrow">一家书屋，一袋故事</p>
        <h1>逛书屋</h1>
        <p>走进一家书屋，选几本喜欢的书一起借。</p>
      </div>
      <div className="browse-search">
        <LibraryIcon name="search" />
        <input
          aria-label="搜索书屋"
          placeholder="搜索书屋名称"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="shop-grid">
        {shops
          .filter((b) => b.owner.includes(query.trim()))
          .map((b) => {
            const rows = books.filter(
              (v) =>
                v.shopId === b.shopId && !v.offShelf && v.status !== "DRAFT",
            );
            return (
              <button
                className="public-shop-card"
                key={b.shopId}
                onClick={() => enterShop(b.shopId)}
              >
                <div className="shop-card-heading">
                  <FamilyAvatar name={b.owner} src={b.ownerAvatarUrl} decorative />
                  <div>
                    <h2>{b.owner}</h2>
                    <p>
                      {rows.length}本藏书 ·{" "}
                      {rows.filter(v => canBorrow(v)).length}本可借
                    </p>
                  </div>
                  <LibraryIcon name="chevron" />
                </div>
                <div className="shop-preview">
                  {rows.slice(0, 4).map((v) => (
                    <Cover book={v} key={v.id} />
                  ))}
                </div>
                <span className="shop-enter">
                  进书屋选书 <LibraryIcon name="chevron" />
                </span>
              </button>
            );
          })}
      </div>
      {!shops.some((b) => b.owner.includes(query.trim())) && (
        <div className="empty-state">
          <h3>没有找到这家书屋</h3>
          <p>换个名称再试试。</p>
        </div>
      )}
    </>
  );
}
export function Browse({
  books,
  options,
  optionsStatus,
  cart,
  onShopChange,
  onBrowseShops,
}: {
  books: Book[];
  options: OptionLists;
  optionsStatus: ChoicesStatus;
  cart: BorrowCart;
  onShopChange: (id: string) => void;
  onBrowseShops: () => void;
}) {
  const saved = useMemo(() => {
    try {
      const state = JSON.parse(sessionStorage.getItem("tt-browse") || "{}");
      const currentShop =
        new URLSearchParams(location.search).get("shop") || "";
      return (state.shopId || "") === currentShop ? state : {};
    } catch {
      return {};
    }
  }, []);
  const [shopId, setShopId] = useState(
    new URLSearchParams(location.search).get("shop") || "",
  );
  const [shop, setShop] = useState<{ id: string; displayName: string; avatarUrl: string | null } | null>(
    null,
  );
  const [shopBooks, setShopBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 4000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const [query, setQuery] = useState<string>(saved.query || "");
  const [age, setAge] = useState<string>(saved.age || "全部");
  const [category, setCategory] = useState<string>(saved.category || "全部");
  const [onlyAvailable, setOnlyAvailable] = useState<boolean>(
    saved.onlyAvailable || false,
  );
  const [series, setSeries] = useState<Book | null>(null);
  const [detail, setDetail] = useState<Book | null>(null);
  useEffect(() => {
    onShopChange(shopId);
  }, [shopId, onShopChange]);
  const scroll = useRef<number>(saved.scroll || 0);
  useEffect(() => {
    if (optionsStatus !== "ready") return;
    const nextAge = restoreCatalogFilter(age, options.ages);
    const nextCategory = restoreCatalogFilter(category, options.categories);
    if (nextAge !== age || nextCategory !== category) scroll.current = 0;
    setAge(nextAge);
    setCategory(nextCategory);
  }, [age, category, options, optionsStatus]);
  useEffect(() => {
    const restoreY = scroll.current;
    const restore = requestAnimationFrame(() => window.scrollTo(0, restoreY));
    const save = () => {
      scroll.current = window.scrollY;
      sessionStorage.setItem(
        "tt-browse",
        JSON.stringify({
          shopId,
          query,
          age,
          category,
          onlyAvailable,
          scroll: scroll.current,
        }),
      );
    };
    sessionStorage.setItem(
      "tt-browse",
      JSON.stringify({
        shopId,
        query,
        age,
        category,
        onlyAvailable,
        scroll: restoreY,
      }),
    );
    window.addEventListener("scroll", save);
    return () => {
      cancelAnimationFrame(restore);
      window.removeEventListener("scroll", save);
    };
  }, [shopId, query, age, category, onlyAvailable]);
  useEffect(() => {
    let cancelled = false;
    if (!shopId) {
      setShop(null);
      return;
    }
    setLoading(true);
    setError("");
    Promise.all([
      api<{ id: string; displayName: string; avatarUrl: string | null }>(`/shops/${shopId}`),
      allBooks(`/shops/${shopId}/books`),
    ])
      .then(([s, rows]) => {
        if (!cancelled) {
          setShop(s);
          setShopBooks(rows.map((b) => books.find((a) => a.id === b.id) ?? b));
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shopId, books]);
  useEffect(() => {
    const pop = () => {
      setShopId(new URLSearchParams(location.search).get("shop") || "");
      setQuery("");
      setAge("全部");
      setCategory("全部");
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  function enterShop(id: string) {
    setShopId(id);
    setCopied(false);
    onShopChange(id);
    cart.setActiveShop(id);
    setQuery("");
    setAge("全部");
    setCategory("全部");
    setOnlyAvailable(false);
    scroll.current = 0;
    history.pushState(null, "", id ? `/?shop=${encodeURIComponent(id)}` : "/");
    window.scrollTo(0, 0);
  }
  const source = (shopId ? shopBooks : books)
    .filter(book => !book.offShelf && book.status !== "DRAFT")
    .map(book => ({ ...book, mine: isOwnBook(book, cart.familyId) }));
  const fits = (book: Book) => matchesCatalog(book, { query, age, category, onlyAvailable }, cart.familyId);
  const results = source.filter(fits)
    .sort((a, b) => Number(canBorrow(b, cart.familyId)) - Number(canBorrow(a, cart.familyId)));
  const displayGroups = groupCatalog(source, results, query);
  const seriesAll = series ? sortVolumes(source.filter(book =>
    book.series?.id === series.series?.id && book.shopId === series.shopId,
  )) : [];
  const filtering = age !== "全部" || category !== "全部" || onlyAvailable;
  const shops = [
    ...new Map(
      books
        .filter((b) => !b.offShelf)
        .map((b) => [b.shopId, { id: b.shopId, owner: b.owner, avatarUrl: b.ownerAvatarUrl }]),
    ).values(),
  ];
  return (
    <>
      {shopId ? (
        <section className="public-shop-banner">
          <button
            className="shop-back text-button"
            onClick={() => enterShop("")}
          >
            ‹ 返回找书
          </button>
          <div className="shop-banner-heading">
            <FamilyAvatar name={shop?.displayName || "书"} src={shop?.avatarUrl} decorative />
            <div>
              <p className="eyebrow">欢迎来我家书屋</p>
              <h1>{shop?.displayName || "家庭书屋"}</h1>
            </div>
          </div>
          <p>在这一家选几本，一次申请，一起交接。</p>
          <div className="shop-banner-bottom">
            <span>
              {source.length}本藏书 · {source.filter(b => canBorrow(b, cart.familyId)).length}
              本可借
            </span>
            <button
              className="text-button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    `${location.origin}/?shop=${encodeURIComponent(shopId)}`,
                  );
                  setCopied(true);
                } catch {
                  setError("未能复制，请复制浏览器中的书屋地址。");
                }
              }}
            >
              {copied ? "地址已复制" : "复制书屋地址"}
            </button>
          </div>
        </section>
      ) : <section className="reading-hero">
        <div>
          <p className="eyebrow">分享闲置童书 · 免费借阅</p>
          <h1>一起借几本，<br />带一袋故事回家。</h1>
          <p>发现喜欢的书，走进书屋，一次借齐几本。</p>
        </div>
        <img src="/brand.png" alt="两个孩子在书屋分享图书" />
      </section>}
      <section className="browse-tools">
        <div className="browse-search">
          <LibraryIcon name="search" />
          <input
            aria-label="搜索书名、作者或系列"
            placeholder={shopId ? "在这家书屋找书" : "搜索书名、作者或系列"}
            value={query}
            onChange={(e) => {
              scroll.current = 0;
              setQuery(e.target.value);
            }}
          />
          {query && (
            <button aria-label="清除搜索" onClick={() => setQuery("")}>
              ×
            </button>
          )}
        </div>
        <div className="browse-filters">
          <div className="category-pills">
            {["全部", ...options.categories.map((o) => o.label)].map((c) => (
              <button
                key={c}
                disabled={optionsStatus !== "ready"}
                aria-pressed={category === c}
                className={category === c ? "selected" : ""}
                onClick={() => {
                  scroll.current = 0;
                  setCategory(c);
                }}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="browse-age">
            <NativeSelect
              hideLabel
              disabled={optionsStatus !== "ready"}
              message={choicesStatusMessage(optionsStatus)}
              label="适读年龄"
              value={age}
              options={[
                { value: "全部", label: "全部年龄" },
                ...options.ages.map((o) => ({
                  value: o.label,
                  label: o.label,
                })),
              ]}
              onChange={(v) => {
                scroll.current = 0;
                setAge(v);
              }}
            />
            <label>
              <input
                type="checkbox"
                checked={onlyAvailable}
                onChange={(e) => setOnlyAvailable(e.target.checked)}
              />
              只看可借
            </label>
          </div>
        </div>
      </section>
      {!shopId && (
          <section className="shop-shortcuts" aria-label="推荐书屋">
            <div className="shop-shortcuts-heading"><h2>逛逛小书屋</h2>
              <button className="text-button" onClick={onBrowseShops}>更多书屋 ›</button>
            </div>
            <div className="shop-shortcuts-list">
            {shops.slice(0, 4).map((s) => (
              <button key={s.id} aria-label={`进入${s.owner}`} onClick={() => enterShop(s.id)}>
                <FamilyAvatar name={s.owner} src={s.avatarUrl} decorative />
                <span className="shortcut-info"><b>{s.owner}</b><small>
                  {books.filter(b => b.shopId === s.id && canBorrow(b, cart.familyId)).length}本可借 · {books.filter((b) => b.shopId === s.id && !b.offShelf).length}本藏书
                </small></span>
                <LibraryIcon name="chevron" />
              </button>
            ))}
            </div>
          </section>
      )}
      <div className="section-heading">
        <h2>{loading ? "正在打开书屋…" : `找到 ${results.length} 本书`}</h2>
        <span>点封面看详情 · 直接选书</span>
      </div>
      {error && <p role="alert">{error}</p>}
      {!loading && !results.length && (
        <div className="empty-state">
          <h3>
            {source.length ? "没有符合条件的图书" : "这家书屋还没有公开藏书"}
          </h3>
          <button
            onClick={() => {
              setQuery("");
              setAge("全部");
              setCategory("全部");
              setOnlyAvailable(false);
            }}
          >
            清除筛选
          </button>
        </div>
      )}
      <div className="reading-grid">
        {displayGroups.map(({ key, kind, book, rows, all }) => {
          const isSeries = kind === "series";
          const eligible = selectionPresentation(rows, cart.selected, cart.familyId);
          const own = isOwnBook(book, cart.familyId);
          const count = own ? all.filter(b => b.available).length : all.filter(b => canBorrow(b, cart.familyId)).length;
          return <article className={`reading-card ${isSeries ? "reading-series" : ""} ${rows.some(cart.selected) ? "is-selected" : ""}`} key={key}>
            <button className="cover-link" aria-label={`查看${isSeries ? book.series!.name : book.title}详情`}
              onClick={() => isSeries ? setSeries(book) : setDetail(book)}>
              <BookVisual books={rows} series={isSeries} />
              {isSeries && <span className="series-count">系列 · {all.length}册</span>}
              {!isSeries && (!canBorrow(book, cart.familyId) || book.nonChildren) && <span className="cover-state">{book.nonChildren ? "非儿童读物" : stateLabel(book)}</span>}
            </button>
            <div className="reading-card-content">
              <h3><button className="plain-link" onClick={() => isSeries ? setSeries(book) : setDetail(book)}>{isSeries ? book.series!.name : book.title}</button></h3>
              <p>{isSeries ? `全${all.length}册 · ${count}册${own ? "可共享" : "可借"}` : `${book.age} · ${book.condition}`}</p>
              {isSeries && (filtering || query) && <p className="matched-count">当前符合{rows.length}册</p>}
              <button className="book-source text-button" onClick={() => enterShop(book.shopId)}>{book.owner} ›</button>
              {!isSeries && book.series && <button className="series-tag" onClick={() => setSeries(book)}>{book.series.name} ›</button>}
              {isSeries ? <div className="series-buttons">
                <SeriesSelect rows={rows} cart={cart} filtering={filtering || !!query} complete={() => setSeries(book)} />
                <button className="text-button" onClick={() => setSeries(book)}>挑选分册{eligible.selectedCount ? ` · 已选${eligible.selectedCount}本` : ""} ›</button>
              </div> : <SelectBook book={book} cart={cart} />}
            </div>
          </article>;
        })}
      </div>
      {series && (
        <div style={detail ? { visibility: "hidden" } : undefined}>
          <Sheet
            title={series.series!.name}
            variant="series"
            eyebrow="在当前页面，继续挑选"
            description={`${series.owner} · 本屋这个系列共${seriesAll.length}本，${seriesAll.filter(b => canBorrow(b, cart.familyId)).length}本可借。每本都可以单独选。`}
            close={() => setSeries(null)}
            footer={
              <>
                <small className="sheet-footer-note">{seriesAll.filter(fits).filter(cart.selected).length
                  ? `已选${seriesAll.filter(fits).filter(cart.selected).length}本${filtering || query ? "符合条件的书" : ""}`
                  : "展开不会自动选书"}</small>
                <SeriesSelect rows={seriesAll.filter(fits)} cart={cart} filtering={filtering || !!query}
                  primary complete={() => setSeries(null)} />
              </>
            }
          >
            <div className="series-detail-layout"><aside className="series-introduction"><BookVisual books={seriesAll} series /><section className="series-about">
              <h3>关于这个系列</h3>
              <p>
                {series.series!.summary ||
                  "书主暂未填写系列介绍。每本可单独借阅，也可以一起选择。"}
              </p>
            </section>
            </aside><section className="series-volumes"><h3>挑选分册</h3>
            <small>点封面或书名查看详情</small>
            {seriesAll.filter(fits).map((b) => (
              <div className="volume-row" key={b.id}>
                <button
                  className="cover-link"
                  aria-label={`查看${b.title}详情`}
                  onClick={() => setDetail(b)}
                >
                  <Cover book={b} />
                </button>
                <div>
                  <button className="plain-link" onClick={() => setDetail(b)}>
                    <strong>{b.title}</strong>
                  </button>
                  <p>
                    {b.seriesOrder ? `第${b.seriesOrder}册 · ` : ""}
                    {b.condition} · {stateLabel(b)}
                  </p>
                  <button className="text-button" onClick={() => setDetail(b)}>
                    查看详情 ›
                  </button>
                </div>
                <SelectBook book={b} cart={cart} />
              </div>
            ))}
            {!seriesAll.filter(fits).length && <p className="series-no-match">没有符合当前筛选条件的分册。</p>}
            </section></div>
          </Sheet>
        </div>
      )}
      {detail && (
        <Sheet
          title={detail.title}
          variant="book"
          close={() => setDetail(null)}
          footer={
            <>
              <button className="text-button" onClick={() => setDetail(null)}>
                {series ? "‹ 返回分册列表" : "‹ 返回找书"}
              </button>
              <SelectBook
                book={books.find((b) => b.id === detail.id) ?? detail}
                cart={cart}
              />
            </>
          }
        >
          <BookDetails book={source.find(book => book.id === detail.id) ?? detail} familyId={cart.familyId}
            onShop={() => { setDetail(null); setSeries(null); enterShop(detail.shopId); }}
            onSeries={detail.series ? () => { setSeries(detail); setDetail(null); } : undefined} />
        </Sheet>
      )}
    </>
  );
}
export function CartPanel({
  cart,
  viewOrders,
  continueShop,
  showBar,
  shopId,
}: {
  showBar: boolean;
  shopId: string;
  cart: BorrowCart;
  viewOrders: () => void;
  continueShop: (id: string) => void;
}) {
  const [detail, setDetail] = useState<Book | null>(null);
  const detailReturnFocus = useRef<HTMLElement | null>(null);
  function showDetail(book: Book, trigger: HTMLElement) {
    detailReturnFocus.current = trigger;
    setDetail(book);
  }
  function closeDetail() {
    setDetail(null);
    requestAnimationFrame(() => detailReturnFocus.current?.focus({ preventScroll: true }));
  }
  useEffect(() => { if (!cart.open) setDetail(null); }, [cart.open]);
  const current = shopId
    ? cart.carts.find((c) => c.shopId === shopId)
    : cart.carts.find((c) => c.shopId === cart.activeShop) || cart.carts[0];
  return (
    <>
      {showBar && (current || cart.carts.length > 0) && (
        <div className="cart-bar" aria-label="已选图书操作栏">
          <div className="cart-icon"><LibraryIcon name="basket" />
            {current && <em>{current.books.length}</em>}
          </div>
          <div className="cart-info">
            <b>{current ? `${current.owner} · 已选${current.books.length}本` : `已在${cart.carts.length}家书屋选好书`}</b>
            <small>{!current ? "这家还没选书，之前的选择已保留"
              : cart.carts.length > 1 ? `其他${cart.carts.length - 1}家书屋的选择也已保留`
              : current.books.slice(0, 2).map((b) => b.title).join("、") + (current.books.length > 2 ? "…" : "")}</small>
          </div>
          <div className="cart-bar-actions">
            <button className="text-button" onClick={() => cart.setOpen(true)}>
              {cart.carts.length > 1 ? `已选书 · ${cart.carts.length}家` : "查看已选"}
            </button>
            {current && <button className="primary-button" disabled={cart.busy}
              onClick={() => void cart.submit(current)}>
              {cart.busy ? "提交中…" : "申请借阅"}
            </button>}
          </div>
        </div>
      )}
      {cart.open && (
        <div style={detail ? { visibility: "hidden" } : undefined}>
          <Sheet
            title={`已选书 · ${cart.carts.length}家书屋`}
            eyebrow="和一家书屋，一次借几本"
            description="各家分别申请、分别交接。提交一家，其他选择会保留。"
            close={() => cart.setOpen(false)}
            footer={<><small className="sheet-footer-note">选书不占用，提交成功才预约</small>
              <button className="secondary-button" onClick={() => cart.setOpen(false)}>继续选书</button></>}
          >
            {!cart.carts.length && <div className="empty-state"><LibraryIcon name="basket" /><h3>还没有选书</h3><p>去书屋挑几本喜欢的吧。</p></div>}
            {cart.carts.map((c) => (
              <section className="cart-group" key={c.shopId}>
                <div className="cart-group-heading">
                  <FamilyAvatar name={c.owner} src={cart.currentBooks(c)[0]?.ownerAvatarUrl} decorative />
                  <h3>{c.owner}</h3><span className="cart-count">已选{c.books.length}本</span>
                </div>
                {cart.currentBooks(c).map((b) => (
                  <div className="cart-book" key={b.id}>
                    <button className="cover-link" aria-label={`查看${b.title}详情`} onClick={(e) => showDetail(b, e.currentTarget)}><Cover book={b} /></button>
                    <div className="cart-book-info">
                      <button className="plain-link" onClick={(e) => showDetail(b, e.currentTarget)}><strong>{b.title}</strong></button>
                      <p>{b.age} · {b.condition}</p>
                      <small className={!b.available ? "conflict-note" : "cart-available"}>{stateLabel(b)}</small>
                    </div>
                    <button className="cart-remove" aria-label={`移除《${b.title}》`} disabled={cart.busy}
                      onClick={() => cart.remove(c.shopId, b.id)}>−<span>移除</span></button>
                  </div>
                ))}
                <label className="cart-message">
                  给书主的话 <small>选填</small>
                  <textarea disabled={cart.busy} maxLength={500} rows={2}
                    placeholder="例如：周末方便取书吗？"
                    value={c.message} onChange={(e) => cart.message(c.shopId, e.target.value)} />
                </label>
                {cart.conflict?.shopId === c.shopId && <p className="cart-conflict conflict-note" role="alert">
                  {cart.conflict.ids.length}本状态已变化，本次尚未创建申请。请确认后再提交。
                </p>}
                <div className="cart-group-actions">
                  <button className="text-button" disabled={cart.busy} onClick={() => {
                    cart.setOpen(false); continueShop(c.shopId);
                  }}>继续逛这家 ›</button>
                  {cart.conflict?.shopId === c.shopId ? <button className="primary-button"
                    disabled={cart.busy || !cart.currentBooks(c).some((b) => b.available)}
                    onClick={() => void cart.submit(c, true)}>
                    只申请仍可借的{cart.currentBooks(c).filter((b) => b.available).length}本
                  </button> : <button className="primary-button" disabled={cart.busy} onClick={() => void cart.submit(c)}>
                    {cart.busy ? "提交中…" : `向这家申请${c.books.length}本`}
                  </button>}
                </div>
              </section>
            ))}
          </Sheet>
        </div>
      )}
      {detail && cart.open && <Sheet title={detail.title} variant="book"
        eyebrow="先了解内容，再决定选不选"
        description={`${detail.owner} · 单本图书详情`}
        close={closeDetail}
        footer={<><button className="text-button" onClick={closeDetail}>‹ 返回已选清单</button>
          <SelectBook book={cart.carts.flatMap((c) => cart.currentBooks(c)).find((b) => b.id === detail.id) ?? detail} cart={cart} /></>}
      >
        <BookDetails book={cart.carts.flatMap(c => cart.currentBooks(c)).find(b => b.id === detail.id) ?? detail}
          familyId={cart.familyId} />
      </Sheet>}
      {cart.success && (
        <Sheet title="申请已提交" eyebrow="已经为你预约好这些书"
          close={() => cart.setSuccess(null)}
          footer={<>
            <button className="secondary-button" onClick={() => {
              const id = cart.success!.shopId;
              cart.setSuccess(null);
              continueShop(id);
            }}>继续逛书屋</button>
            <button className="primary-button" onClick={() => {
              cart.setSuccess(null);
              viewOrders();
            }}>查看申请</button>
          </>}
        >
          <p>向{cart.success.owner}申请了{cart.success.books.length}本书，等待书主在48小时内处理。</p>
        </Sheet>
      )}
    </>
  );
}
const loanStatus: Record<string, string> = {
  REQUESTED: "待审批",
  APPROVED: "待确认地点",
  HANDOFF_AGREED: "待取书",
  LENT: "借阅中",
  RETURN_REQUESTED: "待收回",
  RETURNED: "已归还",
  CANCELLED: "已取消",
  REJECTED: "未同意",
  EXPIRED: "已超时",
};
export function groupLoans(loans: Loan[]) {
  const groups: Loan[][] = [];
  for (const loan of loans) {
    const group =
      loan.groupId && groups.find((rows) => rows[0].groupId === loan.groupId);
    if (group) group.push(loan);
    else groups.push([loan]);
  }
  return groups;
}
export function GroupCard({
  loans,
  busy,
  act,
  familyId,
  defaultPlace,
  books,
}: {
  books: Book[];
  loans: Loan[];
  busy: boolean;
  familyId: string;
  defaultPlace: string;
  act: (
    id: string,
    action: string,
    extra?: Record<string, unknown>,
  ) => Promise<void>;
}) {
  const first = loans[0];
  const previousPlace =
    localStorage.getItem(`tt-last-place:${familyId}`) || defaultPlace;
  const [place, setPlace] = useState(
    loans.find((l) => l.place)?.place || previousPlace,
  );
  const [picker, setPicker] = useState<{
    action: string;
    rows: Loan[];
    label: string;
    approve: boolean;
  } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const pending = loans.filter((l) => l.stage === "REQUESTED");
  const awaitingPlace = loans.filter((l) => l.stage === "APPROVED");
  const legacyHandoff = loans.filter(
    (l) =>
      !l.groupId &&
      l.stage === "HANDOFF_AGREED" &&
      l.borrowerLoanConfirmed &&
      !l.ownerLoanConfirmed,
  );
  const receive = loans.filter(
    (l) => l.stage === "HANDOFF_AGREED" && !l.borrowerLoanConfirmed,
  );
  const lent = loans.filter((l) =>
    ["LENT", "RETURN_REQUESTED"].includes(l.stage),
  );
  const renew = loans.filter(
    (l) => l.stage === "LENT" && !l.renewed && !l.renewalRequested,
  );
  const approveRenew = loans.filter(
    (l) => l.stage === "LENT" && l.renewalRequested && !l.renewed,
  );
  const returnRequest = loans.filter(
    (l) => l.stage === "LENT" && !l.borrowerReturnConfirmed,
  );
  const presentation = loanPresentation(loans);
  async function perform(action: string, rows: Loan[], declineRest = false) {
    try {
      await act(first.groupId || first.id, action, {
        loanIds: rows.map((l) => l.id),
        ...(action === "approve" || action === "set-place" ? { place } : {}),
        ...(declineRest ? { declineRest: true } : {}),
      });
      if ((action === "approve" || action === "set-place") && place.trim())
        localStorage.setItem(`tt-last-place:${familyId}`, place);
      return true;
    } catch {
      return false;
    }
  }
  function partial(
    action: string,
    rows: Loan[],
    label: string,
    approve = false,
  ) {
    setPicker({ action, rows, label, approve });
    setPicked(rows.map((l) => l.id));
  }
  function controls(
    action: string,
    rows: Loan[],
    label: string,
    partialLabel: string,
    approve = false,
  ) {
    if (!rows.length) return null;
    return (
      <div className="action-row">
        <button
          className={
            action === "cancel" ? "secondary-button" : "primary-button"
          }
          disabled={busy || (approve && !place.trim())}
          onClick={() => void perform(action, rows)}
        >
          {label}
          {rows.length}本
        </button>
        {rows.length > 1 && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => partial(action, rows, partialLabel, approve)}
          >
            {partialLabel}
          </button>
        )}
      </div>
    );
  }
  return (
    <article className="loan-group-card">
      <div className="loan-group-heading">
        <FamilyAvatar name={first.isOwner ? first.borrower : first.owner} src={first.isOwner ? first.borrowerAvatarUrl : first.ownerAvatarUrl} decorative />
        <div>
          <h2>
            {first.isOwner
              ? `${first.borrower}向你借书`
              : `向${first.owner}借书`}{" "}
            · {loans.length}本
          </h2>
          <p>{presentation.summary}</p>
        </div>
        <span className={`loan-state ${presentation.done ? "ended" : presentation.step === 2 ? "reading" : ""}`}>
          {presentation.done ? "已结束" : pending.length ? "待审批" : awaitingPlace.length ? "待确认地点" : receive.length ? "待取书" : loans.some(l => l.stage === "RETURN_REQUESTED") ? "待收回" : "阅读中"}
        </span>
      </div>
      <p className="loan-date">
        申请于{" "}
        {new Date(first.requestedAt).toLocaleString("zh-CN", {
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </p>
      <div className="loan-cover-list">
        {loans.map((l) => {
          const book = books.find((b) => b.id === l.bookId) || {
            id: l.bookId,
            title: l.bookTitle,
            coverUrl: null,
          };
          return (
            <div key={l.id}>
              <SharedBookCover book={book} />
              <span>{l.bookTitle}</span>
              <small>{loanStatus[l.stage]}</small>
            </div>
          );
        })}
      </div>
      {(!presentation.done || loans.some((l) => l.stage === "RETURNED")) && (
        <ol className="loan-progress" aria-label="借阅进度">
          {["提交申请", "确认取书", "阅读中", "归还完成"].map((label, i) => (
            <li key={label} className={i < presentation.completedSteps ? "done" : i === presentation.step ? "current" : ""}>
              <span>
                {i < presentation.completedSteps ? <LibraryIcon name="check" /> : i + 1}
              </span>
              <small>{label}</small>
            </li>
          ))}
        </ol>
      )}
      <div className="loan-next">
        <strong>
          {presentation.done
            ? "本次借阅已结束"
            : pending.length
              ? first.isOwner
                ? "有新申请，等你确认"
                : "等待书主同意"
              : awaitingPlace.length
                ? first.isOwner
                  ? "请确认公共交接地点"
                  : "等待书主确认交接地点"
                : legacyHandoff.length
                  ? first.isOwner
                    ? "完成旧订单交接确认"
                    : "等待书主完成交接确认"
                  : receive.length
                    ? first.isOwner
                      ? "等待借方确认收到书"
                      : "取到书后，在这里确认"
                    : approveRenew.length && first.isOwner
                      ? "借方申请续借"
                      : first.isOwner && lent.length
                        ? "收到归还的书后，确认收回"
                        : "好故事，慢慢读"}
        </strong>
        <p>
          {presentation.done
            ? presentation.summary
            : pending.length
              ? "申请48小时内有效。"
              : presentation.nearestDueAt
                ? `最早到期：${new Date(presentation.nearestDueAt).toLocaleDateString("zh-CN")}；逐本到期日见完整清单。`
                : "借方确认收到后开始14天借期。"}
        </p>
      </div>
      {first.message && (
        <p className="detail-safety">借方留言：{first.message}</p>
      )}
      {first.isOwner && (pending.length > 0 || awaitingPlace.length > 0) && (
        <div className="place-box">
          <label>
            公共交接地点
            <input
              aria-label="公共交接地点"
              maxLength={120}
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              placeholder="例如社区图书馆门口"
            />
          </label>
          <small>仅借阅双方可见。不要填写住址。</small>
        </div>
      )}
      {!presentation.done && loans.some((l) => l.place) && (
        <p>交接地点：{loans.find((l) => l.place)!.place}</p>
      )}
      {!presentation.done && loans.find((l) => l.contactPhone) && (
        <p>
          {first.isOwner ? "借方" : "书主"}联系电话：
          {loans.find((l) => l.contactPhone)!.contactPhone}
        </p>
      )}
      {first.isOwner
        ? controls("approve", pending, "同意全部", "部分同意", true)
        : controls("cancel", pending, "取消待审批的", "逐本取消")}
      {first.isOwner && pending.length > 0 && (
        <button
          className="text-button"
          disabled={busy}
          onClick={() => void perform("decline", pending)}
        >
          全部不借 · {pending.length}本
        </button>
      )}
      {first.isOwner &&
        controls("set-place", awaitingPlace, "确认交接地点 · ", "", true)}
      {first.isOwner &&
        controls("confirm-lend", legacyHandoff, "完成旧订单交接 · ", "")}
      {!first.isOwner &&
        controls(
          "confirm-lend",
          receive,
          loans.some((l) =>
            ["LENT", "RETURN_REQUESTED", "RETURNED"].includes(l.stage),
          )
            ? "确认收到剩余"
            : "已收到全部",
          "只收到部分",
        )}
      {first.isOwner &&
        controls("confirm-return", lent, "已收回全部", "只收回部分")}
      {first.isOwner &&
        controls("approve-renew", approveRenew, "同意续借", "逐本同意续借")}
      {!first.isOwner && (renew.length > 0 || returnRequest.length > 0) && (
        <details className="loan-more">
          <summary>续借与归还</summary>
          {controls("request-renew", renew, "申请续借", "逐本续借")}
          {controls(
            "request-return",
            returnRequest,
            "已送还，提醒书主 · ",
            "只送还部分",
          )}
        </details>
      )}
      <details className="loan-more">
        <summary>查看完整清单与逐本进展 · {loans.length}本</summary>
        {loans.map((l) => (
          <div className="group-loan-row" key={l.id}>
            <strong>{l.bookTitle}</strong>
            <span>{loanStatus[l.stage]}</span>
            {l.dueAt && (
              <small>
                到期：{new Date(l.dueAt).toLocaleDateString("zh-CN")}
              </small>
            )}
            {l.renewalRequested && !l.renewed && <small>续借待处理</small>}
          </div>
        ))}
      </details>
      {first.isOwner && receive.length > 0 && (
        <details className="loan-more">
          <summary>修改公共交接地点</summary>
          <label>
            公共交接地点
            <input
              value={place}
              maxLength={120}
              onChange={(e) => setPlace(e.target.value)}
            />
          </label>
          <button
            className="secondary-button"
            disabled={busy || !place.trim()}
            onClick={() => void perform("set-place", receive)}
          >
            保存新地点
          </button>
        </details>
      )}
      {picker && (
        <Sheet
          title={picker.label}
          close={() => setPicker(null)}
          footer={
            <button
              className="primary-button"
              disabled={
                busy || !picked.length || (picker.approve && !place.trim())
              }
              onClick={async () => {
                if (
                  await perform(
                    picker.action,
                    picker.rows.filter((l) => picked.includes(l.id)),
                    picker.approve,
                  )
                )
                  setPicker(null);
              }}
            >
              {picker.approve
                ? `同意${picked.length}本，其余${picker.rows.length - picked.length}本不借`
                : `确认${picked.length}本`}
            </button>
          }
        >
          <p>
            {picker.approve
              ? "未勾选的书将解除预约；只同意勾选的分册。"
              : "仅更新勾选的图书，其余保持当前进展。"}
          </p>
          {picker.rows.map((l) => (
            <label className="pick-loan" key={l.id}>
              <input
                type="checkbox"
                checked={picked.includes(l.id)}
                onChange={(e) =>
                  setPicked((prev) =>
                    e.target.checked
                      ? [...prev, l.id]
                      : prev.filter((id) => id !== l.id),
                  )
                }
              />
              <span>
                {l.bookTitle} · {loanStatus[l.stage]}
              </span>
            </label>
          ))}
        </Sheet>
      )}
    </article>
  );
}
