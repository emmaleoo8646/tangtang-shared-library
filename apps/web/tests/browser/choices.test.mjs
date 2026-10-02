import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import { expect } from "playwright/test";

const webRoot = fileURLToPath(new URL("../../", import.meta.url));
const base = "http://127.0.0.1:5196";
let server;
let browser;

before(async () => {
  server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5196", "--strictPort"], { cwd: webRoot, stdio: "pipe" });
  let output = "";
  server.stdout.on("data", chunk => { output += chunk; });
  server.stderr.on("data", chunk => { output += chunk; });
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null || attempt === 100) throw new Error(`Preview failed: ${output}`);
    try { if ((await fetch(base)).ok) break; } catch { /* wait for the local preview */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  browser = await (process.env.BROWSER_ENGINE === "webkit" ? webkit : chromium).launch({
    ...(process.env.BROWSER_ENGINE === "webkit" ? {} : { channel: process.env.BROWSER_CHANNEL || "chrome" }), headless: true,
  });
});

after(async () => {
  await browser?.close();
  server?.kill();
});

const option = (id, label, kind, sortOrder, active = true) => ({ id, label, kind, sortOrder, active });
function fixture() {
  const options = {
    categories: [option("category-picture", "绘本", "CATEGORY", 10), option("category-other", "其他", "CATEGORY", 20)],
    ages: [option("age-3-6", "3—6 岁", "AGE", 10), option("age-6-9", "6—9 岁", "AGE", 20)],
    conditions: [option("condition-like-new", "九成新", "CONDITION", 10), option("condition-good", "八成新", "CONDITION", 20)],
  };
  const family = { id: "family-test", username: "test", email: "parent@example.test", phone: "", phoneVerified: false, displayName: "测试书屋", avatarUrl: null, children: [] };
  const book = {
    id: "book-own", shopId: family.id, series: null, seriesOrder: null, status: "AVAILABLE", title: "待编辑的童书", author: "作者",
    category: "绘本", categoryOptionId: "category-picture", age: "3—6 岁", ageOptionId: "age-3-6", condition: "九成新", conditionOptionId: "condition-like-new",
    owner: family.displayName, summary: "一本童书", nonChildren: false, coverUrl: null, available: true, offShelf: false, editable: true, mine: true, tone: "green",
  };
  return { options, family, series: [{ id: "series-one", name: "故事系列" }], books: [book, { ...book, id: "book-other", shopId: "other-family", title: "邻居的童书", mine: false, editable: false }], optionsFailure: false, seriesFailure: false };
}

async function open(width = 390, state = fixture(), cached) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 600, hasTouch: width < 600 });
  const page = await context.newPage();
  const mutations = [];
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.clock.install();
  if (cached) await page.addInitScript(value => sessionStorage.setItem("tt-browse", JSON.stringify(value)), cached);
  await context.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(4);
    const method = request.method();
    if (path === "/options" && state.optionsGate) await state.optionsGate;
    if (method !== "GET") mutations.push({ path, method, data: request.postDataJSON() });
    if ((path === "/options" && state.optionsFailure) || (path === "/series" && state.seriesFailure)) return route.fulfill({ status: 503, json: { message: "模拟加载失败" } });
    if (path === "/options") return route.fulfill({ json: state.options });
    if (path === "/auth/logout") { state.loggedOutFamily = state.family; state.family = null; return route.fulfill({ json: {} }); }
    if (path === "/auth/login") { state.family = state.nextLoginFamily || state.loggedOutFamily; return route.fulfill({ json: {} }); }
    if (path === "/me" && method === "DELETE") { state.family = null; return route.fulfill({ json: {} }); }
    if (path === "/me") return state.family ? route.fulfill({ json: state.family }) : route.fulfill({ status: 401, json: { message: "未登录" } });
    if (path === "/loans") return route.fulfill({ json: [] });
    if (path === "/series") return route.fulfill({ json: state.series });
    if (path === "/me/children" && method === "POST") {
      const data = request.postDataJSON();
      state.family.children.push({ id: "child-test", ...data, age: state.options.ages.find(row => row.id === data.ageOptionId)?.label, readingPreferences: [] });
      return route.fulfill({ json: state.family });
    }
    if (path === "/books/recognize" && state.recognizeGate) await state.recognizeGate;
    if (path === "/books/recognize" && state.recognizeFailure) return route.fulfill({ status: 503, json: { message: "模拟识别失败" } });
    if (path === "/books/recognize") return route.fulfill({ json: state.recognizeResult ?? { title: "AI 填写的童书", author: "AI 作者", category: "其他", summary: "AI 简介", nonChildren: false, sources: [] } });
    if (path === "/books" && method === "POST" && state.publishFailure) return route.fulfill({ status: 503, json: { message: "模拟发布失败" } });
    if (path === "/books/summarize") return route.fulfill({ json: { summary: "单独检索的简介", nonChildren: true, sources: [{ title: "图书资料", url: "https://example.test/book" }] } });
    if ((path === "/books" && method === "POST") || (path === "/books/book-own" && method === "PATCH")) {
      const data = request.postDataJSON();
      const book = { ...state.books[0], ...data, id: method === "PATCH" ? "book-own" : "book-created" };
      if (method === "PATCH") state.books[0] = book; else state.books.push(book);
      if (state.failRefreshAfterPublish) state.optionsFailure = true;
      return route.fulfill({ json: book });
    }
    if (path === "/books" || /^\/shops\/[^/]+\/books$/.test(path)) return route.fulfill({ json: { items: state.books, total: state.books.length, page: 1, pageSize: 200 } });
    if (path.startsWith("/shops/")) return route.fulfill({ json: { id: "other-family", displayName: "邻居书屋", avatarUrl: null } });
    return route.fulfill({ status: 404, json: { message: `Unexpected mock request: ${method} ${path}` } });
  });
  await page.goto(base);
  await expect(page.locator(".role-button")).toContainText("测");
  return { page, context, state, mutations, async close() { await context.close(); assert.deepEqual(errors, []); } };
}

