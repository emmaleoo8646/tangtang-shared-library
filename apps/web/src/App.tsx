import { useEffect, useRef, useState } from "react";
import { api, allBooks, ApiError, type Book, type Family, type Loan, type OptionLists } from "./api";
import { SelectBook, Browse, Shops, ChoiceSelect, CartPanel, GroupCard, groupLoans, useBorrowCart } from "./Borrowing";
import { LibraryIcon, type LibraryIconName } from "./components/LibraryIcon";
import { loanPresentation } from "./loanPresentation";
import { CoverCropDialog } from "./CoverCropDialog";
import { AiBusyNote } from "./components/AiBusyNote";
import { OwnBooks } from "./OwnBooks";
import { BookDetails } from "./components/BookDetails";

type Page = "discover" | "shops" | "detail" | "publish" | "tasks" | "library" | "profile";
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
const nav: { page: Page; label: string; icon: LibraryIconName }[] = [
  { page: "discover", label: "找书", icon: "search" },
  { page: "shops", label: "逛书屋", icon: "shop" },
  { page: "tasks", label: "借阅", icon: "clock" },
  { page: "library", label: "我的书屋", icon: "home" },
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


function App() {
  const [page, setPage] = useState<Page>("discover");
  const [previousPage, setPreviousPage] = useState<Page>("discover");
  const [books, setBooks] = useState<Book[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [family, setFamily] = useState<Family | null>(null);
  const [options, setOptions] = useState<OptionLists>({ categories: [], ages: [], conditions: [] });
  const [selectedId, setSelectedId] = useState("");
  const [authReadyLoaded, setAuthReadyLoaded] = useState(false);
  const [currentShop, setCurrentShop] = useState(new URLSearchParams(location.search).get("shop") || "");
  const [browseKey, setBrowseKey] = useState(0);
  const [ownedSeries, setOwnedSeries] = useState<{id:string;name:string}[]>([]);
  const [publishSeries, setPublishSeries] = useState("");
  const [seriesOrder, setSeriesOrder] = useState("");
  const [taskTab, setTaskTab] = useState<"all" | "progress" | "done">("all");
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
  const [registrationComplete, setRegistrationComplete] = useState(false);
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
  const [recognizeNotice, setRecognizeNotice] = useState("");
  const [summarizeNotice, setSummarizeNotice] = useState("");
  const [summarySources, setSummarySources] = useState<{ title: string; url: string }[]>([]);
  const coverInput = useRef<HTMLInputElement>(null);
  const assistRequest = useRef(0);

  const [privacyConfirmed, setPrivacyConfirmed] = useState(false);
  const [childNickname, setChildNickname] = useState("");
  const [childAge, setChildAge] = useState("age-3-6");
  const [closeAccountOpen, setCloseAccountOpen] = useState(false);
  const [closeAccountName, setCloseAccountName] = useState("");
  const [accountDangerOpen, setAccountDangerOpen] = useState(false);

  const selectedBook = books.find((book) => book.id === selectedId);
  const selectedLoan = loans.find(
    (loan) => loan.bookId === selectedId && active.has(loan.stage),
  );
  const activeLoans = loans.filter((loan) => active.has(loan.stage));
  const todoLoans = activeLoans.filter(needsAttention);
  const pendingCount = groupLoans(todoLoans).length;
  const pendingBadge = pendingCount > 99 ? "99+" : pendingCount;
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const authReady = authMode === "login"
    ? Boolean(account.trim() && password)
    : emailValid && /^\d{6}$/.test(code) && password.length >= 10 && password === confirmPassword && (authMode === "reset" || /^[a-zA-Z0-9_]{4,24}$/.test(account));
  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 4000);
  }
  async function refresh() {
    const [list, currentOptions] = await Promise.all([allBooks(), api<OptionLists>("/options")]);
    setBooks(list);
    setOptions(currentOptions);
    try {
      const me = await api<Family>("/me");
      setFamily(me);
      setLoans(await api<Loan[]>("/loans"));
      setOwnedSeries(await api<{id:string;name:string}[]>("/series"));
    } catch (error) {
      if (!(error instanceof ApiError) || ![401,403].includes(error.status)) throw error;
      setFamily(null);
      setLoans([]); setOwnedSeries([]);
    }
    setAuthReadyLoaded(true);
  }
  const cart = useBorrowCart(family, authReadyLoaded, books, refresh, () => { switchAuthMode("login"); setLoginOpen(true); }, flash);
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
    if (target !== "discover" && target !== "shops" && target !== "detail" && !family) {
      setRequestedPage(target);
      switchAuthMode("login");
      setLoginOpen(true);
      return;
    }
    if (target === "discover") { history.pushState(null,"","/"); setCurrentShop(""); setBrowseKey(key=>key+1); }
    if (target === "publish") {
      assistRequest.current++;
      setAssistBusy(null);
      setEditingBookId(null);
      setPublishSeries(""); setSeriesOrder("");
      setTitle(""); setAuthor(""); setSummary(""); setNonChildren(false); setCoverImage(""); setCoverChanged(false); setCoverBytes(0);
      setPublishCategory(current => currentOptionsFallback(current, options.categories, "category-picture"));
      setPublishAge(current => currentOptionsFallback(current, options.ages, "age-3-6"));
      setCondition(current => currentOptionsFallback(current, options.conditions, "condition-like-new"));
      setPrivacyConfirmed(false); setRecognizeNotice(""); setSummarizeNotice(""); setSummarySources([]);
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
      return true;
    } catch (error) {
      flash((error as Error).message);
      return false;
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
      if (authMode === "register") {
        await api("/auth/register", "POST", { username: account, email, password, code });
        setRegistrationComplete(true);
      } else await api("/auth/login", "POST", { account, password });
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
      setRegistrationComplete(false);
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
        seriesId: publishSeries || null,
        seriesOrder: seriesOrder || null,
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
      setRecognizeNotice(""); setSummarizeNotice("");
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
    setPublishSeries(book.series?.id || ""); setSeriesOrder(book.seriesOrder?.toString() || "");
    setTitle(book.title); setAuthor(book.author); setSummary(book.summary); setNonChildren(book.nonChildren);
    setPublishCategory(book.categoryOptionId || "category-other");
    setPublishAge(book.ageOptionId || "age-3-6");
    setCondition(book.conditionOptionId);
    setCoverImage(book.coverUrl || ""); setCoverChanged(false); setCoverBytes(0);
    setRecognizeNotice(""); setSummarizeNotice(""); setSummarySources([]); setPrivacyConfirmed(true);
    setPage("publish"); window.scrollTo(0, 0);
  }

  async function recognize(image = coverImage) {
    if (!image) return;
    const requestId = ++assistRequest.current;
    setAssistBusy("recognize");
    setRecognizeNotice("正在识别封面并检索图书资料，简介会自动填写…");
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
      setRecognizeNotice(result.notice || "已自动识别封面并检索资料，请核对图书信息与简介。");
    } catch (error) { if (requestId === assistRequest.current) { setRecognizeNotice("自动识别暂未完成，可手动填写，或点击按钮重试。"); flash((error as Error).message); } }
    finally { if (requestId === assistRequest.current) setAssistBusy(null); }
  }

  async function generateSummary() {
    if (!title.trim() || assistBusy) return;
    const requestId = ++assistRequest.current;
    setAssistBusy("summarize");
    setSummarizeNotice("正在检索图书资料并撰写简介…");
    try {
      const result = await api<{ summary: string; nonChildren: boolean; sources: { title: string; url: string }[] }>("/books/summarize", "POST", { title, author });
      if (requestId !== assistRequest.current) return;
      setSummary(result.summary);
      setNonChildren(result.nonChildren);
      setSummarySources(result.sources);
      setSummarizeNotice("MiniMax 已检索图书资料，请核对简介内容。");
    } catch (error) { if (requestId === assistRequest.current) { setSummarizeNotice("AI 检索简介暂未完成，可手动填写或调整书名/作者后重试。"); flash((error as Error).message); } }
    finally { if (requestId === assistRequest.current) setAssistBusy(null); }
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
  function expectedCloseAccountName() {
    return (nickname.trim() || family?.displayName || "").trim();
  }
  function openCloseAccountDialog() {
    if (busy) return;
    setCloseAccountName("");
    setCloseAccountOpen(true);
  }
  function cancelCloseAccount() {
    setCloseAccountOpen(false);
    setCloseAccountName("");
  }
  async function confirmCloseAccount() {
    if (!family) return;
    if (closeAccountName.trim() !== expectedCloseAccountName()) return;
    setCloseAccountOpen(false);
    setCloseAccountName("");
    await run(async () => {
      await api("/me", "DELETE");
      setPage("discover");
    }, "账号已注销");
  }

  function continueShop(id: string) {
    history.pushState(null, "", `/?shop=${encodeURIComponent(id)}`);
    sessionStorage.removeItem('tt-browse');
    setCurrentShop(id); setPage('discover'); setBrowseKey(key => key + 1); cart.setActiveShop(id); window.scrollTo(0,0);
  }
  async function groupAction(id: string, action: string, extra: Record<string,unknown> = {}) {
    if (busy) return;
    setBusy(true);
    try { const legacy = loans.some(l=>l.id === id && !l.groupId); await api(`/${legacy ? 'loans' : 'loan-groups'}/${id}/action`, 'POST', {action,...extra}); await refresh(); flash('借阅进展已更新'); }
    catch(error) { flash((error as Error).message); throw error; }
    finally {setBusy(false);}
  }
  function renderRecords(rows: Loan[]) {
    // Include the complete group so a mixed batch never hides its rejected or returned books.
    return groupLoans(rows).map(group => <GroupCard books={books} familyId={family?.id || ""}
      key={group[0].groupId || group[0].id}
      loans={group[0].groupId ? loans.filter(l=>l.groupId===group[0].groupId) : group}
      busy={busy} defaultPlace={loans.find(l => l.isOwner && l.place)?.place || ""} act={groupAction} />);
  }
  async function organize(name: string, summary: string, ids: string[]) {
    return (await run(() => api('/series', 'POST', { name, summary, bookIds: ids }), '已整理为系列')) ?? false;
  }


  return (
    <div className="site-shell">
      <header className="site-header">
        <div className="header-inner">
          <button className="brand" onClick={() => go("discover")}>
            <span className="brand-symbol"><LibraryIcon name="book" /></span>
            <span>
              <strong>糖糖的共享书屋</strong>
            </span>
          </button>
          <nav className="desktop-nav" aria-label="主导航">
            {nav.map((item) => (
              <button
                key={item.page}
                className={(item.page === "shops" ? page === "shops" || (page === "discover" && !!currentShop) : item.page === "discover" ? page === "discover" && !currentShop : item.page === "library" ? ["library","publish","profile"].includes(page) : page === item.page) ? "active" : ""}
                onClick={() => go(item.page)}
                aria-label={item.page === "tasks" && pendingCount > 0 ? `${item.label}，${pendingCount} 条待办` : undefined}
              >
                <LibraryIcon name={item.icon} />
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
      <main className={`main-content page-${page} ${cart.carts.length && ["discover","shops","detail"].includes(page) ? "with-borrow-cart" : ""}`}>
        {page === "discover" && <Browse key={browseKey} books={books} options={options} cart={cart} onShopChange={setCurrentShop} />}
        {page === "shops" && <Shops books={books} enterShop={continueShop} />}
        {page === "detail" && selectedBook && (
          <>
            <button className="back-link" onClick={() => go(previousPage)}>
              ‹ 返回{previousPage === "library" ? "我的书屋" : "找书"}
            </button>
            <BookDetails book={selectedBook} familyId={family?.id} onShop={() => continueShop(selectedBook.shopId)} actions={<>
              <button className="secondary-button" onClick={() => go(previousPage)}>返回{previousPage === "library" ? "我的藏书" : "找书"}</button>
              {selectedBook.mine ? <button className="primary-button" onClick={() => go("library")}>查看我的藏书</button>
                : selectedLoan ? <button className="primary-button" onClick={() => { setTaskTab("progress"); go("tasks"); }}>查看这笔借阅</button>
                : <SelectBook book={selectedBook} cart={cart} />}
            </>} />
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
                    <p>拍照或上传清晰封面，裁剪后自动识别书名并填写简介。{coverChanged && coverBytes ? `当前封面 ${Math.round(coverBytes / 1000)} KB。` : ""}</p>
                    <div className="cover-upload-actions">
                      <input ref={coverInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="visually-hidden" aria-label="拍照或上传图书封面" onChange={(event) => { chooseCover(event.target.files?.[0]); event.target.value = ""; }} />
                      <button type="button" className="secondary-button" onClick={() => coverInput.current?.click()}>{coverImage ? "更换照片" : "拍照 / 上传"}</button>
                      <button type="button" className="ai-button" disabled={!coverChanged || !!assistBusy} onClick={() => void recognize()}>{assistBusy === "recognize" ? "识别中…" : "✦ AI 识别并填写"}</button>
                    </div>
                  </div>
                </div>
                <AiBusyNote
                  text={recognizeNotice}
                  busy={assistBusy === "recognize"}
                  errorText="自动识别暂未完成，可手动填写，或点击按钮重试。"
                />
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
                    <ChoiceSelect label="图书分类" value={publishCategory} onChange={setPublishCategory} options={options.categories.filter(o=>o.active || o.id === publishCategory).map(o=>({value:o.id,label:o.label+(o.active ? "" : "（已停用）")}))}/>
                  </label>
                  <label>
                    适读年龄
                    <ChoiceSelect label="适读年龄" value={publishAge} onChange={setPublishAge} options={options.ages.filter(o=>o.active || o.id === publishAge).map(o=>({value:o.id,label:o.label+(o.active ? "" : "（已停用）")}))}/>
                  </label>
                  <label>
                    新旧程度
                    <ChoiceSelect label="新旧程度" value={condition} onChange={setCondition} options={options.conditions.filter(o=>o.active || o.id === condition).map(o=>({value:o.id,label:o.label+(o.active ? "" : "（已停用）")}))}/>
                  </label>
                  <label>所属系列（选填）<ChoiceSelect label="所属系列" value={publishSeries} onChange={setPublishSeries} options={[{value:"",label:"单本图书"},...ownedSeries.map(item=>({value:item.id,label:item.name}))]}/></label>
                  <label>系列册序（选填）<input type="number" min="1" max="10000" disabled={!publishSeries} value={seriesOrder} onChange={e=>setSeriesOrder(e.target.value)} placeholder="例如 1" /></label>
                  <label className="full-field">
                    <span className="summary-label"><span>简单介绍</span><button type="button" disabled={!title.trim() || !!assistBusy} onClick={() => void generateSummary()}>{assistBusy === "summarize" ? "检索中…" : "✦ AI 检索并生成"}</button></span>
                    <textarea
                      value={summary}
                      maxLength={1000}
                      onChange={(event) => setSummary(event.target.value)}
                      rows={4}
                      placeholder="说说这本书的故事、主题或孩子喜欢它的原因"
                    />
                    <AiBusyNote
                      text={summarizeNotice}
                      busy={assistBusy === "summarize"}
                      errorText="AI 检索简介暂未完成，可手动填写或调整书名/作者后重试。"
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
        {page === "tasks" && <>
          <div className="page-title"><h1>我的借阅</h1><p>和一家书屋的几本书，放在一起看。</p></div>
          <div className="tabs borrowing-tabs">{([{value:"all",label:"全部"},{value:"progress",label:"进行中"},{value:"done",label:"已结束"}] as const).map(t=>{
            const count=groupLoans(loans).filter(g=>t.value==="all" || (t.value==="done" ? loanPresentation(g).done : !loanPresentation(g).done)).length;
            return <button key={t.value} className={taskTab===t.value?"selected":""} onClick={()=>setTaskTab(t.value)}>{t.label}<span className="tab-count">{count}</span></button>;
          })}</div>
          <div className="loan-list">{(() => {
            const rows=groupLoans(loans).filter(g=>taskTab==="all" || (taskTab==="done" ? loanPresentation(g).done : !loanPresentation(g).done)).flat();
            return rows.length ? renderRecords(rows) : <div className="empty-state"><LibraryIcon name="book"/><h3>{taskTab==="done" ? "还没有结束的借阅" : "目前没有进行中的借阅"}</h3><p>选几本喜欢的书，借阅进展会显示在这里。</p><button className="secondary-button" onClick={()=>go("discover")}>去找书</button></div>;
          })()}</div>
        </>}
        {page === "library" && (
          <>
            <div className="page-title">
              <div className="my-library-title"><h1>我的书屋</h1><button className="secondary-button publish-entry" onClick={()=>go("publish")}><LibraryIcon name="plus"/> 发布图书</button></div>
            </div>
            <section className="family-card">
              <div className="family-avatar">{family?.displayName[0]}</div>
              <div>
                <h2>{family?.displayName}</h2>
                <p>让好故事继续流动</p>
              </div>
              <button
                className="text-button"
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
              <OwnBooks books={books.filter(book => book.mine)} busy={busy} showBook={showBook}
                editBook={startEdit} setShelf={book => { void setShelf(book); }} publish={() => go("publish")} organize={organize} />
            ) : (
              <div className="record-list">
                {groupLoans(loans.filter(loan => libraryTab === "lent" ? loan.isOwner : !loan.isOwner)).map(group => {
                  const first = group[0];
                  const counts = group.reduce<Record<string,number>>((v,loan) => { v[loan.stage] = (v[loan.stage] || 0) + 1; return v; }, {});
                  return <button key={first.groupId || first.id} onClick={() => { setTaskTab(group.some(loan => active.has(loan.stage)) ? "progress" : "done"); go("tasks"); }}><span><strong>{first.groupId ? `${first.isOwner ? first.borrower : first.owner} · ${group.length}本` : first.bookTitle}</strong><small>{Object.entries(counts).map(([stage,count]) => `${count}本${statusText[stage]}`).join("，")}</small></span><span>›</span></button>;
                })}
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
              {!family.phone && <p className="phone-reminder">请完善书屋昵称和手机号码，方便其他家庭认识你的书屋、联系借阅交接。</p>}
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
                  <ChoiceSelect label="孩子年龄段" value={childAge} onChange={setChildAge} options={options.ages.filter(o=>o.active).map(o=>({value:o.id,label:o.label}))}/>
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
                  className="account-disclosure"
                  type="button"
                  aria-expanded={accountDangerOpen}
                  aria-controls="account-danger-body"
                  disabled={busy}
                  onClick={() => setAccountDangerOpen((value) => !value)}
                >
                  <span className="account-disclosure-chev" aria-hidden="true">▸</span>
                  <span>注销家庭书屋</span>
                </button>
                {accountDangerOpen && (
                  <div id="account-danger-body" className="account-danger-body">
                    <p>
                      注销后书会下架，孩子档案和登录信息会删除；已完成的借阅记录保留匿名信息。
                    </p>
                    <button
                      className="danger-button"
                      type="button"
                      disabled={busy}
                      onClick={openCloseAccountDialog}
                    >
                      我已了解，继续注销
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </main>
      <CartPanel showBar={["discover","shops","detail"].includes(page)} shopId={page === "discover" ? currentShop : ""} cart={cart} viewOrders={() => {setTaskTab("progress");go("tasks");}} continueShop={continueShop} />
      <footer className="site-footer">
        <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">
          陕ICP备2026026598号-1
        </a>
        <span className="site-footnote">共享书屋测试版 · 由家长操作，公共地点交接</span>
        <a href={import.meta.env.DEV ? "http://127.0.0.1:5174/admin/" : "/admin/"}>管理员入口</a>
      </footer>
      <nav className="mobile-nav" aria-label="底部导航">
        {nav.map((item) => (
          <button
            key={item.page}
            className={(item.page === "shops" ? page === "shops" || (page === "discover" && !!currentShop) : item.page === "discover" ? page === "discover" && !currentShop : item.page === "library" ? ["library","publish","profile"].includes(page) : page === item.page) ? "active" : ""}
            onClick={() => go(item.page)}
            aria-label={item.page === "tasks" && pendingCount > 0 ? `${item.label}，${pendingCount} 条待办` : undefined}
          >
            <LibraryIcon name={item.icon} />
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
      {closeAccountOpen && family && (
        <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) cancelCloseAccount(); }}>
          <div
            className="login-dialog close-account-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="close-account-title"
          >
            <button
              className="modal-close"
              type="button"
              aria-label="关闭"
              onClick={cancelCloseAccount}
            >
              ×
            </button>
            <div className="dialog-icon" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            </div>
            <h2 id="close-account-title">确认注销家庭书屋？</h2>
            <p>进行中的借阅需先完成。书屋会下架，孩子档案会删除，账号会退出；已完成的借阅记录保留匿名信息。</p>
            <div className="confirm-form">
              <label>
                请输入书屋昵称 "<strong>{expectedCloseAccountName() || family.displayName}</strong>" 以确认
                <input
                  value={closeAccountName}
                  onChange={(event) => setCloseAccountName(event.target.value)}
                  placeholder={expectedCloseAccountName() || family.displayName}
                  autoComplete="off"
                />
              </label>
              <p className={"confirm-hint" + (closeAccountName.length > 0 && closeAccountName.trim() !== expectedCloseAccountName() ? " bad" : "")}>
                {closeAccountName.length === 0
                  ? "请完整输入当前书屋昵称"
                  : closeAccountName.trim() === expectedCloseAccountName()
                    ? "昵称匹配，可以继续"
                    : "昵称不匹配，无法提交"}
              </p>
              <div className="confirm-dialog-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busy}
                  onClick={cancelCloseAccount}
                >
                  取消
                </button>
                <button
                  className="danger-button"
                  type="button"
                  disabled={busy || closeAccountName.trim() !== expectedCloseAccountName()}
                  onClick={confirmCloseAccount}
                >
                  永久注销
                </button>
              </div>
            </div>
          </div>
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
            <p className="eyebrow">{authMode === "login" ? "家长登录" : authMode === "register" ? "加入共享书屋" : "找回密码"}</p>
            <h2 id="login-title">{authMode === "login" ? "欢迎回来" : authMode === "register" ? "创建账号" : "重置登录密码"}</h2>
            <p>{authMode === "login" ? "使用账号或已验证邮箱登录。" : authMode === "register" ? "验证邮箱，即可开启共享阅读。" : "向注册邮箱发送验证码，验证后设置新密码。"}</p>
            <div className="login-fields">
              {authMode !== "reset" && (
                <label>
                  {authMode === "login" ? "账号或邮箱" : "账号"}
                  <input
                    autoComplete="username"
                    value={account}
                    maxLength={authMode === "login" ? 254 : 24}
                    onChange={(event) => setAccount(event.target.value)}
                    placeholder={authMode === "login" ? "请输入账号或邮箱" : "4–24 位字母、数字或下划线"}
                  />
                </label>
              )}
              {authMode !== "login" && (
                <label>
                  邮箱
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
              {authMode !== "login" && (
                <>
                  <label>
                    邮箱验证码
                    <div className="email-code-row">
                      <input
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={code}
                        maxLength={6}
                        onChange={(event) => setCode(event.target.value)}
                        placeholder="6 位验证码"
                      />
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busy || !emailValid}
                        onClick={sendCode}
                      >
                        {codeSent ? "重新发送" : "获取验证码"}
                      </button>
                    </div>
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
              {authMode === "reset" && <p className="password-example">密码至少 10 位。示例：Tangtang@2026（请勿直接使用这个示例）。</p>}
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
                {authMode === "login" ? "登录" : authMode === "register" ? "注册" : "重置密码"}
              </button>
              <div className="auth-switches">
                {authMode !== "login" && <button type="button" onClick={() => switchAuthMode("login")}>返回登录</button>}
                {authMode !== "register" && <button type="button" onClick={() => switchAuthMode("register")}>创建账号</button>}
                {authMode === "login" && <button type="button" onClick={() => switchAuthMode("reset")}>忘记密码</button>}
              </div>
            </div>
            <p className="dialog-foot">
              邮箱仅用于账号验证与密码找回，不会公开给其他家庭。
            </p>
          </div>
        </div>
      )}
      {registrationComplete && family && (
        <div className="modal-backdrop">
          <div className="login-dialog" role="dialog" aria-modal="true" aria-labelledby="registration-success-title">
            <h2 id="registration-success-title">注册成功</h2>
            <p>欢迎加入共享书屋！请完善书屋昵称和手机号码，方便其他家庭认识你的书屋、联系借阅交接。</p>
            <div className="action-row registration-actions">
              <button className="primary-button" onClick={() => { setRegistrationComplete(false); go("profile"); }}>完善资料</button>
              <button className="secondary-button" onClick={() => setRegistrationComplete(false)}>稍后再说</button>
            </div>
          </div>
        </div>
      )}
      {pendingCover && <CoverCropDialog file={pendingCover} onClose={() => setPendingCover(null)} onUse={(image, bytes) => { setCoverImage(image); setCoverBytes(bytes); setCoverChanged(true); setNonChildren(false); setPendingCover(null); void recognize(image); }} />}
    </div>
  );
}

export default App;
