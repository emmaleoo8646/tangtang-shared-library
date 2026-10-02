import { Fragment, useEffect, useRef, useState } from "react";
import { api, allBooks, ApiError, type Book, type Family, type Loan, type OptionLists } from "./api";
import { SelectBook, Browse, Shops, CartPanel, GroupCard, useBorrowCart } from "./Borrowing";
import { InlineChoice } from "./components/Choices";
import { catalogChoices, catalogChoiceIssue, defaultChoice, type ChoicesStatus } from "./choicePresentation";
import { LibraryIcon, type LibraryIconName } from "./components/LibraryIcon";
import { groupLoans, loanPresentation, needsAttention, prioritizeLoanGroups } from "./loanPresentation";
import { CoverCropDialog } from "./CoverCropDialog";
import { OwnBooks } from "./OwnBooks";
import { FamilyAvatar } from "./components/FamilyAvatar";
import { BookDetails } from "./components/BookDetails";
import { PublishBook } from "./PublishBook";
import { clearPublishDraft } from "./publishDraft";

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

function App() {
  const [page, setPage] = useState<Page>("discover");
  const [previousPage, setPreviousPage] = useState<Page>("discover");
  const [books, setBooks] = useState<Book[]>([]);
  const [booksLoaded, setBooksLoaded] = useState(false);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [family, setFamily] = useState<Family | null>(null);
  const [options, setOptions] = useState<OptionLists>({ categories: [], ages: [], conditions: [] });
  const [optionsStatus, setOptionsStatus] = useState<ChoicesStatus>("loading");
  const choicesInitialized = useRef(false);
  const [selectedId, setSelectedId] = useState("");
  const [authReadyLoaded, setAuthReadyLoaded] = useState(false);
  const [currentShop, setCurrentShop] = useState(new URLSearchParams(location.search).get("shop") || "");
  const [browseKey, setBrowseKey] = useState(0);
  const [ownedSeries, setOwnedSeries] = useState<{id:string;name:string}[]>([]);
  const [seriesStatus, setSeriesStatus] = useState<ChoicesStatus>("loading");
  const [taskTab, setTaskTab] = useState<"all" | "progress" | "done">("progress");
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
  const [avatarImage, setAvatarImage] = useState("");
  const [avatarChanged, setAvatarChanged] = useState(false);
  const [avatarBytes, setAvatarBytes] = useState(0);
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);
  const avatarRequest = useRef(0);
  const [profilePhone, setProfilePhone] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [developmentCode, setDevelopmentCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [editingBook, setEditingBook] = useState<Book | null>(null);
  const [childNickname, setChildNickname] = useState("");
  const [childAge, setChildAge] = useState("age-3-6");
  const [closeAccountOpen, setCloseAccountOpen] = useState(false);
  const [closeAccountName, setCloseAccountName] = useState("");
  const [accountDangerOpen, setAccountDangerOpen] = useState(false);

  const selectedBook = books.find((book) => book.id === selectedId);
  const publishEditingBook = editingBook?.shopId === family?.id ? editingBook : null;
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
  const childAgeIssue = catalogChoiceIssue(options.ages, childAge, optionsStatus);
  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 4000);
  }
  async function refresh() {
    await Promise.all([
      allBooks().then(rows => { setBooks(rows); setBooksLoaded(true); }),
      api<OptionLists>("/options").then(rows => {
        setOptions(rows);
        setOptionsStatus("ready");
      }).catch(error => { setOptionsStatus("error"); throw error; }),
      (async () => {
        let me: Family;
        try { me = await api<Family>("/me"); }
        catch (error) {
          if (!(error instanceof ApiError) || ![401,403].includes(error.status)) throw error;
          setFamily(null); setLoans([]); setOwnedSeries([]); setSeriesStatus("loading");
          setAuthReadyLoaded(true);
          return;
        }
        setFamily(me);
        await Promise.all([
          api<Loan[]>("/loans").then(setLoans),
          api<{id:string;name:string}[]>("/series").then(rows => {
            setOwnedSeries(rows); setSeriesStatus("ready");
          }).catch(error => { setSeriesStatus("error"); throw error; }),
        ]);
        setAuthReadyLoaded(true);
      })(),
    ]);
  }
  const cart = useBorrowCart(family, authReadyLoaded, books, refresh, () => { switchAuthMode("login"); setLoginOpen(true); }, flash);
  useEffect(() => {
    void refresh().catch((error) => flash((error as Error).message));
  }, []);
  useEffect(() => {
    if (optionsStatus !== "ready" || choicesInitialized.current) return;
    choicesInitialized.current = true;
    setChildAge(current => defaultChoice(current, options.ages));
  }, [options, optionsStatus]);
  useEffect(() => {
    if (!family) return;
    const timer = window.setInterval(() => {
      void refresh().catch(() => {});
    }, 20000);
    return () => window.clearInterval(timer);
  }, [family?.id]);
  useEffect(() => {
    avatarRequest.current++;
    setAvatarLoading(false); setPendingAvatar(null);
    if (page !== "profile" || !family) return;
    setProfilePhone(family.phone); setNickname(family.displayName);
    setAvatarImage(family.avatarUrl || ""); setAvatarChanged(false); setAvatarBytes(0);
  }, [page, family?.id]);
  function go(target: Page, borrowingTab: "all" | "progress" | "done" = "progress") {
    if (target === "tasks") setTaskTab(borrowingTab);
    if (target !== "discover" && target !== "shops" && target !== "detail" && !family) {
      setRequestedPage(target);
      switchAuthMode("login");
      setLoginOpen(true);
      return;
    }
    if (target === "discover") { history.pushState(null,"","/"); setCurrentShop(""); setBrowseKey(key=>key+1); }
    if (target === "publish") setEditingBook(null);
    avatarRequest.current++;
    setAvatarLoading(false);
    setPendingAvatar(null);
    if (target === "profile" && family) {
      setProfilePhone(family.phone); setNickname(family.displayName);
      setAvatarImage(family.avatarUrl || ""); setAvatarChanged(false); setAvatarBytes(0);
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
  function startEdit(book: Book) {
    if (!book.editable) { flash("借阅申请或借出期间不能编辑图书"); return; }
    setEditingBook(book);
    setPage("publish"); window.scrollTo(0, 0);
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
  async function editAvatar() {
    if (!avatarImage || avatarLoading) return;
    const requestId = ++avatarRequest.current;
    setAvatarLoading(true);
    try {
      const response = await fetch(avatarImage);
      if (!response.ok) throw new Error("头像无法读取，请重新上传照片");
      const blob = await response.blob();
      if (requestId === avatarRequest.current) setPendingAvatar(new File([blob], "avatar", { type: blob.type }));
    } catch (error) { if (requestId === avatarRequest.current) flash((error as Error).message); }
    finally { if (requestId === avatarRequest.current) setAvatarLoading(false); }
  }
  async function saveProfile() {
    if (!family) return;
    await run(async () => {
      const saved = await api<Family>("/me", "PATCH", {
        displayName: nickname || family.displayName,
        ...(profilePhone.trim() ? { phone: profilePhone.trim() } : {}),
        ...(avatarChanged ? { avatarImage: avatarImage || null } : {}),
      });
      setAvatarImage(saved.avatarUrl || ""); setAvatarChanged(false); setAvatarBytes(0);
    }, "家庭资料已保存");
  }
  async function addChild() {
    if (childAgeIssue) { flash(childAgeIssue); return; }
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
      if (!clearPublishDraft(family.id)) flash("账号已注销，但本机草稿未能清除。");
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
    const groups = prioritizeLoanGroups(groupLoans(rows).map(group =>
      group[0].groupId ? loans.filter(l => l.groupId === group[0].groupId) : group));
    const todoCount = groups.filter(group => group.some(needsAttention)).length;
    return groups.map((group, index) => <Fragment key={group[0].groupId || group[0].id}>
      {todoCount > 0 && index === 0 && <h2 className="loan-section-title">需要你处理 · {todoCount} 条</h2>}
      {todoCount > 0 && index === todoCount && <h2 className="loan-section-title">{taskTab === "progress" ? "其他进行中的借阅" : "其他借阅"}</h2>}
      <GroupCard books={books} familyId={family?.id || ""} loans={group}
        busy={busy} defaultPlace={loans.find(l => l.isOwner && l.place)?.place || ""} act={groupAction} />
    </Fragment>);
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
            <FamilyAvatar className="avatar" name={family?.displayName || "访"} src={family?.avatarUrl} decorative />
            <span>{family ? family.displayName : "家长登录"}</span>
            <span aria-hidden="true">›</span>
          </button>
        </div>
      </header>
      <main className={`main-content page-${page} ${cart.carts.length && ["discover","shops","detail"].includes(page) ? "with-borrow-cart" : ""}`}>
        {page === "discover" && <Browse key={browseKey} books={books} booksLoaded={booksLoaded} options={options} optionsStatus={optionsStatus} cart={cart} onShopChange={setCurrentShop} onBrowseShops={() => go("shops")} />}
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
        {page === "publish" && family && <PublishBook
          key={`${family.id}:${publishEditingBook?.id || "new"}`}
          familyId={family.id} book={publishEditingBook} options={options} optionsStatus={optionsStatus}
          series={ownedSeries} seriesStatus={seriesStatus} flash={flash}
          published={message => {
            setEditingBook(null); setPage("library"); setLibraryTab("my"); flash(message);
            void refresh().catch(error => flash(`图书已保存，列表更新失败：${(error as Error).message}`));
          }}
        />}
        {page === "tasks" && <>
          <div className="page-title"><h1>我的借阅</h1><p>先看看需要你处理的事</p></div>
          <div className="tabs borrowing-tabs">{([{value:"progress",label:"进行中"},{value:"done",label:"已结束"},{value:"all",label:"全部"}] as const).map(t=>{
            const count=groupLoans(loans).filter(g=>t.value==="all" || (t.value==="done" ? loanPresentation(g).done : !loanPresentation(g).done)).length;
            return <button key={t.value} aria-pressed={taskTab===t.value} className={taskTab===t.value?"selected":""} onClick={()=>setTaskTab(t.value)}>{t.label}<span className="tab-count">{count}</span></button>;
          })}</div>
          <div className="loan-list">{(() => {
            const rows=groupLoans(loans).filter(g=>taskTab==="all" || (taskTab==="done" ? loanPresentation(g).done : !loanPresentation(g).done)).flat();
            return rows.length ? renderRecords(rows) : <div className="empty-state"><LibraryIcon name="book"/><h3>{taskTab==="done" ? "还没有结束的借阅" : taskTab==="all" ? "还没有借阅记录" : "目前没有进行中的借阅"}</h3><p>选几本喜欢的书，借阅进展会显示在这里。</p><button className="secondary-button" onClick={()=>go("discover")}>去找书</button></div>;
          })()}</div>
        </>}
        {page === "library" && (
          <>
            <div className="page-title">
              <div className="my-library-title"><h1>我的书屋</h1><button className="secondary-button publish-entry" onClick={()=>go("publish")}><LibraryIcon name="plus"/> 发布图书</button></div>
            </div>
            <section className="family-card">
              <FamilyAvatar className="family-avatar" name={family?.displayName || "书"} src={family?.avatarUrl} decorative />
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
                  return <button key={first.groupId || first.id} onClick={() => go("tasks", group.some(loan => active.has(loan.stage)) ? "progress" : "done")}><span><strong>{first.groupId ? `${first.isOwner ? first.borrower : first.owner} · ${group.length}本` : first.bookTitle}</strong><small>{Object.entries(counts).map(([stage,count]) => `${count}本${statusText[stage]}`).join("，")}</small></span><span>›</span></button>;
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
              <div className="avatar-upload">
                <FamilyAvatar className="profile-avatar" name={nickname || family.displayName} src={avatarImage} />
                <div className="avatar-upload-content">
                  <strong>书屋头像</strong>
                  <p>正方形裁剪，方形圆角展示。支持 JPG、PNG、WebP，原图不超过 20 MB，保存后不超过 600 KB。</p>
                  {avatarBytes > 0 && <p>当前头像 {Math.round(avatarBytes / 1000)} KB，保存资料后生效。</p>}
                  <div className="avatar-upload-actions">
                    <input ref={avatarInput} type="file" accept="image/jpeg,image/png,image/webp" className="visually-hidden" aria-label="上传书屋头像" disabled={busy || avatarLoading} onChange={event => { const file = event.target.files?.[0]; if (file) setPendingAvatar(file); event.target.value = ""; }} />
                    <button type="button" className="secondary-button" disabled={busy || avatarLoading} onClick={() => avatarInput.current?.click()}>{avatarImage ? "更换头像" : "上传头像"}</button>
                    {avatarImage && <>
                      <button type="button" className="secondary-button" disabled={busy || avatarLoading} onClick={() => void editAvatar()}>{avatarLoading ? "读取中…" : "重新裁剪"}</button>
                      <button type="button" className="text-button" disabled={busy || avatarLoading} onClick={() => { setAvatarImage(""); setAvatarChanged(true); setAvatarBytes(0); }}>移除头像</button>
                    </>}
                  </div>
                </div>
              </div>
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
                  disabled={busy || avatarLoading}
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
                <InlineChoice label="孩子年龄段" value={childAge} onChange={setChildAge} disabled={optionsStatus !== "ready" || busy}
                  options={catalogChoices(options.ages, childAge)} message={childAgeIssue} />
              </div>
              <button
                className="secondary-button"
                disabled={busy || !childNickname.trim() || !!childAgeIssue}
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
      {pendingAvatar && <CoverCropDialog key={pendingAvatar.name + pendingAvatar.lastModified} kind="avatar" file={pendingAvatar} onClose={() => setPendingAvatar(null)} onUse={(image, bytes) => { setAvatarImage(image); setAvatarBytes(bytes); setAvatarChanged(true); setPendingAvatar(null); }} />}
    </div>
  );
}

export default App;