async function library(page) {
  const nav = page.viewportSize().width < 600 ? ".mobile-nav" : ".desktop-nav";
  await page.locator(nav).getByRole("button", { name: "我的书屋", exact: true }).click();
}
async function publish(page, supplement = true) {
  await library(page);
  await page.getByRole("button", { name: "发布图书", exact: true }).click();
  if (supplement && await page.getByRole("button", { name: /补充信息/ }).getAttribute("aria-expanded") === "false") await page.getByRole("button", { name: /补充信息/ }).click();
}
async function choose(page, group, label) {
  const radio = page.getByRole("group", { name: group, exact: true }).getByRole("radio", { name: label, exact: true });
  await radio.locator("..").click();
  await expect(radio).toBeChecked();
}
async function refresh(page) { await page.clock.runFor(20_001); }
async function readyPublish(page) {
  await page.getByLabel("书名", { exact: false }).fill("测试发布的童书");
  await page.getByRole("checkbox", { name: /我已核对/ }).check();
}
async function noOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
}

for (const width of [320, 390, 1440]) test(`all six selectors support selection and save without a custom popup at ${width}px`, async () => {
  const session = await open(width);
  const { page, mutations } = session;
  try {
    const ageFilter = page.getByRole("combobox", { name: "适读年龄", exact: true });
    await ageFilter.selectOption("6—9 岁");
    await expect(ageFilter).toHaveValue("6—9 岁");
    await ageFilter.press("Escape");
    await expect(ageFilter).toHaveValue("6—9 岁");
    await ageFilter.selectOption("全部");
    await page.locator(".role-button").click();
    await choose(page, "孩子年龄段", "6—9 岁");
    await page.getByLabel("孩子昵称").fill("测试昵称");
    await page.getByRole("button", { name: "添加孩子档案" }).click();
    await expect(page.locator(".child-row")).toContainText("6—9 岁");
    assert.equal(mutations.find(row => row.path === "/me/children").data.ageOptionId, "age-6-9");
    await publish(page);
    await page.getByRole("combobox", { name: "图书分类" }).selectOption("category-other");
    await choose(page, "适读年龄", "6—9 岁");
    await choose(page, "新旧程度", "八成新");
    await page.getByRole("combobox", { name: "所属系列（选填）" }).selectOption("series-one");
    await page.getByLabel("系列册序（选填）").fill("2");
    await noOverflow(page);
    for (const chip of await page.locator(".choice-chip > span").all()) assert.ok((await chip.boundingBox()).height >= 44);
    for (const select of await page.locator(".native-choice").all()) assert.ok((await select.boundingBox()).height >= 44);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".borrow-backdrop")).toHaveCount(0);
    await readyPublish(page);
    await page.getByRole("button", { name: "确认发布", exact: true }).click();
    await expect(page.locator(".page-library")).toBeVisible();
    const data = mutations.find(row => row.path === "/books" && row.method === "POST").data;
    assert.deepEqual([data.categoryOptionId, data.ageOptionId, data.conditionOptionId, data.seriesId, data.seriesOrder], ["category-other", "age-6-9", "condition-good", "series-one", "2"]);
  } finally { await session.close(); }
});

