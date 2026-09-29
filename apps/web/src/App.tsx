import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Book, type Family, type Loan, type OptionLists } from "./api";
import { CoverCropDialog } from "./CoverCropDialog";

type Page = "discover" | "detail" | "publish" | "tasks" | "library" | "profile";
const statusText: Record<string, string> = {
  REQUESTED: "等待书主同意",
  APPROVED: "待确认交接地点",
  HANDOFF_AGREED: "待取书",
  LENT: "借阅中",
  RETURN_REQUESTED: "待书主确认归还",
  RETURNED: "已归还",
  CANCELLED: "已取消",
  REJECTED: "已拒绝",
  EXPIRED: "已超时",
};
function currentOptionsFallback(current: string, rows: OptionLists["categories"], fallback: string) {
  return rows.some(option => option.id === current && option.active) ? current : (rows.find(option => option.active)?.id ?? fallback);
}
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

function needsAttention(loan: Loan) {
  if (loan.stage === "REQUESTED" || loan.stage === "APPROVED") return loan.isOwner;
  if (loan.stage === "HANDOFF_AGREED") {
    return loan.isOwner
      ? loan.borrowerLoanConfirmed && !loan.ownerLoanConfirmed
      : !loan.borrowerLoanConfirmed;
  }
  if (loan.stage === "RETURN_REQUESTED") return loan.isOwner;
  return loan.stage === "LENT" && loan.isOwner && loan.renewalRequested && !loan.renewed;
}

function loanStep(stage: string) {
  if (stage === "REQUESTED") return 0;
  if (stage === "APPROVED" || stage === "HANDOFF_AGREED") return 1;
  if (stage === "LENT") return 2;
  return 3;
}

function dateLabel(value: string) {
  return new Date(value).toLocaleDateString("zh-CN");
}

