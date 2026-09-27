import { useEffect, useMemo, useState } from "react";
import { api, type Book, type Family, type Loan } from "./api";

type Page = "discover" | "detail" | "publish" | "tasks" | "library" | "profile";
const statusText: Record<string, string> = {
  REQUESTED: "等待书主审批",
  APPROVED: "约定交接",
  HANDOFF_AGREED: "确认借出",
  LENT: "借阅中",
  RETURN_REQUESTED: "确认归还",
  RETURNED: "已归还",
  CANCELLED: "已取消",
  REJECTED: "已拒绝",
  EXPIRED: "已超时",
};
const active = new Set([
  "REQUESTED",
  "APPROVED",
  "HANDOFF_AGREED",
  "LENT",
  "RETURN_REQUESTED",
]);
const nav: { page: Page; label: string; icon: string }[] = [
  { page: "discover", label: "找书", icon: "⌕" },
  { page: "publish", label: "发布", icon: "+" },
  { page: "tasks", label: "消息·待办", icon: "◷" },
  { page: "library", label: "我的书屋", icon: "▥" },
];

function BookCover({ book, large = false }: { book: Book; large?: boolean }) {
  return (
    <div
      className={`book-cover ${book.tone} ${large ? "large" : ""}`}
      aria-hidden="true"
    >
      <span className="cover-kicker">糖糖共享书屋</span>
      <span className="cover-mark">✦</span>
      <strong>{book.title}</strong>
      <span className="cover-bottom">阅读，让故事继续</span>
    </div>
  );
}