test("retired defaults fall back once, polling preserves invalid drafts and recovery requires a new choice", async () => {
  const state = fixture();
  state.options.ages[0].active = false;
  const session = await open(390, state);
  const { page } = session;
  try {
    await page.locator(".role-button").click();
    await expect(page.getByRole("radio", { name: "6—9 岁", exact: true })).toBeChecked();
    await page.getByLabel("孩子昵称").fill("测试昵称");
    await expect(page.getByRole("button", { name: "添加孩子档案" })).toBeEnabled();
    state.options.ages[1].active = false;
    state.options.ages[0].active = true;
    await refresh(page);
    const selected = page.getByRole("radio", { name: "6—9 岁（已停用）", exact: true });
    await expect(selected).toBeChecked();
    await expect(selected).toBeDisabled();
    await expect(page.getByText("所选选项已停用，请重新选择。", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "添加孩子档案" })).toBeDisabled();
    await choose(page, "孩子年龄段", "3—6 岁");
    await expect(page.getByRole("button", { name: "添加孩子档案" })).toBeEnabled();
    await publish(page);
    await readyPublish(page);
    const series = page.getByRole("combobox", { name: "所属系列（选填）" });
    await series.selectOption("series-one");
    state.series = [];
    await refresh(page);
    await expect(page.getByText("所选系列已不存在，请重新选择。", { exact: true })).toBeVisible();
    await expect(series.locator("option:checked")).toHaveText("请选择");
    await expect(page.getByRole("button", { name: "确认发布", exact: true })).toBeDisabled();
    await series.selectOption("");
    await expect(page.getByRole("button", { name: "确认发布", exact: true })).toBeEnabled();
  } finally { await session.close(); }
});

test("editing retains original retired values, but cannot select them again or keep newly retired choices", async () => {
  const state = fixture();
  for (const rows of Object.values(state.options)) rows[0].active = false;
  const session = await open(390, state);
  const { page, mutations } = session;
  try {
    await library(page);
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    const category = page.getByRole("combobox", { name: "图书分类" });
    await expect(category).toHaveValue("category-picture");
    await expect(category.locator("option:checked")).toBeDisabled();
    await expect(page.getByRole("radio", { name: "3—6 岁（已停用）" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "九成新（已停用）" })).toBeChecked();
    await expect(page.getByRole("button", { name: "保存修改", exact: true })).toBeEnabled();
    await choose(page, "适读年龄", "6—9 岁");
    await expect(page.getByRole("radio", { name: "3—6 岁（已停用）" })).toBeDisabled();
    state.options.ages[1].active = false;
    await refresh(page);
    await expect(page.getByRole("radio", { name: "6—9 岁（已停用）" })).toBeChecked();
    await expect(page.getByRole("button", { name: "保存修改", exact: true })).toBeDisabled();
    state.options.ages[1].active = true;
    await refresh(page);
    await page.getByRole("button", { name: "保存修改", exact: true }).click();
    await expect(page.locator(".page-library")).toBeVisible();
    const data = mutations.find(row => row.method === "PATCH").data;
    assert.deepEqual([data.categoryOptionId, data.ageOptionId, data.conditionOptionId], ["category-picture", "age-6-9", "condition-like-new"]);
  } finally { await session.close(); }
});

test("failed and empty options block saving and recover without changing a draft", async () => {
  const state = fixture();
  state.optionsFailure = true;
  const session = await open(390, state);
  const { page } = session;
  try {
    await page.locator(".role-button").click();
    await page.getByLabel("孩子昵称").fill("测试昵称");
    await expect(page.getByText("选项加载失败，请刷新页面重试。", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "添加孩子档案" })).toBeDisabled();
    state.optionsFailure = false;
    await refresh(page);
    await expect(page.getByRole("radio", { name: "3—6 岁", exact: true })).toBeChecked();
    await expect(page.getByRole("button", { name: "添加孩子档案" })).toBeEnabled();
    state.options.ages = [];
    await refresh(page);
    await expect(page.getByText("暂无可用选项，暂时无法保存。", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "添加孩子档案" })).toBeDisabled();
    await publish(page);
    await readyPublish(page);
    await expect(page.getByRole("button", { name: "确认发布", exact: true })).toBeDisabled();
    state.options = fixture().options;
    state.seriesFailure = true;
    await refresh(page);
    await expect(page.getByRole("combobox", { name: "所属系列（选填）" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "确认发布", exact: true })).toBeDisabled();
    state.seriesFailure = false;
    await refresh(page);
    await expect(page.getByRole("button", { name: "确认发布", exact: true })).toBeDisabled();
    await choose(page, "适读年龄", "3—6 岁");
    await expect(page.getByRole("button", { name: "确认发布", exact: true })).toBeEnabled();
  } finally { await session.close(); }
});