function BookCover({ book, large = false }: { book: Book; large?: boolean }) {
  if (book.coverUrl) return <img className={`book-cover-image ${large ? "large" : ""}`} src={book.coverUrl} alt={`${book.title}封面`} />;
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
  const [options, setOptions] = useState<OptionLists>({ categories: [], ages: [], conditions: [] });
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [age, setAge] = useState("全部");
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [taskTab, setTaskTab] = useState<"todo" | "progress" | "messages">("todo");
  const [libraryTab, setLibraryTab] = useState<"my" | "borrowed" | "lent">(
    "my",
  );
  const [loginOpen, setLoginOpen] = useState(false);
  const [requestedPage, setRequestedPage] = useState<Page | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register" | "reset">("login");
  const [account, setAccount] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [registrationPhone, setRegistrationPhone] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [developmentCode, setDevelopmentCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [publishCategory, setPublishCategory] = useState("category-picture");
  const [publishAge, setPublishAge] = useState("age-3-6");
  const [condition, setCondition] = useState("condition-like-new");
  const [summary, setSummary] = useState("");
  const [nonChildren, setNonChildren] = useState(false);
  const [coverImage, setCoverImage] = useState("");
  const [coverChanged, setCoverChanged] = useState(false);
  const [coverBytes, setCoverBytes] = useState(0);
  const [pendingCover, setPendingCover] = useState<File | null>(null);
  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const [assistBusy, setAssistBusy] = useState<"recognize" | "summarize" | null>(null);
  const [assistNotice, setAssistNotice] = useState("");
  const [summarySources, setSummarySources] = useState<{ title: string; url: string }[]>([]);
  const coverInput = useRef<HTMLInputElement>(null);
  const assistRequest = useRef(0);
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false);
  const [places, setPlaces] = useState<Record<string, string>>({});
  const [childNickname, setChildNickname] = useState("");
  const [childAge, setChildAge] = useState("age-3-6");

  const selectedBook = books.find((book) => book.id === selectedId);
  const selectedLoan = loans.find(
    (loan) => loan.bookId === selectedId && active.has(loan.stage),
  );
  const activeLoans = loans.filter((loan) => active.has(loan.stage));
  const todoLoans = activeLoans.filter(needsAttention);
  const pendingCount = todoLoans.length;
  const pendingBadge = pendingCount > 99 ? "99+" : pendingCount;
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const phoneValid = /^(?:1[3-9]\d{9}|\+[1-9]\d{7,14})$/.test(registrationPhone.replace(/[\s()-]/g, ""));
  const authReady = authMode === "login"
    ? Boolean(account.trim() && password)
    : emailValid && code.length === 6 && password.length >= 10 && password === confirmPassword && (authMode === "reset" || (/^[a-zA-Z0-9_]{4,24}$/.test(account) && phoneValid));
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
    const [list, currentOptions] = await Promise.all([api<Book[]>("/books"), api<OptionLists>("/options")]);
    setBooks(list);
    setOptions(currentOptions);
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
    if (!family) return;
    const timer = window.setInterval(() => {
      void refresh().catch(() => {});
    }, 20000);
    return () => window.clearInterval(timer);
  }, [family?.id]);
  function go(target: Page) {
    if (target !== "discover" && target !== "detail" && !family) {
      setRequestedPage(target);
      switchAuthMode("login");
      setLoginOpen(true);
      return;
    }
    if (target === "publish") {
      assistRequest.current++;
      setAssistBusy(null);
      setEditingBookId(null);
      setTitle(""); setAuthor(""); setSummary(""); setNonChildren(false); setCoverImage(""); setCoverChanged(false); setCoverBytes(0);
      setPublishCategory(current => currentOptionsFallback(current, options.categories, "category-picture"));
      setPublishAge(current => currentOptionsFallback(current, options.ages, "age-3-6"));
      setCondition(current => currentOptionsFallback(current, options.conditions, "condition-like-new"));
      setPrivacyConfirmed(false); setAssistNotice(""); setSummarySources([]);
    }
    if (target === "profile" && family) { setProfilePhone(family.phone); setNickname(family.displayName); }
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
  function switchAuthMode(mode: "login" | "register" | "reset") {
    setAuthMode(mode);
    setCode("");
    setCodeSent(false);
    setDevelopmentCode("");
    setPassword("");
    setConfirmPassword("");
  }
  async function sendCode() {
    await run(async () => {
      const result = await api<{ developmentCode?: string }>(
        "/auth/email-code",
        "POST",
        { email, purpose: authMode === "register" ? "register" : "reset" },
      );
      setCodeSent(true);
      setDevelopmentCode(result.developmentCode ?? "");
    }, "验证邮件已发送");
  }
  async function submitAuth() {
    if (authMode !== "login" && password !== confirmPassword) {
      flash("两次输入的密码不一致");
      return;
    }
    await run(async () => {
      if (authMode === "reset") {
        await api("/auth/password-reset", "POST", { email, code, password });
        switchAuthMode("login");
        return;
      }
      if (authMode === "register") await api("/auth/register", "POST", { username: account, email, phone: registrationPhone, password, code, nickname: nickname || account });
      else await api("/auth/login", "POST", { account, password });
      setLoginOpen(false);
      setPassword("");
      setConfirmPassword("");
      setCode("");
      setCodeSent(false);
      setDevelopmentCode("");
      if (requestedPage) {
        setPage(requestedPage);
        setRequestedPage(null);
      }
    }, authMode === "reset" ? "密码已重置，请登录" : authMode === "register" ? "注册成功" : "已登录");
  }
  async function logout() {
    await run(async () => {
      await api("/auth/logout", "POST");
      setNickname("");
      setPage("discover");
    }, "已退出登录");
  }
  async function publish() {
    if (!privacyConfirmed) {
      flash("请先确认图书信息与隐私");
      return;
    }
    await run(async () => {
      await api(editingBookId ? `/books/${editingBookId}` : "/books", editingBookId ? "PATCH" : "POST", {
        title,
        author,
        categoryOptionId: publishCategory,
        ageOptionId: publishAge,
        conditionOptionId: condition,
        summary,
        nonChildren,
        coverImage: coverChanged ? coverImage : undefined,
        privacyConfirmed,
      });
      setTitle("");
      setAuthor("");
      setSummary("");
      setNonChildren(false);
      setCoverImage("");
      setCoverChanged(false);
      setCoverBytes(0);
      setEditingBookId(null);
      setAssistNotice("");
      setSummarySources([]);
      setPrivacyConfirmed(false);
      setPage("library");
      setLibraryTab("my");
    }, editingBookId ? "图书信息已更新" : "图书已发布");
  }

  function chooseCover(file?: File) {
    if (!file) return;
    setPendingCover(file);
  }

  function startEdit(book: Book) {
    if (!book.editable) { flash("借阅申请或借出期间不能编辑图书"); return; }
    assistRequest.current++;
    setAssistBusy(null);
    setEditingBookId(book.id);
    setTitle(book.title); setAuthor(book.author); setSummary(book.summary); setNonChildren(book.nonChildren);
    setPublishCategory(book.categoryOptionId || "category-other");
    setPublishAge(book.ageOptionId || "age-3-6");
    setCondition(book.conditionOptionId);
    setCoverImage(book.coverUrl || ""); setCoverChanged(false); setCoverBytes(0);
    setAssistNotice(""); setSummarySources([]); setPrivacyConfirmed(true);
    setPage("publish"); window.scrollTo(0, 0);
  }

  async function recognize(image = coverImage) {
    if (!image) return;
    const requestId = ++assistRequest.current;
    setAssistBusy("recognize");
    setAssistNotice("正在识别封面并检索图书资料，简介会自动填写…");
    try {
      const result = await api<{ title: string; author: string; category: string; summary: string; nonChildren?: boolean; sources: { title: string; url: string }[]; notice?: string }>("/books/recognize", "POST", { coverImage: image });
      if (requestId !== assistRequest.current) return;
      if (result.title) setTitle(result.title);
      if (result.author) setAuthor(result.author);
      const found = options.categories.find(option => option.label === result.category);
      if (found) setPublishCategory(found.id);
      if (result.summary) setSummary(result.summary);
      if (typeof result.nonChildren === "boolean") setNonChildren(result.nonChildren);
      setSummarySources(result.sources);
      setAssistNotice(result.notice || "已自动识别封面并检索资料，请核对图书信息与简介。");
    } catch (error) { if (requestId === assistRequest.current) { setAssistNotice("自动识别暂未完成，可手动填写，或点击按钮重试。"); flash((error as Error).message); } }
    finally { if (requestId === assistRequest.current) setAssistBusy(null); }
  }

  async function generateSummary() {
    if (!title.trim() || assistBusy) return;
    const requestId = ++assistRequest.current;
    setAssistBusy("summarize");
    try {
      const result = await api<{ summary: string; nonChildren: boolean; sources: { title: string; url: string }[] }>("/books/summarize", "POST", { title, author });
      if (requestId !== assistRequest.current) return;
      setSummary(result.summary);
      setNonChildren(result.nonChildren);
      setSummarySources(result.sources);
      setAssistNotice("MiniMax 已检索图书资料，请核对简介内容。");
    } catch (error) { if (requestId === assistRequest.current) flash((error as Error).message); }
    finally { if (requestId === assistRequest.current) setAssistBusy(null); }
  }
  async function apply() {
    if (!selectedBook) return;
    if (!family) {
      setRequestedPage(null);
      switchAuthMode("login");
      setLoginOpen(true);
      return;
    }
    await run(async () => {
      await api(`/books/${selectedBook.id}/apply`, "POST");
      setPage("tasks");
      setTaskTab("progress");
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
        api("/me", "PATCH", { displayName: nickname || family.displayName, ...(profilePhone.trim() ? { phone: profilePhone.trim() } : {}) }),
      "家庭资料已保存",
    );
  }
  async function addChild() {
    await run(async () => {
      await api("/me/children", "POST", {
        nickname: childNickname,
        ageOptionId: childAge,
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
    const previousPlace = loans.find((item) => item.id !== loan.id && item.isOwner && item.place)?.place ?? "";
    const place = places[loan.id] ?? (loan.place || previousPlace);
    const step = loanStep(loan.stage);
    const remainingDays = loan.dueAt
      ? Math.ceil((new Date(loan.dueAt).getTime() - Date.now()) / 86_400_000)
      : null;
    const statusLabel = loan.isOwner && loan.stage === "REQUESTED"
      ? "待你同意"
      : loan.isOwner && loan.stage === "RETURN_REQUESTED"
        ? "待你确认收回"
        : statusText[loan.stage];
    let nextStep = "";
    if (loan.stage === "REQUESTED") nextStep = loan.isOwner ? "请确认公共交接地点并同意借出" : "等待书主处理申请";
    else if (loan.stage === "APPROVED") nextStep = loan.isOwner ? "请确认公共交接地点" : "等待书主确认交接地点";
    else if (loan.stage === "HANDOFF_AGREED") nextStep = loan.isOwner
      ? loan.borrowerLoanConfirmed ? "请完成这笔旧订单的交接确认" : "等待借书家庭取书并确认"
      : loan.borrowerLoanConfirmed ? "等待书主完成这笔旧订单的交接确认" : "拿到实体书后，请确认收书";
    else if (loan.stage === "RETURN_REQUESTED") nextStep = loan.isOwner
      ? loan.ownerReturnConfirmed ? "请完成这笔旧订单的归还记录" : "收到实体书后，请确认收回"
      : "等待书主确认收回实体书";
    else nextStep = loan.isOwner
      ? loan.renewalRequested && !loan.renewed ? "借书家庭申请续借，请处理" : "借阅中；收到实体书后确认收回"
      : "请在到期前将书交还书主";
    return (
      <article className="order-card" key={loan.id}>
        <div className="order-head">
          <BookCover book={book} />
          <div>
            <span className="status available">{statusLabel}</span>
            <h2>{loan.bookTitle}</h2>
            <p>
              {loan.isOwner
                ? `借书家庭：${loan.borrower}`
                : `书主家庭：${loan.owner}`}
            </p>
          </div>
        </div>
        <ol className="loan-steps" aria-label="借阅进度">
          {["申请", "取书", "阅读", "归还"].map((label, index) => (
            <li key={label} className={index < step ? "done" : index === step ? "current" : ""}>
              <span aria-hidden="true">{index < step ? "✓" : index + 1}</span>
              <strong>{label}</strong>
            </li>
          ))}
        </ol>
        <div className={`next-step ${needsAttention(loan) ? "needs-attention" : ""}`}>
          <small>{needsAttention(loan) ? "轮到你操作" : "当前进展"}</small>
          <strong>{nextStep}</strong>
        </div>
        {loan.contactPhone !== null && <div className="loan-contact"><strong>{loan.isOwner ? "借书家庭电话" : "书主家庭电话"}</strong><span>{loan.contactPhone || "暂未提供"}</span><small>仅供本次借阅交接与订单异常联系</small></div>}
        {loan.stage === "REQUESTED" && (
          <>
            <p className="order-tip">
              申请提交后 48 小时内处理；超时会自动结束。
            </p>
            {loan.isOwner && (
              <div className="place-box">
                <label>
                  <strong>公共交接地点</strong>
                  <input
                    value={place}
                    maxLength={120}
                    onChange={(event) => setPlaces((current) => ({ ...current, [loan.id]: event.target.value }))}
                    placeholder="例如：社区图书馆门口"
                  />
                </label>
                <small>仅借阅双方可见。请勿填写家庭住址或联系方式。</small>
              </div>
            )}
            <div className="action-row">
              {loan.isOwner ? (
                <>
                  <button className="primary-button" disabled={busy || !place.trim()} onClick={() => act(loan, "approve", { place })}>确认地点并同意借出</button>
                  <button className="secondary-button" disabled={busy} onClick={() => act(loan, "decline")}>拒绝申请</button>
                </>
              ) : (
                <button className="secondary-button" disabled={busy} onClick={() => act(loan, "cancel")}>取消申请</button>
              )}
            </div>
          </>
        )}
        {loan.stage === "APPROVED" && (
          <>
            <div className="place-box">
              <label>
                <strong>公共交接地点</strong>
                <input
                  value={place}
                  maxLength={120}
                  disabled={!loan.isOwner}
                  onChange={(event) => setPlaces((current) => ({ ...current, [loan.id]: event.target.value }))}
                  placeholder="例如：社区图书馆门口"
                />
              </label>
              <small>仅借阅双方可见。请勿填写家庭住址或联系方式。</small>
            </div>
            {loan.isOwner && <div className="action-row"><button className="primary-button" disabled={busy || !place.trim()} onClick={() => act(loan, "set-place", { place })}>确认交接地点</button></div>}
          </>
        )}
        {loan.stage === "HANDOFF_AGREED" && (
          <>
            <div className="place-box">
              <strong>交接地点：{loan.place}</strong>
              <small>借书家庭收到实体书并确认后，开始 14 天借期。</small>
            </div>
            <div className="action-row">
              {!loan.isOwner && !loan.borrowerLoanConfirmed && <button className="primary-button" disabled={busy} onClick={() => act(loan, "confirm-lend")}>已拿到书</button>}
              {loan.isOwner && loan.borrowerLoanConfirmed && !loan.ownerLoanConfirmed && <button className="primary-button" disabled={busy} onClick={() => act(loan, "confirm-lend")}>完成旧订单交接</button>}
            </div>
            {loan.isOwner && !loan.ownerLoanConfirmed && !loan.borrowerLoanConfirmed && (
              <details className="loan-more">
                <summary>修改交接地点</summary>
                <div className="place-box"><label><strong>新的公共交接地点</strong><input value={place} maxLength={120} onChange={(event) => setPlaces((current) => ({ ...current, [loan.id]: event.target.value }))} /></label></div>
                <button className="secondary-button" disabled={busy || !place.trim() || place.trim() === loan.place} onClick={() => act(loan, "set-place", { place })}>保存新地点</button>
              </details>
            )}
          </>
        )}
        {["LENT", "RETURN_REQUESTED"].includes(loan.stage) && (
          <>
            <div className="place-box">
              <strong>应归还日期：{loan.dueAt ? dateLabel(loan.dueAt) : "待确认"}</strong>
              {remainingDays !== null && <small>{remainingDays > 0 ? `还剩 ${remainingDays} 天` : remainingDays === 0 ? "今天到期" : `已逾期 ${-remainingDays} 天`}</small>}
              <small>线下把实体书交还书主；书主收到后确认。</small>
            </div>
            {loan.renewalRequested && !loan.renewed && <p className="order-tip">{loan.isOwner ? "借书家庭申请续借 14 天。" : "续借申请待书主处理。"}</p>}
            <div className="action-row">
              {loan.isOwner && <button className="primary-button" disabled={busy} onClick={() => act(loan, "confirm-return")}>{loan.ownerReturnConfirmed ? "完成旧订单归还" : "已收回书"}</button>}
              {loan.isOwner && loan.stage === "LENT" && loan.renewalRequested && !loan.renewed && <button className="secondary-button" disabled={busy} onClick={() => act(loan, "approve-renew")}>同意续借 14 天</button>}
            </div>
            {!loan.isOwner && loan.stage === "LENT" && (
              <details className="loan-more">
                <summary>归还与续借</summary>
                <div className="action-row">
                  <button className="secondary-button" disabled={busy} onClick={() => act(loan, "request-return")}>已送还，提醒书主</button>
                  {!loan.renewed && !loan.renewalRequested && <button className="secondary-button" disabled={busy} onClick={() => act(loan, "request-renew")}>申请续借</button>}
                </div>
              </details>
            )}
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
                aria-label={item.page === "tasks" && pendingCount > 0 ? `${item.label}，${pendingCount} 条待办` : undefined}
              >
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
                {item.page === "tasks" && pendingCount > 0 && (
                  <span className="nav-badge" aria-hidden="true">{pendingBadge}</span>
                )}
              </button>
            ))}
          </nav>
          <button
            className="role-button"
            onClick={() => {
              if (family) go("profile");
              else { switchAuthMode("login"); setLoginOpen(true); }
            }}
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
                  {options.categories.map(option => <option key={option.id}>{option.label}</option>)}
                </select>
                <select
                  value={age}
                  onChange={(event) => setAge(event.target.value)}
                  aria-label="适读年龄"
                >
                  <option>全部</option>
                  {options.ages.map(option => <option key={option.id}>{option.label}</option>)}
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
                      {book.nonChildren && <span className="non-child-badge">非儿童读物</span>}
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
                公开页面只显示书屋昵称；孩子资料、邮箱与交接地点不会公开。
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
                  {selectedBook.nonChildren && <span className="non-child-badge">非儿童读物</span>}
                </div>
                <section className="detail-summary">
                  <h2>关于这本书</h2>
                  <p>{selectedBook.summary || "书主暂未填写简介。"}</p>
                </section>
                <div className="detail-safety">
                  书主同意时确认公共交接地点。借书家庭收到书后，开始 14 天借期。
                </div>
                <section className="borrow-guide" aria-label="借阅步骤">
                  <h2>四步完成借阅</h2>
                  <ol>
                    <li><b>1</b><span>申请<br /><small>书主同意并确定地点</small></span></li>
                    <li><b>2</b><span>取书<br /><small>借方收到书后确认</small></span></li>
                    <li><b>3</b><span>阅读<br /><small>借期 14 天</small></span></li>
                    <li><b>4</b><span>归还<br /><small>书主收回书后确认</small></span></li>
                  </ol>
                </section>
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
                    onClick={() => {
                      setTaskTab("progress");
                      go("tasks");
                    }}
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
              <p className="eyebrow">{editingBookId ? "整理我的藏书" : "把好故事分享出去"}</p>
              <h1>{editingBookId ? "编辑图书" : "发布一本童书"}</h1>
              <p>{editingBookId ? "修改书的信息与封面，保存后会更新展示。" : "拍一张封面，快速填写图书信息；发布前请家长认真核对。"}</p>
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
                <div className="cover-upload">
                  <div className="cover-upload-preview">
                    {coverImage ? <img src={coverImage} alt="待发布的图书封面" /> : <span aria-hidden="true">▧</span>}
                  </div>
                  <div className="cover-upload-content">
                    <strong>添加封面照片</strong>
                    <p>原图可达 20 MB，裁剪后仅上传不超过 600 KB 的封面。完成裁剪后会自动识别并检索简介。{coverChanged && coverBytes ? `当前封面 ${Math.round(coverBytes / 1000)} KB。` : ""}</p>
                    <div className="cover-upload-actions">
                      <input ref={coverInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="visually-hidden" aria-label="拍照或上传图书封面" onChange={(event) => { chooseCover(event.target.files?.[0]); event.target.value = ""; }} />
                      <button type="button" className="secondary-button" onClick={() => coverInput.current?.click()}>{coverImage ? "更换照片" : "拍照 / 上传"}</button>
                      <button type="button" className="ai-button" disabled={!coverChanged || !!assistBusy} onClick={() => void recognize()}>{assistBusy === "recognize" ? "识别中…" : "✦ AI 识别并填写"}</button>
                    </div>
                  </div>
                </div>
                {assistNotice && <p className="suggestion-note" role="status">{assistNotice}</p>}
                <div className="field-grid">
                  <label>
                    <span className="field-label">书名 <b>*</b></span>
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
                      {options.categories.filter(option => option.active || option.id === publishCategory).map(option => <option key={option.id} value={option.id}>{option.label}{option.active ? "" : "（已停用）"}</option>)}
                    </select>
                  </label>
                  <label>
                    适读年龄
                    <select
                      value={publishAge}
                      onChange={(event) => setPublishAge(event.target.value)}
                    >
                      {options.ages.filter(option => option.active || option.id === publishAge).map(option => <option key={option.id} value={option.id}>{option.label}{option.active ? "" : "（已停用）"}</option>)}
                    </select>
                  </label>
                  <label>
                    新旧程度
                    <select
                      value={condition}
                      onChange={(event) => setCondition(event.target.value)}
                    >
                      {options.conditions.filter(option => option.active || option.id === condition).map(option => <option key={option.id} value={option.id}>{option.label}{option.active ? "" : "（已停用）"}</option>)}
                    </select>
                  </label>
                  <label className="full-field">
                    <span className="summary-label"><span>简单介绍</span><button type="button" disabled={!title.trim() || !!assistBusy} onClick={() => void generateSummary()}>{assistBusy === "summarize" ? "检索中…" : "✦ AI 检索并生成"}</button></span>
                    <textarea
                      value={summary}
                      maxLength={1000}
                      onChange={(event) => setSummary(event.target.value)}
                      rows={4}
                      placeholder="说说这本书的故事、主题或孩子喜欢它的原因"
                    />
                  </label>
                </div>
                <label className="audience-check"><input type="checkbox" checked={nonChildren} onChange={event => setNonChildren(event.target.checked)} /><span><strong>非儿童读物</strong><small>AI 会依据检索资料标记；如果判断有误，可以手动调整。标记不会阻止发布。</small></span></label>
                {summarySources.length > 0 && <div className="summary-sources"><span>资料来源：</span>{summarySources.map((source, index) => <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>)}</div>}
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
                  disabled={busy || !!assistBusy || !title.trim()}
                  onClick={publish}
                >
                  {editingBookId ? "保存修改" : "确认发布"}
                </button>
              </div>
              <aside className="publish-aside">
                <div className="aside-cover"><span>✦</span><strong>一本闲置书<br />下一段新旅程</strong></div>
                <h3>发布后会怎样？</h3>
                <ol>
                  <li>其他家庭可在找书页看到这本书</li>
                  <li>申请后由你确认交接地点并同意</li>
                  <li>借方取书后确认，归还时由你确认收回</li>
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
              <p>申请、取书、阅读、归还，双方都能看到现在进行到哪一步。</p>
            </div>
            <div className="tabs">
              <button
                className={taskTab === "todo" ? "selected" : ""}
                onClick={() => setTaskTab("todo")}
              >
                待办 {pendingCount > 0 && <em>{pendingCount}</em>}
              </button>
              <button
                className={taskTab === "progress" ? "selected" : ""}
                onClick={() => setTaskTab("progress")}
              >
                进行中 {activeLoans.length > 0 && <em>{activeLoans.length}</em>}
              </button>
              <button
                className={taskTab === "messages" ? "selected" : ""}
                onClick={() => setTaskTab("messages")}
              >
                借阅动态
              </button>
            </div>
            {taskTab === "todo" ? (
              todoLoans.length ? (
                <div className="orders-list">
                  {todoLoans.map(renderLoanCard)}
                </div>
              ) : (
                <div className="empty-state">
                  <h3>目前没有需要你处理的借阅</h3>
                  <p>{activeLoans.length ? "进行中的借阅可以在旁边查看。" : "从找书页申请一本书，进展会显示在这里。"}</p>
                  <button
                    className="secondary-button"
                    onClick={() => activeLoans.length ? setTaskTab("progress") : go("discover")}
                  >
                    {activeLoans.length ? "查看进行中" : "去找书"}
                  </button>
                </div>
              )
            ) : taskTab === "progress" ? (
              activeLoans.length ? (
                <div className="orders-list">{activeLoans.map(renderLoanCard)}</div>
              ) : (
                <div className="empty-state">
                  <h3>目前没有进行中的借阅</h3>
                  <p>从找书页申请一本书，进展会显示在这里。</p>
                  <button className="secondary-button" onClick={() => go("discover")}>去找书</button>
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
                          申请 {new Date(loan.requestedAt).toLocaleString("zh-CN")}
                          {loan.lentAt && <> · 取书 {new Date(loan.lentAt).toLocaleString("zh-CN")}</>}
                          {loan.returnedAt && <> · 归还 {new Date(loan.returnedAt).toLocaleString("zh-CN")}</>}
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
                      <article className="shelf-book-card" key={book.id}>
                        <button className="shelf-book-main" onClick={() => showBook(book.id)}>
                          <BookCover book={book} />
                          <span><strong>{book.title}</strong><small>{book.category} · {book.age}</small></span>
                        </button>
                        <div className="shelf-book-controls">
                          <div className="shelf-book-badges">
                            <span className={`status ${book.available ? "available" : "unavailable"}`}>{book.available ? "可借" : book.offShelf ? "不可借" : "借出中"}</span>
                            <span className={`shelf-state ${book.offShelf ? "offline" : "online"}`}>{book.offShelf ? "已下架" : "已上架"}</span>
                            {book.nonChildren && <span className="non-child-badge">非儿童读物</span>}
                          </div>
                          <button className="secondary-button shelf-edit" disabled={!book.editable || busy} title={book.editable ? "编辑图书" : "借阅申请或借出期间不能编辑"} onClick={() => startEdit(book)}>编辑</button>
                          {(book.available || book.offShelf) && <button className="secondary-button" disabled={busy} onClick={() => setShelf(book)}>{book.available ? "下架" : "上架"}</button>}
                        </div>
                      </article>
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
                        setTaskTab(active.has(loan.stage) ? "progress" : "messages");
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
              <p>登录账号：{family.username || "待设置"}</p>
              <p>已验证邮箱：{family.email || "待设置"}</p>
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
                <label>
                  联系电话
                  <input type="tel" autoComplete="tel" value={profilePhone} onChange={(event) => setProfilePhone(event.target.value)} placeholder="大陆手机号或带国家区号的号码" />
                </label>
              </div>
              {!family.phone && <p className="phone-reminder">尚未填写联系电话。旧账号可以继续使用，建议补填以便借阅交接。</p>}
              <p className="phone-purpose">用于借阅交接和订单异常联系；书主同意借阅后，仅向该笔借阅双方展示，管理员可在必要时联系；不在公开书目展示，不用于营销。号码暂未短信验证。</p>
              <div className="action-row">
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={saveProfile}
                >
                  保存资料
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
                    {options.ages.filter(option => option.active).map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
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
      <footer className="site-footer">
        <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">
          陕ICP备2026026598号-1
        </a>
        <a href={import.meta.env.DEV ? "http://127.0.0.1:5174/admin/" : "/admin/"}>管理员入口</a>
      </footer>
      <nav className="mobile-nav" aria-label="底部导航">
        {nav.map((item) => (
          <button
            key={item.page}
            className={page === item.page ? "active" : ""}
            onClick={() => go(item.page)}
            aria-label={item.page === "tasks" && pendingCount > 0 ? `${item.label}，${pendingCount} 条待办` : undefined}
          >
            <span aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
            {item.page === "tasks" && pendingCount > 0 && (
              <span className="nav-badge" aria-hidden="true">{pendingBadge}</span>
            )}
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
            <p className="eyebrow">{authMode === "login" ? "家长登录" : authMode === "register" ? "注册家庭书屋" : "找回密码"}</p>
            <h2 id="login-title">{authMode === "login" ? "欢迎回来" : authMode === "register" ? "创建共享书屋账号" : "重置登录密码"}</h2>
            <p>{authMode === "login" ? "使用账号或已验证邮箱登录。" : authMode === "register" ? "填写账号、邮箱和密码，完成邮箱验证后即可使用。" : "向注册邮箱发送验证码，验证后设置新密码。"}</p>
            <div className="login-fields">
              {authMode !== "reset" && (
                <label>
                  {authMode === "login" ? "账号或邮箱" : "账号（4–24 位字母、数字或下划线）"}
                  <input
                    autoComplete="username"
                    value={account}
                    maxLength={authMode === "login" ? 254 : 24}
                    onChange={(event) => setAccount(event.target.value)}
                    placeholder={authMode === "login" ? "请输入账号或邮箱" : "例如 tangtang_home"}
                  />
                </label>
              )}
              {authMode !== "login" && (
                <label>
                  注册邮箱
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    maxLength={254}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="用于验证和找回密码"
                  />
                </label>
              )}
              {authMode === "register" && (
                <>
                  <label>
                    书屋昵称
                    <input value={nickname} maxLength={30} onChange={(event) => setNickname(event.target.value)} placeholder="例如：糖糖书屋" />
                  </label>
                  <label>
                    联系电话 <b>*</b>
                    <input type="tel" autoComplete="tel" value={registrationPhone} onChange={(event) => setRegistrationPhone(event.target.value)} placeholder="大陆手机号或 +国家区号号码" />
                  </label>
                  <p className="phone-purpose">用于借阅交接和订单异常联系；书主同意借阅后，仅向该笔借阅双方展示，管理员可在必要时联系；不在公开书目展示，不用于营销。注册仍使用邮箱验证码，电话暂不发送短信验证。</p>
                </>
              )}
              {authMode !== "login" && (
                <>
                  <button
                    className="secondary-button"
                    disabled={busy || !emailValid}
                    onClick={sendCode}
                  >
                    {codeSent ? "重新发送验证邮件" : "发送邮箱验证码"}
                  </button>
                  <label>
                    邮箱验证码
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
                </>
              )}
              <label>
                {authMode === "reset" ? "新密码" : "密码"}
                <input
                  type="password"
                  autoComplete={authMode === "login" ? "current-password" : "new-password"}
                  value={password}
                  maxLength={128}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={authMode === "login" ? "请输入密码" : "至少 10 位"}
                />
              </label>
              {authMode !== "login" && <p className="password-example">密码至少 10 位。示例：Tangtang@2026（请勿直接使用这个示例）。</p>}
              {authMode !== "login" && (
                <label>
                  确认密码
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    maxLength={128}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                </label>
              )}
              <button className="primary-button" disabled={busy || !authReady} onClick={submitAuth}>
                {authMode === "login" ? "登录" : authMode === "register" ? "验证邮箱并注册" : "重置密码"}
              </button>
              <div className="auth-switches">
                {authMode !== "login" && <button type="button" onClick={() => switchAuthMode("login")}>返回登录</button>}
                {authMode !== "register" && <button type="button" onClick={() => switchAuthMode("register")}>创建账号</button>}
                {authMode !== "reset" && <button type="button" onClick={() => switchAuthMode("reset")}>忘记密码</button>}
              </div>
            </div>
            <p className="dialog-foot">
              邮箱仅用于账号验证与密码找回，不会公开给其他家庭。
            </p>
          </div>
        </div>
      )}
      {pendingCover && <CoverCropDialog file={pendingCover} onClose={() => setPendingCover(null)} onUse={(image, bytes) => { setCoverImage(image); setCoverBytes(bytes); setCoverChanged(true); setNonChildren(false); setPendingCover(null); void recognize(image); }} />}
    </div>
  );
}

export default App;
