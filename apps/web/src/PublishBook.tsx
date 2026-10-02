import { useEffect, useRef, useState } from "react";
import { api, type Book, type OptionLists } from "./api";
import { InlineChoice, NativeSelect } from "./components/Choices";
import { AiBusyNote } from "./components/AiBusyNote";
import { CoverCropDialog } from "./CoverCropDialog";
import { catalogChoices, catalogChoiceIssue, choicesStatusMessage, type ChoicesStatus } from "./choicePresentation";
import { bookPublishDraft, clearPublishDraft, emptyPublishDraft, readPublishDraft, savePublishDraft, type PublishDraft } from "./publishDraft";

type Props = {
  familyId: string;
  book: Book | null;
  options: OptionLists;
  optionsStatus: ChoicesStatus;
  series: { id: string; name: string }[];
  seriesStatus: ChoicesStatus;
  flash: (message: string) => void;
  published: (message: string) => void;
};

export function PublishBook({ familyId, book, options, optionsStatus, series, seriesStatus, flash, published }: Props) {
  const [initial] = useState(() => {
    const restored = book ? { draft: null, error: false } : readPublishDraft(familyId);
    return { ...restored, value: book ? bookPublishDraft(book) : restored.draft ?? emptyPublishDraft(options) };
  });
  const [draft, setDraft] = useState(initial.value);
  const [saveStatus, setSaveStatus] = useState<"empty" | "saving" | "saved" | "error">(initial.error ? "error" : initial.draft ? "saved" : "empty");
  const [busy, setBusy] = useState(false);
  const [coverChanged, setCoverChanged] = useState(!book && !!draft.coverImage);
  const [pendingCover, setPendingCover] = useState<File | null>(null);
  const [privacyConfirmed, setPrivacyConfirmed] = useState(!!book);
  const [supplementOpen, setSupplementOpen] = useState(false);
  const [assistBusy, setAssistBusy] = useState<"recognize" | "summarize" | null>(null);
  const [recognizeNotice, setRecognizeNotice] = useState("");
  const [summarizeNotice, setSummarizeNotice] = useState("");
  const coverInput = useRef<HTMLInputElement>(null);
  const assistRequest = useRef(0);
  const mounted = useRef(false);
  const choicesInitialized = useRef(!!book || !!initial.draft || optionsStatus === "ready");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useRef({ draft, dirty: !!initial.draft, stopped: false });
  current.current.draft = draft;

  function stopTimer() {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
  }
  function persist(notify: boolean) {
    stopTimer();
    if (book || !current.current.dirty || current.current.stopped) return;
    const saved = savePublishDraft(familyId, current.current.draft);
    if (notify && mounted.current) setSaveStatus(saved ? "saved" : "error");
  }
  function update(value: Partial<PublishDraft>) {
    current.current.dirty = true;
    if (!book) setSaveStatus("saving");
    setDraft(previous => ({ ...previous, ...value }));
  }
  useEffect(() => {
    mounted.current = true;
    const hide = () => persist(true);
    const visibility = () => { if (document.visibilityState === "hidden") persist(true); };
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      mounted.current = false;
      assistRequest.current++;
      persist(false);
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    if (book || !current.current.dirty || current.current.stopped) return;
    saveTimer.current = window.setTimeout(() => persist(true), 300);
    return stopTimer;
  }, [draft]);
  useEffect(() => {
    if (optionsStatus !== "ready" || choicesInitialized.current) return;
    choicesInitialized.current = true;
    const defaults = emptyPublishDraft(options);
    setDraft(previous => ({ ...previous, categoryOptionId: defaults.categoryOptionId,
      ageOptionId: defaults.ageOptionId, conditionOptionId: defaults.conditionOptionId }));
  }, [optionsStatus, options]);

  const categoryIssue = catalogChoiceIssue(options.categories, draft.categoryOptionId, optionsStatus, book?.categoryOptionId ?? undefined);
  const ageIssue = catalogChoiceIssue(options.ages, draft.ageOptionId, optionsStatus, book?.ageOptionId ?? undefined);
  const conditionIssue = catalogChoiceIssue(options.conditions, draft.conditionOptionId, optionsStatus, book?.conditionOptionId);
  const seriesIssue = choicesStatusMessage(seriesStatus) || (draft.seriesId && !series.some(row => row.id === draft.seriesId) ? "所选系列已不存在，请重新选择。" : "");
  const publishIssue = categoryIssue || ageIssue || conditionIssue || seriesIssue;
  const showSupplement = supplementOpen || !!seriesIssue && seriesStatus !== "loading";
  const hasSupplement = !!(draft.author || draft.summary || draft.seriesId || draft.nonChildren || draft.sources.length);

  function discard() {
    if (!window.confirm("确定清空这份未发布草稿吗？")) return;
    if (!clearPublishDraft(familyId)) { setSaveStatus("error"); flash("草稿未能清除，请稍后重试。"); return; }
    stopTimer();
    assistRequest.current++;
    const empty = emptyPublishDraft(options);
    current.current = { draft: empty, dirty: false, stopped: false };
    setDraft(empty); setSaveStatus("empty"); setCoverChanged(false); setPendingCover(null);
    setPrivacyConfirmed(false); setSupplementOpen(false); setAssistBusy(null);
    setRecognizeNotice(""); setSummarizeNotice("");
  }

  async function recognize(image = draft.coverImage) {
    if (!image) return;
    const requestId = ++assistRequest.current;
    setAssistBusy("recognize");
    setRecognizeNotice("正在识别封面并检索图书资料，简介会自动填写…");
    try {
      const result = await api<{ title: string; author: string; category: string; summary: string; nonChildren?: boolean; sources: { title: string; url: string }[]; notice?: string }>("/books/recognize", "POST", { coverImage: image });
      if (requestId !== assistRequest.current) return;
      const category = options.categories.find(option => option.active && option.label === result.category);
      update({
        ...(result.title ? { title: result.title } : {}), ...(result.author ? { author: result.author } : {}),
        ...(category ? { categoryOptionId: category.id } : {}), ...(result.summary ? { summary: result.summary } : {}),
        ...(typeof result.nonChildren === "boolean" ? { nonChildren: result.nonChildren } : {}),
        sources: result.sources, recognitionSucceeded: !!result.title.trim(),
      });
      setRecognizeNotice(result.notice || (result.title.trim() ? "" : "未能从封面确认书名，请手动填写或重试。"));
    } catch (error) {
      if (requestId === assistRequest.current) {
        setRecognizeNotice("自动识别暂未完成，可手动填写，或点击按钮重试。"); flash((error as Error).message);
      }
    } finally { if (requestId === assistRequest.current) setAssistBusy(null); }
  }

  async function generateSummary() {
    if (!draft.title.trim() || assistBusy) return;
    const requestId = ++assistRequest.current;
    setAssistBusy("summarize"); setSummarizeNotice("正在检索图书资料并撰写简介…");
    try {
      const result = await api<{ summary: string; nonChildren: boolean; sources: { title: string; url: string }[] }>("/books/summarize", "POST", { title: draft.title, author: draft.author });
      if (requestId !== assistRequest.current) return;
      update({ summary: result.summary, nonChildren: result.nonChildren, sources: result.sources });
      setSummarizeNotice("已检索图书资料，请核对简介内容。");
    } catch (error) {
      if (requestId === assistRequest.current) {
        setSummarizeNotice("AI 检索简介暂未完成，可手动填写或调整书名/作者后重试。"); flash((error as Error).message);
      }
    } finally { if (requestId === assistRequest.current) setAssistBusy(null); }
  }

  async function publish() {
    if (busy || assistBusy) return;
    if (publishIssue) { flash(publishIssue); return; }
    if (!privacyConfirmed) { flash("请先确认图书信息与隐私"); return; }
    setBusy(true);
    try {
      await api(book ? `/books/${book.id}` : "/books", book ? "PATCH" : "POST", {
        title: draft.title, author: draft.author, summary: draft.summary, nonChildren: draft.nonChildren,
        categoryOptionId: draft.categoryOptionId, ageOptionId: draft.ageOptionId, conditionOptionId: draft.conditionOptionId,
        seriesId: draft.seriesId || null, seriesOrder: draft.seriesId ? draft.seriesOrder || null : null,
        coverImage: coverChanged ? draft.coverImage : undefined, privacyConfirmed,
      });
      current.current.stopped = true;
      stopTimer();
      const cleared = book || clearPublishDraft(familyId);
      if (mounted.current) published(book ? "图书信息已更新" : cleared ? "图书已发布" : "图书已发布，但本机草稿未能清除，请检查浏览器存储权限。");
    } catch (error) { if (mounted.current) flash((error as Error).message); }
    finally { if (mounted.current) setBusy(false); }
  }

  return <>
    <div className="page-title">
      <p className="eyebrow">{book ? "整理我的藏书" : "把好故事分享出去"}</p>
      <h1>{book ? "编辑图书" : "发布一本童书"}</h1>
      <p>{book ? "修改书的信息与封面，保存后会更新展示。" : "拍一张封面，快速填写图书信息；发布前请家长认真核对。"}</p>
    </div>
    {!book && <div className={`publish-draft-status${saveStatus === "error" ? " publish-draft-status--error" : ""}`}>
      <span role="status">{saveStatus === "saved" ? "✓ 草稿已保存到当前设备" : saveStatus === "saving" ? "正在保存草稿…" : saveStatus === "error" ? "草稿未能读取或保存，当前填写仍保留，请勿关闭页面。" : "填写后自动保存草稿，离开后可继续填写"}</span>
      <button type="button" className="text-button" disabled={busy} onClick={discard}>清空草稿</button>
    </div>}
    <div className="publish-layout">
      <div className="publish-form">
        <div className="form-section-head"><span className="step-number">1</span><div><h2>图书信息</h2><p>所有信息都由家长确认后才展示。</p></div></div>
        <fieldset className="publish-fields" disabled={busy}>
          <div className="cover-upload">
            <div className="cover-upload-preview">{draft.coverImage ? <img src={draft.coverImage} alt="待发布的图书封面" /> : <span aria-hidden="true">▧</span>}</div>
            <div className="cover-upload-content">
              <strong>{draft.recognitionSucceeded ? "✓ 封面已识别" : "添加封面照片"}</strong>
              <p>{draft.recognitionSucceeded ? "已填写图书信息，作者和简介可在补充信息中核对。" : "拍照或上传清晰封面，确认范围后自动识别书名并填写简介。"}{coverChanged && draft.coverBytes ? `当前封面 ${Math.round(draft.coverBytes / 1000)} KB。` : ""}</p>
              <div className="cover-upload-actions">
                <input ref={coverInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="visually-hidden" aria-label="拍照或上传图书封面" onChange={event => { setPendingCover(event.target.files?.[0] ?? null); event.target.value = ""; }} />
                <button type="button" className="secondary-button" onClick={() => coverInput.current?.click()}>{draft.coverImage ? "更换照片" : "拍照 / 上传"}</button>
                <button type="button" className="ai-button" disabled={!coverChanged || !!assistBusy} onClick={() => void recognize()}>{assistBusy === "recognize" ? "识别中…" : draft.recognitionSucceeded ? "重新识别" : "✦ AI 识别并填写"}</button>
              </div>
            </div>
          </div>
          <AiBusyNote text={recognizeNotice} busy={assistBusy === "recognize"} errorText="自动识别暂未完成，可手动填写，或点击按钮重试。" />
          <div className="field-grid">
            <label><span className="field-label">书名 <b>*</b></span><input value={draft.title} maxLength={100} onChange={event => update({ title: event.target.value })} /></label>
            <NativeSelect label="图书分类" value={draft.categoryOptionId} onChange={value => update({ categoryOptionId: value })} disabled={optionsStatus !== "ready" || busy} options={catalogChoices(options.categories, draft.categoryOptionId, book?.categoryOptionId ?? undefined)} message={categoryIssue} />
            <InlineChoice label="适读年龄" value={draft.ageOptionId} onChange={value => update({ ageOptionId: value })} disabled={optionsStatus !== "ready" || busy} options={catalogChoices(options.ages, draft.ageOptionId, book?.ageOptionId ?? undefined)} message={ageIssue} />
            <InlineChoice label="新旧程度" value={draft.conditionOptionId} onChange={value => update({ conditionOptionId: value })} disabled={optionsStatus !== "ready" || busy} options={catalogChoices(options.conditions, draft.conditionOptionId, book?.conditionOptionId)} message={conditionIssue} />
          </div>
          <section className="publish-supplement">
            <button type="button" className="publish-supplement-toggle" aria-expanded={showSupplement} aria-controls="publish-supplement-fields" onClick={() => setSupplementOpen(!showSupplement)}>
              <span><strong>补充信息（选填）</strong><small>作者、简介、系列等{draft.nonChildren ? " · 已标记非儿童读物" : ""}</small></span>
              <span className="publish-supplement-indicator">{hasSupplement && <small>已有内容</small>}<span aria-hidden="true">{showSupplement ? "⌃" : "⌄"}</span></span>
            </button>
            <div id="publish-supplement-fields" hidden={!showSupplement}>
              <div className="field-grid">
                <label>作者<input value={draft.author} maxLength={100} onChange={event => update({ author: event.target.value })} placeholder="不确定可留空" /></label>
                <NativeSelect label="所属系列（选填）" value={draft.seriesId} onChange={value => update({ seriesId: value, seriesOrder: value ? draft.seriesOrder : "" })} disabled={seriesStatus !== "ready" || busy} message={seriesIssue} options={[{ value: "", label: "单本图书" }, ...series.map(item => ({ value: item.id, label: item.name }))]} />
                {draft.seriesId && <label>系列册序（选填）<input type="number" min="1" max="10000" value={draft.seriesOrder} onChange={event => update({ seriesOrder: event.target.value })} placeholder="例如 1" /></label>}
                <div className="full-field summary-field">
                  <div className="summary-label"><label htmlFor="publish-summary">简单介绍</label><button type="button" disabled={!draft.title.trim() || !!assistBusy} onClick={() => void generateSummary()}>{assistBusy === "summarize" ? "检索中…" : "✦ AI 检索并生成"}</button></div>
                  <textarea id="publish-summary" value={draft.summary} maxLength={1000} onChange={event => update({ summary: event.target.value })} rows={4} placeholder="说说这本书的故事、主题或孩子喜欢它的原因" />
                  <AiBusyNote text={summarizeNotice} busy={assistBusy === "summarize"} errorText="AI 检索简介暂未完成，可手动填写或调整书名/作者后重试。" />
                </div>
              </div>
              <label className="audience-check"><input type="checkbox" checked={draft.nonChildren} onChange={event => update({ nonChildren: event.target.checked })} /><span><strong>非儿童读物</strong><small>AI 会依据检索资料标记；如果判断有误，可以手动调整。标记不会阻止发布。</small></span></label>
              {draft.sources.length > 0 && <div className="summary-sources"><span>资料来源：</span>{draft.sources.map((source, index) => <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>)}</div>}
            </div>
          </section>
          <label className="confirm-check"><input type="checkbox" checked={privacyConfirmed} onChange={event => setPrivacyConfirmed(event.target.checked)} />我已核对图书信息，内容不含孩子姓名、电话或住址</label>
          <button className="primary-button" disabled={busy || !!assistBusy || !draft.title.trim() || !!publishIssue} onClick={() => void publish()}>{book ? "保存修改" : "确认发布"}</button>
        </fieldset>
      </div>
      <aside className="publish-aside">
        <div className="aside-cover"><span>✦</span><strong>一本闲置书<br />下一段新旅程</strong></div>
        <h3>发布后会怎样？</h3><ol><li>其他家庭可在找书页看到这本书</li><li>申请后由你确认交接地点并同意</li><li>借方取书后确认，归还时由你确认收回</li></ol>
      </aside>
    </div>
    {pendingCover && <CoverCropDialog file={pendingCover} onClose={() => setPendingCover(null)} onUse={(image, bytes) => {
      update({ coverImage: image, coverBytes: bytes, recognitionSucceeded: false, nonChildren: false });
      setCoverChanged(true); setPendingCover(null); setSummarizeNotice(""); void recognize(image);
    }} />}
  </>;
}