test("initial loading blocks selection and saving, then uses the first available configured default", async () => {
  const state = fixture();
  state.options.ages[0].active = false;
  let release;
  state.optionsGate = new Promise(resolve => { release = resolve; });
  const session = await open(390, state);
  const { page } = session;
  try {
    await expect(page.getByRole("combobox", { name: "适读年龄", exact: true })).toBeDisabled();
    await page.locator(".role-button").click();
    await page.getByLabel("孩子昵称").fill("测试昵称");
    await expect(page.getByText("选项加载中…", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "添加孩子档案" })).toBeDisabled();
    await publish(page);
    await readyPublish(page);
    await expect(page.getByRole("combobox", { name: "图书分类" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "确认发布", exact: true })).toBeDisabled();
    release();
    await expect(page.getByRole("radio", { name: "6—9 岁", exact: true })).toBeChecked();
    await expect(page.getByRole("combobox", { name: "图书分类" })).toHaveValue("category-picture");
    await expect(page.getByRole("button", { name: "确认发布", exact: true })).toBeEnabled();
  } finally { release(); await session.close(); }
});

test("expired age and category filters reset the UI and cache; retired book filters still work in shops", async () => {
  const session = await open(390, fixture(), { shopId: "", age: "过期年龄", category: "过期分类", scroll: 300 });
  const { page, state } = session;
  try {
    const age = page.getByRole("combobox", { name: "适读年龄", exact: true });
    await expect(age).toHaveValue("全部");
    await expect(page.getByRole("combobox", { name: "图书分类", exact: true })).toHaveValue("全部");
    await page.clock.runFor(50);
    await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("tt-browse")))).toMatchObject({ age: "全部", category: "全部", scroll: 0 });
    state.options.ages[0].active = false;
    await refresh(page);
    await age.selectOption("3—6 岁");
    await expect(page.locator(".reading-card")).toHaveCount(2);
    state.options.ages[0].label = "改名后的年龄";
    state.options.categories[0].label = "改名后的分类";
    await refresh(page);
    await expect(age).toHaveValue("全部");
    await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("tt-browse")).age)).toBe("全部");
    await page.goto(`${base}/?shop=other-family`);
    await expect(page.locator(".public-shop-banner")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "适读年龄", exact: true })).toBeEnabled();
  } finally { await session.close(); }
});

test("long options, reordered options and many series remain usable; native radio keyboard navigation works", async () => {
  const state = fixture();
  state.options.ages[0].label = "适合亲子共读以及独立阅读的较长年龄选项名称";
  state.series = Array.from({ length: 50 }, (_, i) => ({ id: `series-${i}`, name: `较长的系列名称第${i}套` }));
  const session = await open(320, state);
  const { page } = session;
  try {
    await publish(page);
    await noOverflow(page);
    const group = page.getByRole("group", { name: "适读年龄", exact: true });
    await group.getByRole("radio").first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(group.getByRole("radio", { name: "6—9 岁", exact: true })).toBeChecked();
    state.options.ages.reverse();
    state.options.ages[0].label = "后台改名后的年龄";
    await refresh(page);
    await expect(group.getByRole("radio").first()).toBeChecked();
    await expect(group.getByRole("radio").first()).toHaveAccessibleName("后台改名后的年龄");
    const series = page.getByRole("combobox", { name: "所属系列（选填）" });
    await series.selectOption("series-49");
    await page.getByLabel("系列册序（选填）").fill("9");
    await series.selectOption("");
    await expect(page.getByLabel("系列册序（选填）")).toHaveCount(0);
    await series.selectOption("series-49");
    await expect(page.getByLabel("系列册序（选填）")).toHaveValue("");
    await noOverflow(page);
  } finally { await session.close(); }
});