function App() {
  const [page, setPage] = useState<Page>("discover");
  const [previousPage, setPreviousPage] = useState<Page>("discover");
  const [books, setBooks] = useState<Book[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [family, setFamily] = useState<Family | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [age, setAge] = useState("全部");
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [taskTab, setTaskTab] = useState<"todo" | "messages">("todo");
  const [libraryTab, setLibraryTab] = useState<"my" | "borrowed" | "lent">(
    "my",
  );
  const [loginOpen, setLoginOpen] = useState(false);
  const [requestedPage, setRequestedPage] = useState<Page | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [developmentCode, setDevelopmentCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [publishCategory, setPublishCategory] = useState("绘本");
  const [publishAge, setPublishAge] = useState("3—6 岁");
  const [condition, setCondition] = useState("九成新");
  const [summary, setSummary] = useState("");
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false);
  const [places, setPlaces] = useState<Record<string, string>>({});
  const [childNickname, setChildNickname] = useState("");
  const [childAge, setChildAge] = useState("3—6 岁");

  const selectedBook = books.find((book) => book.id === selectedId);
  const selectedLoan = loans.find(
    (loan) => loan.bookId === selectedId && active.has(loan.stage),
  );
  const activeLoans = loans.filter((loan) => active.has(loan.stage));
  const results = useMemo(
    () =>
      books.filter((book) => {
        const term = query.trim().toLowerCase();
        return (
          (!term ||
            `${book.title} ${book.author}`.toLowerCase().includes(term)) &&
          (category === "全部" || book.category === category) &&
          (age === "全部" || book.age === age) &&
          (!onlyAvailable || book.available)
        );
      }),
    [books, query, category, age, onlyAvailable],
  );

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 4000);
  }
  async function refresh() {
    const list = await api<Book[]>("/books");
    setBooks(list);
    try {
      const me = await api<Family>("/me");
      setFamily(me);
      setLoans(await api<Loan[]>("/loans"));
    } catch {
      setFamily(null);
      setLoans([]);
    }
  }
  useEffect(() => {
    void refresh().catch((error) => flash((error as Error).message));
  }, []);
  useEffect(() => {
    if (page !== "tasks" && page !== "library") return;
    const timer = window.setInterval(() => {
      void refresh().catch(() => {});
    }, 20000);
    return () => window.clearInterval(timer);
  }, [page]);
  function go(target: Page) {
    if (target !== "discover" && target !== "detail" && !family) {
      setRequestedPage(target);
      setLoginOpen(true);
      return;
    }
    setPage(target);
    window.scrollTo(0, 0);
  }
  function showBook(id: string) {
    setSelectedId(id);
    setPreviousPage(page);
    setPage("detail");
    window.scrollTo(0, 0);
  }
  async function run(work: () => Promise<unknown>, success?: string) {
    if (busy) return;
    setBusy(true);
    try {
      await work();
      await refresh();
      if (success) flash(success);
    } catch (error) {
      flash((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function sendCode() {
    await run(async () => {
      const result = await api<{ developmentCode?: string }>(
        "/auth/request-code",
        "POST",
        { phone },
      );
      setCodeSent(true);
      setDevelopmentCode(result.developmentCode ?? "");
    }, "验证码已发送");
  }
  async function login() {
    await run(async () => {
      await api("/auth/verify", "POST", { phone, code, nickname });
      setLoginOpen(false);
      setCode("");
      setCodeSent(false);
      setDevelopmentCode("");
      if (requestedPage) {
        setPage(requestedPage);
        setRequestedPage(null);
      }
    }, "已登录");
  }
  async function logout() {
    await run(async () => {
      await api("/auth/logout", "POST");
      setPage("discover");
    }, "已退出登录");
  }
  async function publish() {
    if (!privacyConfirmed) {
      flash("请先确认图书信息与隐私");
      return;
    }
    await run(async () => {
      await api("/books", "POST", {
        title,
        author,
        category: publishCategory,
        age: publishAge,
        condition,
        summary,
        privacyConfirmed,
      });
      setTitle("");
      setAuthor("");
      setSummary("");
      setPrivacyConfirmed(false);
      setPage("library");
      setLibraryTab("my");
    }, "图书已发布");
  }
  async function apply() {
    if (!selectedBook) return;
    if (!family) {
      setRequestedPage(null);
      setLoginOpen(true);
      return;
    }
    await run(async () => {
      await api(`/books/${selectedBook.id}/apply`, "POST");
      setPage("tasks");
      setTaskTab("todo");
    }, "申请已提交，等待书主审批");
  }
  async function act(
    loan: Loan,
    action: string,
    extra: Record<string, unknown> = {},
  ) {
    await run(
      () => api(`/loans/${loan.id}/action`, "POST", { action, ...extra }),
      "借阅状态已更新",
    );
  }
  async function setShelf(book: Book) {
    await run(
      () =>
        api(`/books/${book.id}/status`, "PATCH", {
          status: book.available ? "OFF_SHELF" : "AVAILABLE",
        }),
      book.available ? "图书已下架" : "图书已重新上架",
    );
  }
  async function saveProfile() {
    if (!family) return;
    await run(
      () =>
        api("/me", "PATCH", { displayName: nickname || family.displayName }),
      "书屋昵称已保存",
    );
  }
  async function addChild() {
    await run(async () => {
      await api("/me/children", "POST", {
        nickname: childNickname,
        age: childAge,
      });
      setChildNickname("");
    }, "孩子档案已保存");
  }
  async function removeChild(id: string) {
    if (!window.confirm("确定删除这份孩子档案吗？")) return;
    await run(() => api(`/me/children/${id}`, "DELETE"), "孩子档案已删除");
  }
  async function closeAccount() {
    if (
      !window.confirm(
        "确定注销家庭书屋吗？藏书将下架，孩子档案会删除，账号将退出。进行中的借阅需先完成。",
      )
    )
      return;
    await run(async () => {
      await api("/me", "DELETE");
      setPage("discover");
    }, "账号已注销");
  }

  function renderLoanCard(loan: Loan) {
    const book = books.find((item) => item.id === loan.bookId);
    if (!book) return null;
    const mineLend = loan.isOwner
      ? loan.ownerLoanConfirmed
      : loan.borrowerLoanConfirmed;
    const mineReturn = loan.isOwner
      ? loan.ownerReturnConfirmed
      : loan.borrowerReturnConfirmed;
    return (
      <article className="order-card" key={loan.id}>
        <div className="order-head">
          <BookCover book={book} />
          <div>
            <span className="status available">{statusText[loan.stage]}</span>
            <h2>{loan.bookTitle}</h2>
            <p>
              {loan.isOwner
                ? `借书家庭：${loan.borrower}`
                : `书主家庭：${loan.owner}`}
            </p>
          </div>
        </div>
        {loan.stage === "REQUESTED" && (
          <>
            <p className="order-tip">
              申请提交后 48 小时内处理；超时会自动结束。
            </p>
            <div className="action-row">
              {loan.isOwner ? (
                <>
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={() => act(loan, "approve")}
                  >
                    同意申请
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => act(loan, "decline")}
                  >
                    拒绝
                  </button>
                </>
              ) : (
                <>
                  <span>等待书主审批</span>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => act(loan, "cancel")}
                  >
                    取消申请
                  </button>
                </>
              )}
            </div>
          </>
        )}
        {["APPROVED", "HANDOFF_AGREED"].includes(loan.stage) && (
          <>
            <div className="place-box">
              <label>
                <strong>公共交接地点</strong>
                <input
                  value={places[loan.id] ?? loan.place}
                  disabled={
                    loan.ownerLoanConfirmed || loan.borrowerLoanConfirmed
                  }
                  onChange={(event) =>
                    setPlaces((current) => ({
                      ...current,
                      [loan.id]: event.target.value,
                    }))
                  }
                  placeholder="例如：社区图书馆门口"
                />
              </label>
              <small>仅借阅双方可见。请勿填写家庭住址或联系方式。</small>
            </div>
            <div className="action-row">
              <button
                className="secondary-button"
                disabled={
                  busy ||
                  loan.ownerLoanConfirmed ||
                  loan.borrowerLoanConfirmed ||
                  !(places[loan.id] ?? loan.place).trim()
                }
                onClick={() =>
                  act(loan, "set-place", {
                    place: places[loan.id] ?? loan.place,
                  })
                }
              >
                保存地点
              </button>
              <button
                className="primary-button"
                disabled={busy || mineLend || !loan.place}
                onClick={() => act(loan, "confirm-lend")}
              >
                {loan.isOwner ? "确认已借出" : "确认已收到书"}
              </button>
            </div>
            <p className="order-tip">
              借方：{loan.borrowerLoanConfirmed ? "已确认" : "待确认"}　书主：
              {loan.ownerLoanConfirmed ? "已确认" : "待确认"}。双方确认后开始 14
              天借期。
            </p>
          </>
        )}
        {["LENT", "RETURN_REQUESTED"].includes(loan.stage) && (
          <>
            <div className="place-box">
              <strong>
                应归还日期：
                {loan.dueAt
                  ? new Date(loan.dueAt).toLocaleDateString("zh-CN")
                  : "待确认"}
              </strong>
              <small>线下归还实体书后，请双方分别确认。</small>
            </div>
            <p className="order-tip">
              借方归还：{loan.borrowerReturnConfirmed ? "已确认" : "待确认"}
              　书主收回：{loan.ownerReturnConfirmed ? "已确认" : "待确认"}
            </p>
            <div className="action-row">
              <button
                className="primary-button"
                disabled={busy || mineReturn}
                onClick={() => act(loan, "confirm-return")}
              >
                {loan.isOwner ? "确认已收回" : "确认已归还"}
              </button>
              {!loan.isOwner &&
                !loan.renewed &&
                !loan.renewalRequested &&
                loan.stage === "LENT" && (
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => act(loan, "request-renew")}
                  >
                    申请续借
                  </button>
                )}
              {loan.isOwner && loan.renewalRequested && !loan.renewed && (
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => act(loan, "approve-renew")}
                >
                  同意续借 14 天
                </button>
              )}
              {loan.renewalRequested && !loan.renewed && !loan.isOwner && (
                <span>续借申请待书主处理</span>
              )}
            </div>
          </>
        )}
      </article>
    );
  }

  return (
    <div className="site-shell">
      <div className="demo-strip">
        <span className="demo-dot" />
        共享书屋测试版 · 由家长操作，线下公共地点交接
      </div>
      <header className="site-header">
        <div className="header-inner">
          <button className="brand" onClick={() => go("discover")}>
            <img src="/brand.png" alt="" />
            <span>
              <strong>糖糖的共享书屋</strong>
              <small>让读过的童书，遇见下一个小读者</small>
            </span>
          </button>
          <nav className="desktop-nav" aria-label="主导航">
            {nav.map((item) => (
              <button
                key={item.page}
                className={page === item.page ? "active" : ""}
                onClick={() => go(item.page)}
              >
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>
          <button
            className="role-button"
            onClick={() => (family ? go("profile") : setLoginOpen(true))}
          >
            <span className="avatar">
              {family ? family.displayName[0] : "访"}
            </span>
            <span>{family ? family.displayName : "家长登录"}</span>
            <span aria-hidden="true">›</span>
          </button>
        </div>
      </header>
      <main className="main-content">
        {page === "discover" && (
          <>
            <section className="discover-top">
              <div>
                <p className="eyebrow">分享闲置童书 · 免费借阅</p>
                <h1>今天，想读什么故事？</h1>
                <p className="lead">
                  看看其他家庭愿意分享的好书。由家长申请，线下在公共地点交接。
                </p>
              </div>
              <img src="/brand.png" alt="两个孩子在共享书屋前传递一本书" />
            </section>
            <section className="search-panel" aria-label="找书筛选">
              <div className="search-field">
                <span aria-hidden="true">⌕</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索书名或作者"
                  aria-label="搜索书名或作者"
                />
                {query && (
                  <button onClick={() => setQuery("")} aria-label="清除搜索">
                    ×
                  </button>
                )}
              </div>
              <div className="filter-row">
                <span>筛选</span>
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  aria-label="图书分类"
                >
                  <option>全部</option>
                  <option>绘本</option>
                  <option>故事</option>
                  <option>科普</option>
                  <option>其他</option>
                </select>
                <select
                  value={age}
                  onChange={(event) => setAge(event.target.value)}
                  aria-label="适读年龄"
                >
                  <option>全部</option>
                  <option>3—6 岁</option>
                  <option>6—9 岁</option>
                  <option>9—12 岁</option>
                </select>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={onlyAvailable}
                    onChange={(event) => setOnlyAvailable(event.target.checked)}
                  />
                  只看可借
                </label>
              </div>
            </section>
            <div className="section-heading">
              <div>
                <p className="eyebrow">在书屋里发现</p>
                <h2>找到 {results.length} 本书</h2>
              </div>
              <span>点击书卡查看详情</span>
            </div>
            {results.length ? (
              <div className="book-grid">
                {results.map((book) => (
                  <button
                    className="book-card"
                    key={book.id}
                    onClick={() => showBook(book.id)}
                  >
                    <BookCover book={book} />
                    <div className="book-card-text">
                      <span
                        className={`status ${book.available ? "available" : "unavailable"}`}
                      >
                        {book.available
                          ? "可借"
                          : book.offShelf
                            ? "已下架"
                            : "借出中"}
                      </span>
                      <h3>{book.title}</h3>
                      <p>
                        {book.category} · {book.age}
                      </p>
                      <div className="book-owner">
                        来自 {book.owner}
                        <span>›</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <h3>暂时没有找到图书</h3>
                <p>试试换个书名或筛选条件。</p>
                <button
                  className="secondary-button"
                  onClick={() => {
                    setQuery("");
                    setCategory("全部");
                    setAge("全部");
                    setOnlyAvailable(false);
                  }}
                >
                  清除筛选
                </button>
              </div>
            )}
            <div className="privacy-note">
              <span>
                公开页面只显示书屋昵称；孩子资料、手机号与交接地点不会公开。
              </span>
            </div>
          </>
        )}
        {page === "detail" && selectedBook && (
          <>
            <button className="back-link" onClick={() => go(previousPage)}>
              ‹ 返回{previousPage === "library" ? "我的书屋" : "找书"}
            </button>
            <div className="detail-layout">
              <BookCover book={selectedBook} large />
              <div className="detail-info">
                <span
                  className={`status ${selectedBook.available ? "available" : "unavailable"}`}
                >
                  {selectedBook.available ? "可借" : "暂不可借"}
                </span>
                <h1>{selectedBook.title}</h1>
                <p className="detail-author">
                  {selectedBook.author} · 来自 {selectedBook.owner}
                </p>
                <div className="detail-tags">
                  <span>{selectedBook.category}</span>
                  <span>{selectedBook.age}</span>
                  <span>{selectedBook.condition}</span>
                </div>
                <section className="detail-summary">
                  <h2>关于这本书</h2>
                  <p>{selectedBook.summary || "书主暂未填写简介。"}</p>
                </section>
                <div className="detail-safety">
                  公共交接地点只向借阅双方展示。双方确认借出后，借期为 14 天。
                </div>
                {selectedBook.mine ? (
                  <button
                    className="primary-button"
                    onClick={() => go("library")}
                  >
                    查看我的藏书
                  </button>
                ) : selectedLoan ? (
                  <button
                    className="primary-button"
                    onClick={() => go("tasks")}
                  >
                    查看这笔借阅
                  </button>
                ) : (
                  <button
                    className="primary-button"
                    disabled={!selectedBook.available || busy}
                    onClick={apply}
                  >
                    {selectedBook.available ? "申请免费借阅" : "暂不可借"}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
        {page === "publish" && (
          <>
            <div className="page-title">
              <p className="eyebrow">把好故事分享出去</p>
              <h1>发布一本童书</h1>
              <p>请家长核对信息后发布。拍照识书功能正在准备中。</p>
            </div>
            <div className="publish-layout">
              <div className="publish-form">
                <div className="form-section-head">
                  <span className="step-number">1</span>
                  <div>
                    <h2>图书信息</h2>
                    <p>所有信息都由家长确认后才展示。</p>
                  </div>
                </div>
                <div className="field-grid">
                  <label>
                    书名 <b>*</b>
                    <input
                      value={title}
                      maxLength={100}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </label>
                  <label>
                    作者
                    <input
                      value={author}
                      maxLength={100}
                      onChange={(event) => setAuthor(event.target.value)}
                      placeholder="不确定可留空"
                    />
                  </label>
                  <label>
                    分类
                    <select
                      value={publishCategory}
                      onChange={(event) =>
                        setPublishCategory(event.target.value)
                      }
                    >
                      <option>绘本</option>
                      <option>故事</option>
                      <option>科普</option>
                      <option>其他</option>
                    </select>
                  </label>
                  <label>
                    适读年龄
                    <select
                      value={publishAge}
                      onChange={(event) => setPublishAge(event.target.value)}
                    >
                      <option>3—6 岁</option>
                      <option>6—9 岁</option>
                      <option>9—12 岁</option>
                    </select>
                  </label>
                  <label>
                    新旧程度
                    <select
                      value={condition}
                      onChange={(event) => setCondition(event.target.value)}
                    >
                      <option>九成新</option>
                      <option>八成新</option>
                      <option>七成新</option>
                      <option>有明显使用痕迹</option>
                    </select>
                  </label>
                  <label className="full-field">
                    简单介绍
                    <textarea
                      value={summary}
                      maxLength={1000}
                      onChange={(event) => setSummary(event.target.value)}
                      rows={4}
                    />
                  </label>
                </div>
                <label className="confirm-check">
                  <input
                    type="checkbox"
                    checked={privacyConfirmed}
                    onChange={(event) =>
                      setPrivacyConfirmed(event.target.checked)
                    }
                  />
                  我已核对图书信息，内容不含孩子姓名、电话或住址
                </label>
                <button
                  className="primary-button"
                  disabled={busy || !title.trim()}
                  onClick={publish}
                >
                  确认发布
                </button>
              </div>
              <aside className="publish-aside">
                <div className="aside-cover">
                  <strong>
                    一本闲置书
                    <br />
                    下一段新旅程
                  </strong>
                </div>
                <h3>发布后会怎样？</h3>
                <ol>
                  <li>其他家庭可在找书页看到这本书</li>
                  <li>申请后由你在待办中审批</li>
                  <li>双方在订单里确认交接与归还</li>
                </ol>
              </aside>
            </div>
          </>
        )}
        {page === "tasks" && (
          <>
            <div className="page-title">
              <p className="eyebrow">每一步都有回应</p>
              <h1>消息与待办</h1>
              <p>借阅双方可查看进展并分别确认交接。</p>
            </div>
            <div className="tabs">
              <button
                className={taskTab === "todo" ? "selected" : ""}
                onClick={() => setTaskTab("todo")}
              >
                待办 {activeLoans.length > 0 && <em>{activeLoans.length}</em>}
              </button>
              <button
                className={taskTab === "messages" ? "selected" : ""}
                onClick={() => setTaskTab("messages")}
              >
                借阅动态
              </button>
            </div>
            {taskTab === "todo" ? (
              activeLoans.length ? (
                <div className="orders-list">
                  {activeLoans.map(renderLoanCard)}
                </div>
              ) : (
                <div className="empty-state">
                  <h3>目前没有进行中的借阅</h3>
                  <p>从找书页申请一本书，进展会显示在这里。</p>
                  <button
                    className="secondary-button"
                    onClick={() => go("discover")}
                  >
                    去找书
                  </button>
                </div>
              )
            ) : (
              <div className="messages-list">
                {loans.length ? (
                  loans.map((loan) => (
                    <article key={loan.id}>
                      <span className="message-icon">▥</span>
                      <div>
                        <h3>
                          {loan.bookTitle} · {statusText[loan.stage]}
                        </h3>
                        <p>
                          {loan.isOwner
                            ? `借书家庭：${loan.borrower}`
                            : `书主家庭：${loan.owner}`}
                        </p>
                        <small>
                          申请于{" "}
                          {new Date(loan.requestedAt).toLocaleString("zh-CN")}
                        </small>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">
                    <h3>暂无借阅动态</h3>
                  </div>
                )}
              </div>
            )}
          </>
        )}
        {page === "library" && (
          <>
            <div className="page-title">
              <p className="eyebrow">一家一座小书屋</p>
              <h1>我的书屋</h1>
              <p>管理分享的书和借阅记录。</p>
            </div>
            <section className="family-card">
              <div className="family-avatar">{family?.displayName[0]}</div>
              <div>
                <span>家庭书屋</span>
                <h2>{family?.displayName}</h2>
                <p>孩子档案不会在公开页面展示。</p>
              </div>
              <button
                className="secondary-button"
                onClick={() => go("profile")}
              >
                家庭资料
              </button>
            </section>
            <div className="tabs">
              <button
                className={libraryTab === "my" ? "selected" : ""}
                onClick={() => setLibraryTab("my")}
              >
                我的藏书
              </button>
              <button
                className={libraryTab === "borrowed" ? "selected" : ""}
                onClick={() => setLibraryTab("borrowed")}
              >
                借入
              </button>
              <button
                className={libraryTab === "lent" ? "selected" : ""}
                onClick={() => setLibraryTab("lent")}
              >
                借出
              </button>
            </div>
            {libraryTab === "my" ? (
              <>
                <div className="library-heading">
                  <h2>{books.filter((book) => book.mine).length} 本书</h2>
                  <button className="text-button" onClick={() => go("publish")}>
                    ＋ 发布新书
                  </button>
                </div>
                <div className="mini-book-list">
                  {books
                    .filter((book) => book.mine)
                    .map((book) => (
                      <button key={book.id} onClick={() => showBook(book.id)}>
                        <BookCover book={book} />
                        <span>
                          <strong>{book.title}</strong>
                          <small>
                            {book.category} · {book.age}
                          </small>
                        </span>
                        <span className="status available">
                          {book.available
                            ? "可借"
                            : book.offShelf
                              ? "已下架"
                              : "借出中"}
                        </span>
                      </button>
                    ))}
                </div>
                <div className="shelf-actions">
                  {books
                    .filter((book) => book.mine)
                    .map((book) => (
                      <button
                        className="secondary-button"
                        key={book.id}
                        disabled={
                          busy ||
                          (!book.available &&
                            loans.some(
                              (loan) =>
                                loan.bookId === book.id &&
                                active.has(loan.stage),
                            ))
                        }
                        onClick={() => setShelf(book)}
                      >
                        {book.title} · {book.available ? "下架" : "重新上架"}
                      </button>
                    ))}
                </div>
              </>
            ) : (
              <div className="record-list">
                {loans
                  .filter((loan) =>
                    libraryTab === "lent" ? loan.isOwner : !loan.isOwner,
                  )
                  .map((loan) => (
                    <button
                      key={loan.id}
                      onClick={() => {
                        setTaskTab("messages");
                        go("tasks");
                      }}
                    >
                      <span>
                        <strong>{loan.bookTitle}</strong>
                        <small>{statusText[loan.stage]}</small>
                      </span>
                      <span>›</span>
                    </button>
                  ))}
              </div>
            )}
          </>
        )}
        {page === "profile" && family && (
          <>
            <div className="page-title">
              <p className="eyebrow">家庭资料</p>
              <h1>我的家庭书屋</h1>
              <p>孩子信息只供家庭家长查看和管理。</p>
            </div>
            <div className="publish-form profile-panel">
              <div className="field-grid">
                <label>
                  书屋昵称
                  <input
                    value={nickname}
                    onChange={(event) => setNickname(event.target.value)}
                    placeholder={family.displayName}
                    maxLength={30}
                  />
                </label>
              </div>
              <div className="action-row">
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={saveProfile}
                >
                  保存昵称
                </button>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={logout}
                >
                  退出登录
                </button>
              </div>
              <h2>孩子档案</h2>
              {family.children.map((child) => (
                <div className="child-row" key={child.id}>
                  <span>
                    {child.nickname} · {child.age}
                  </span>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => removeChild(child.id)}
                  >
                    删除
                  </button>
                </div>
              ))}
              <div className="field-grid">
                <label>
                  孩子昵称
                  <input
                    value={childNickname}
                    maxLength={30}
                    onChange={(event) => setChildNickname(event.target.value)}
                  />
                </label>
                <label>
                  年龄段
                  <select
                    value={childAge}
                    onChange={(event) => setChildAge(event.target.value)}
                  >
                    <option>3—6 岁</option>
                    <option>6—9 岁</option>
                    <option>9—12 岁</option>
                  </select>
                </label>
              </div>
              <button
                className="secondary-button"
                disabled={busy || !childNickname.trim()}
                onClick={addChild}
              >
                添加孩子档案
              </button>
              <div className="account-actions">
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={closeAccount}
                >
                  注销家庭书屋
                </button>
                <p>
                  注销后书会下架，孩子档案和登录信息会删除；已完成的借阅记录保留匿名信息。
                </p>
              </div>
            </div>
          </>
        )}
      </main>
      <nav className="mobile-nav" aria-label="底部导航">
        {nav.map((item) => (
          <button
            key={item.page}
            className={page === item.page ? "active" : ""}
            onClick={() => go(item.page)}
          >
            <span aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
            {item.page === "tasks" && activeLoans.length > 0 && <i />}
          </button>
        ))}
      </nav>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {loginOpen && (
        <div className="modal-backdrop">
          <div
            className="login-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="login-title"
          >
            <button
              className="modal-close"
              aria-label="关闭"
              onClick={() => setLoginOpen(false)}
            >
              ×
            </button>
            <p className="eyebrow">家长登录</p>
            <h2 id="login-title">欢迎来到共享书屋</h2>
            <p>用手机号验证码登录；首次登录会创建家庭书屋。</p>
            <div className="login-fields">
              <label>
                手机号
                <input
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  maxLength={11}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="请输入手机号"
                />
              </label>
              <button
                className="secondary-button"
                disabled={busy || !/^1[3-9]\d{9}$/.test(phone)}
                onClick={sendCode}
              >
                {codeSent ? "重新获取验证码" : "获取验证码"}
              </button>
              {codeSent && (
                <>
                  <label>
                    验证码
                    <input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={code}
                      maxLength={6}
                      onChange={(event) => setCode(event.target.value)}
                    />
                  </label>
                  {developmentCode && (
                    <p className="dev-code">
                      本地开发验证码：{developmentCode}
                    </p>
                  )}
                  <label>
                    书屋昵称（首次登录填写）
                    <input
                      value={nickname}
                      maxLength={30}
                      onChange={(event) => setNickname(event.target.value)}
                      placeholder="例如：糖糖书屋"
                    />
                  </label>
                  <button
                    className="primary-button"
                    disabled={busy || code.length !== 6}
                    onClick={login}
                  >
                    登录 / 创建书屋
                  </button>
                </>
              )}
            </div>
            <p className="dialog-foot">
              手机号仅用于登录验证，不会公开给其他家庭。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