test("AI cover recognition fills the native category and kept book dialogs still close and unlock scrolling", async () => {
  const session = await open();
  const { page } = session;
  try {
    await page.getByRole("button", { name: "查看邻居的童书详情", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden");
    await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    assert.notEqual(await page.evaluate(() => document.body.style.overflow), "hidden");
    await page.getByRole("button", { name: "查看邻居的童书详情", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await publish(page);
    const png = await page.evaluate(() => { const canvas = document.createElement("canvas"); canvas.width = 120; canvas.height = 180; canvas.getContext("2d").fillRect(0, 0, 120, 180); return canvas.toDataURL("image/png").split(",")[1]; });
    await page.getByLabel("拍照或上传图书封面").setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
    const crop = page.getByRole("dialog", { name: "裁剪封面照片" });
    await expect(crop.getByRole("img", { name: "待裁剪的原始封面" })).toBeVisible();
    await crop.getByRole("button", { name: "预览裁剪结果", exact: true }).click();
    await crop.getByRole("button", { name: "使用此封面", exact: true }).click();
    await expect(page.getByLabel("书名", { exact: false })).toHaveValue("AI 填写的童书");
    await expect(page.getByRole("combobox", { name: "图书分类" })).toHaveValue("category-other");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally { await session.close(); }
});

const draftKey = "tt-publish-draft:family-test";
async function storedDraft(page, key = draftKey) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) || "null")?.draft ?? null, key);
}
async function recognizeCover(page) {
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 120; canvas.height = 180;
    canvas.getContext("2d").fillRect(0, 0, 120, 180);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.getByLabel("拍照或上传图书封面").setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await page.getByRole("dialog", { name: "裁剪封面照片" }).getByRole("button", { name: "使用此封面", exact: true }).click();
}

for (const width of [320, 390, 1440]) test(`publishing starts compact, restores all AI and manual fields after navigation and reload at ${width}px`, async () => {
  const session = await open(width);
  const { page, mutations } = session;
  try {
    await publish(page, false);
    await expect(page.getByRole("button", { name: /补充信息/ })).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel("作者", { exact: true })).toBeHidden();
    await expect(page.locator("#publish-supplement-fields textarea")).toBeHidden();
    await expect(page.getByRole("combobox", { name: "所属系列（选填）" })).toHaveCount(0);
    assert.equal(await storedDraft(page), null, "an untouched form must not overwrite storage");
    await recognizeCover(page);
    await expect(page.getByRole("button", { name: "重新识别", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: /补充信息/ })).toContainText("已有内容");
    await page.clock.runFor(301);
    const recognized = await storedDraft(page);
    assert.deepEqual([recognized.title, recognized.author, recognized.summary, recognized.recognitionSucceeded], ["AI 填写的童书", "AI 作者", "AI 简介", true]);
    assert.match(recognized.coverImage, /^data:image\/jpeg;base64,/);
    await noOverflow(page);
    if (process.env.PUBLISH_SCREENSHOTS) {
      const directory = fileURLToPath(new URL("../../../../Dev-Scratch/screenshots/publish/", import.meta.url));
      await mkdir(directory, { recursive: true });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${directory}${width}-collapsed.png`, fullPage: true });
    }
    await page.getByRole("button", { name: /补充信息/ }).click();
    await expect(page.getByLabel("作者", { exact: true })).toHaveValue("AI 作者");
    await expect(page.locator("#publish-supplement-fields textarea")).toHaveValue("AI 简介");
    await expect(page.getByLabel("系列册序（选填）")).toHaveCount(0);
    await page.getByRole("combobox", { name: "所属系列（选填）" }).selectOption("series-one");
    await page.getByLabel("系列册序（选填）").fill("2");
    await choose(page, "适读年龄", "6—9 岁");
    await choose(page, "新旧程度", "八成新");
    await page.locator("#publish-supplement-fields textarea").fill("家长核对后的简介");
    await page.getByRole("checkbox", { name: /我已核对/ }).check();
    await noOverflow(page);
    if (process.env.PUBLISH_SCREENSHOTS) {
      const directory = fileURLToPath(new URL("../../../../Dev-Scratch/screenshots/publish/", import.meta.url));
      await page.clock.runFor(301);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${directory}${width}-expanded.png`, fullPage: true });
    }
    await publish(page, false);
    await expect(page.getByLabel("书名", { exact: false })).toHaveValue("AI 填写的童书");
    await expect(page.getByRole("checkbox", { name: /我已核对/ })).not.toBeChecked();
    const saved = await storedDraft(page);
    assert.deepEqual([saved.summary, saved.ageOptionId, saved.conditionOptionId, saved.seriesId, saved.seriesOrder], ["家长核对后的简介", "age-6-9", "condition-good", "series-one", "2"]);
    await page.getByLabel("书名", { exact: false }).fill("刷新前最后一次输入");
    await page.reload();
    await expect(page.locator(".role-button")).toContainText("测");
    await publish(page);
    await expect(page.getByLabel("书名", { exact: false })).toHaveValue("刷新前最后一次输入");
    await expect(page.getByLabel("作者", { exact: true })).toHaveValue("AI 作者");
    await expect(page.locator("#publish-supplement-fields textarea")).toHaveValue("家长核对后的简介");
    await expect(page.getByLabel("系列册序（选填）")).toHaveValue("2");
    await expect(page.getByRole("button", { name: "重新识别", exact: true })).toBeEnabled();
    await expect(page.locator(".cover-upload-preview img")).toHaveAttribute("src", recognized.coverImage);
    assert.equal(mutations.filter(row => row.path === "/books/recognize").length, 1, "restoring must not request recognition again");
    await page.getByRole("checkbox", { name: /我已核对/ }).check();
    await page.getByRole("button", { name: "确认发布", exact: true }).click();
    await expect(page.locator(".page-library")).toBeVisible();
    assert.equal(await storedDraft(page), null);
    const submitted = mutations.find(row => row.path === "/books" && row.method === "POST").data;
    assert.equal(submitted.coverImage, recognized.coverImage);
    assert.equal(submitted.author, "AI 作者");
    assert.equal(submitted.summary, "家长核对后的简介");
    await publish(page, false);
    await expect(page.getByLabel("书名", { exact: false })).toHaveValue("");
    assert.equal(await storedDraft(page), null);
  } finally { await session.close(); }
});

test("closing and reopening a browser tab restores its family draft", async () => {
  const session = await open();
  try {
    await publish(session.page, false);
    await session.page.getByLabel("书名", { exact: false }).fill("关闭前的童书");
    // pagehide flushes even before the debounce completes.
    await session.page.goto("about:blank");
    await session.page.close();
    const reopened = await session.context.newPage();
    await reopened.goto(base);
    await expect(reopened.locator(".role-button")).toContainText("测");
    await publish(reopened, false);
    await expect(reopened.getByLabel("书名", { exact: false })).toHaveValue("关闭前的童书");
  } finally { await session.close(); }
});

test("failed publication keeps the draft, while success clears it even when refreshing the list fails", async () => {
  const session = await open();
  const { page, state } = session;
  try {
    await publish(page, false); await readyPublish(page);
    state.publishFailure = true;
    await page.getByRole("button", { name: "确认发布", exact: true }).click();
    await expect(page.locator(".toast")).toContainText("模拟发布失败");
    await publish(page, false);
    await expect(page.getByLabel("书名", { exact: false })).toHaveValue("测试发布的童书");
    state.publishFailure = false; state.failRefreshAfterPublish = true;
    await page.getByRole("checkbox", { name: /我已核对/ }).check();
    await page.getByRole("button", { name: "确认发布", exact: true }).click();
    await expect(page.locator(".page-library")).toBeVisible();
    await expect(page.locator(".toast")).toContainText("列表更新失败");
    assert.equal(await storedDraft(page), null);
  } finally { await session.close(); }
});

test("editing and saving an existing book never overwrites or clears the new-book draft", async () => {
  const session = await open();
  const { page } = session;
  try {
    await publish(page, false);
    await page.getByLabel("书名", { exact: false }).fill("未发布的新书");
    await library(page);
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(page.getByLabel("书名", { exact: false })).toHaveValue("待编辑的童书");
    await page.getByLabel("书名", { exact: false }).fill("修改既有图书");
    await page.getByRole("button", { name: "保存修改", exact: true }).click();
    await expect(page.locator(".page-library")).toBeVisible();
    assert.equal((await storedDraft(page)).title, "未发布的新书");
    await publish(page, false);
    await expect(page.getByLabel("书名", { exact: false })).toHaveValue("未发布的新书");
  } finally { await session.close(); }
});

test("clear cancels delayed recognition and returns to a blank form without recreating the draft", async () => {
  const session = await open();
  const { page, state, mutations } = session;
  let release;
  try {
    await publish(page, false);
    state.recognizeGate = new Promise(resolve => { release = resolve; });
    await recognizeCover(page);
    await expect.poll(() => mutations.filter(row => row.path === "/books/recognize").length).toBe(1);
    page.once("dialog", dialog => dialog.dismiss());
    await page.getByRole("button", { name: "清空草稿" }).click();
    await expect(page.locator(".cover-upload-preview img")).toBeVisible();
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "清空草稿" }).click();
    release();
    await page.clock.runFor(1000);
    await expect(page.getByLabel("书名", { exact: false })).toHaveValue("");
    await expect(page.locator(".cover-upload-preview img")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /AI 识别并填写/ })).toBeDisabled();
    assert.equal(await storedDraft(page), null);
    await publish(page, false);
    await expect(page.getByLabel("书名", { exact: false })).toHaveValue("");
  } finally { release?.(); await session.close(); }
});

test("standalone AI summaries and their audience flag and sources are saved while supplemental fields are collapsed", async () => {
  const session = await open();
  const { page } = session;
  try {
    await publish(page); await readyPublish(page);
    await page.getByRole("button", { name: /AI 检索并生成/ }).click();
    await expect(page.locator("#publish-supplement-fields textarea")).toHaveValue("单独检索的简介");
    await page.getByRole("button", { name: /补充信息/ }).click();
    await expect(page.getByRole("button", { name: /补充信息/ })).toContainText("已标记非儿童读物");
    await publish(page);
    await expect(page.locator("#publish-supplement-fields textarea")).toHaveValue("单独检索的简介");
    await expect(page.getByRole("checkbox", { name: /非儿童读物/ })).toBeChecked();
    await expect(page.getByRole("link", { name: "图书资料" })).toHaveAttribute("href", "https://example.test/book");
  } finally { await session.close(); }
});

test("storage failures remain visible and never lose in-memory input or pretend the draft was saved", async () => {
  const session = await open();
  const { page } = session;
  try {
    await page.evaluate(() => {
      window.__originalDraftWriter = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key.startsWith("tt-publish-draft:")) throw new DOMException("Full", "QuotaExceededError");
        return window.__originalDraftWriter.call(this, key, value);
      };
    });
    await publish(page, false);
    await page.getByLabel("书名", { exact: false }).fill("存储失败仍保留");
    await page.clock.runFor(301);
    await expect(page.locator(".publish-draft-status")).toContainText("未能读取或保存");
    await expect(page.getByLabel("书名", { exact: false })).toHaveValue("存储失败仍保留");
    await publish(page, false);
    await expect(page.getByLabel("书名", { exact: false })).toHaveValue("存储失败仍保留");
    await page.evaluate(() => { Storage.prototype.setItem = window.__originalDraftWriter; });
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    assert.equal((await storedDraft(page)).title, "存储失败仍保留");
  } finally { await session.close(); }
});

test("logout preserves a draft and accounts cannot see or overwrite each other's drafts", async () => {
  const session = await open();
  const { page, state } = session;
  const firstFamily = state.family;
  async function signOut() {
    await page.locator(".role-button").click();
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await expect(page.locator(".role-button")).toContainText("家长登录");
  }
  async function signIn(family) {
    state.nextLoginFamily = family;
    await page.locator(".role-button").click();
    const dialog = page.getByRole("dialog", { name: "欢迎回来" });
    await dialog.getByLabel("账号或邮箱").fill("test-account");
    await dialog.getByLabel("密码", { exact: true }).fill("fixture-password");
    await dialog.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.locator(".role-button")).toContainText(family.displayName);
  }
  try {
    await publish(page, false);
    await page.getByLabel("书名", { exact: false }).fill("第一个账号的草稿");
    await signOut();
    assert.equal((await storedDraft(page)).title, "第一个账号的草稿");
    await signIn({ ...firstFamily, id: "family-second", displayName: "第二个书屋" });
    await publish(page, false);
    await expect(page.getByLabel("书名", { exact: false })).toHaveValue("");
    await page.getByLabel("书名", { exact: false }).fill("第二个账号的草稿");
    await signOut();
    assert.equal((await storedDraft(page, "tt-publish-draft:family-second")).title, "第二个账号的草稿");
    await signIn(firstFamily);
    await publish(page, false);
    await expect(page.getByLabel("书名", { exact: false })).toHaveValue("第一个账号的草稿");
  } finally { await session.close(); }
});

test("restoring retired choices and a deleted series preserves values and reveals validation inside supplemental fields", async () => {
  const session = await open();
  const { page, state } = session;
  try {
    await publish(page);
    await page.getByLabel("书名", { exact: false }).fill("保留失效选项的草稿");
    await page.getByRole("combobox", { name: "所属系列（选填）" }).selectOption("series-one");
    await page.getByLabel("系列册序（选填）").fill("3");
    await library(page);
    state.options.ages[0].active = false; state.series = [];
    await page.reload();
    await expect(page.locator(".role-button")).toContainText("测");
    await publish(page, false);
    await expect(page.getByRole("radio", { name: "3—6 岁（已停用）", exact: true })).toBeChecked();
    await expect(page.getByRole("button", { name: /补充信息/ })).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("所选系列已不存在，请重新选择。", { exact: true })).toBeVisible();
    await expect(page.getByLabel("系列册序（选填）")).toHaveValue("3");
    await expect(page.getByRole("button", { name: "确认发布", exact: true })).toBeDisabled();
    assert.equal((await storedDraft(page)).ageOptionId, "age-3-6");
    await choose(page, "适读年龄", "6—9 岁");
    await page.getByRole("combobox", { name: "所属系列（选填）" }).selectOption("");
    await expect(page.getByLabel("系列册序（选填）")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "确认发布", exact: true })).toBeEnabled();
  } finally { await session.close(); }
});

test("recognition success follows a confirmed title, including a partial summary failure, and replacing a cover resets it", async () => {
  const session = await open();
  const { page, state } = session;
  try {
    await publish(page, false);
    state.recognizeResult = { title: "", author: "", category: "其他", summary: "", sources: [], notice: "未能从封面确认书名，请手动填写" };
    await recognizeCover(page);
    await expect(page.getByText("未能从封面确认书名，请手动填写", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /AI 识别并填写/ })).toBeEnabled();
    state.recognizeResult = { ...state.recognizeResult, title: "封面确认的书名", notice: "已识别封面；简介暂未查到可靠资料，可手动填写或稍后重试" };
    await page.getByRole("button", { name: /AI 识别并填写/ }).click();
    await expect(page.getByRole("button", { name: "重新识别", exact: true })).toBeEnabled();
    await expect(page.getByText(/简介暂未查到可靠资料/)).toBeVisible();
    state.recognizeFailure = true;
    await recognizeCover(page);
    await expect(page.getByText("自动识别暂未完成，可手动填写，或点击按钮重试。", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /AI 识别并填写/ })).toBeEnabled();
  } finally { await session.close(); }
});

test("leaving during recognition saves the cover and ignores late results after entering a new account", async () => {
  const session = await open();
  const { page, state, mutations } = session;
  let release;
  try {
    await publish(page, false);
    await page.getByLabel("书名", { exact: false }).fill("家长手填的书名");
    state.recognizeGate = new Promise(resolve => { release = resolve; });
    await recognizeCover(page);
    await expect.poll(() => mutations.filter(row => row.path === "/books/recognize").length).toBe(1);
    await library(page);
    const first = await storedDraft(page);
    assert.equal(first.title, "家长手填的书名");
    assert.match(first.coverImage, /^data:image\/jpeg;base64,/);
    state.family = { ...state.family, id: "family-second", displayName: "第二个书屋" };
    await refresh(page);
    await expect(page.locator(".role-button")).toContainText("第二个书屋");
    await publish(page, false);
    await page.getByLabel("书名", { exact: false }).fill("第二个账号的内容");
    release();
    await page.clock.runFor(301);
    await expect(page.getByLabel("书名", { exact: false })).toHaveValue("第二个账号的内容");
    assert.equal((await storedDraft(page)).title, "家长手填的书名");
  } finally { release?.(); await session.close(); }
});

test("successful account deletion removes its local draft", async () => {
  const session = await open();
  const { page } = session;
  try {
    await publish(page, false);
    await page.getByLabel("书名", { exact: false }).fill("注销时清除的草稿");
    await page.locator(".role-button").click();
    assert.ok(await storedDraft(page));
    await page.getByRole("button", { name: "注销家庭书屋", exact: true }).click();
    await page.getByRole("button", { name: "我已了解，继续注销", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "确认注销家庭书屋？" });
    await dialog.getByPlaceholder("测试书屋").fill("测试书屋");
    await dialog.getByRole("button", { name: "永久注销", exact: true }).click();
    await expect(page.locator(".role-button")).toContainText("家长登录");
    assert.equal(await storedDraft(page), null);
  } finally { await session.close(); }
});
