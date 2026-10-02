import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import { expect } from "playwright/test";
import { homeCatalog } from "./fixtures/home-catalog.mjs";

const webRoot = fileURLToPath(new URL("../../", import.meta.url));
const screenshotRoot = fileURLToPath(new URL("../../../../Dev-Scratch/mobile-home-review/", import.meta.url));
const base = "http://127.0.0.1:5198";
let server, browser;

before(async () => {
  server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5198", "--strictPort"], { cwd: webRoot, stdio: "pipe" });
  let output = "";
  server.stdout.on("data", chunk => { output += chunk; });
  server.stderr.on("data", chunk => { output += chunk; });
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null || attempt === 100) throw new Error(`Preview failed: ${output}`);
    try { if ((await fetch(base)).ok) break; } catch { /* wait for Vite */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  browser = await (process.env.BROWSER_ENGINE === "webkit" ? webkit : chromium).launch({
    ...(process.env.BROWSER_ENGINE === "webkit" ? {} : { channel: process.env.BROWSER_CHANNEL || "chrome" }), headless: true,
  });
  if (process.env.HOME_SCREENSHOTS) await mkdir(screenshotRoot, { recursive: true });
});
after(async () => { await browser?.close(); server?.kill(); });

async function open({ width = 390, height = 844, state = homeCatalog(), cached, shop = "", guest = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: width <= 700, hasTouch: width <= 700 });
  const page = await context.newPage();
  const errors = [], mutations = [];
  page.on("pageerror", error => errors.push(error.message));
  if (cached) await page.addInitScript(value => sessionStorage.setItem("tt-browse", JSON.stringify(value)), cached);
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(4);
    if (request.method() !== "GET") mutations.push(path);
    if (path === "/options" && state.optionsGate) await state.optionsGate;
    if (path === "/options") return route.fulfill(state.optionsFailure ? { status: 503, json: { message: "模拟选项失败" } } : { json: state.options });
    if (path === "/me") return route.fulfill(guest ? { status: 401, json: { message: "未登录" } } : { json: state.family });
    if (["/loans", "/series"].includes(path)) return route.fulfill({ json: [] });
    if (path === "/books" || /^\/shops\/[^/]+\/books$/.test(path)) {
      const shopId = path.split("/")[2];
      const items = path === "/books" ? state.books : state.books.filter(book => book.shopId === shopId);
      return route.fulfill({ json: { items, total: items.length, page: 1, pageSize: 200 } });
    }
    if (path.startsWith("/shops/")) return route.fulfill({ json: state.shops.find(row => row.id === path.split("/")[2]) });
    return route.fulfill({ status: 404, json: { message: `Unexpected mock request: ${path}` } });
  });
  await page.goto(`${base}/${shop ? `?shop=${shop}` : ""}`);
  await expect(page.locator(".reading-card")).toHaveCount(shop ? 4 : new Set(state.books.map(book => book.series?.id || book.id)).size);
  return { page, state, mutations, async close() { await context.close(); assert.deepEqual(errors, []); assert.deepEqual(mutations, []); } };
}

async function screenshot(page, name, fullPage = false) {
  if (process.env.HOME_SCREENSHOTS) await page.screenshot({ path: `${screenshotRoot}/${process.env.BROWSER_ENGINE || "chromium"}-${name}.png`, fullPage });
}
async function noOverflow(page) {
  const layout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    wide: [...document.querySelectorAll("body *")].filter(element => {
      const box = element.getBoundingClientRect();
      return box.width && (box.x < 0 || box.right > innerWidth + 1);
    }).map(element => ({ tag: element.tagName, class: element.className, width: element.getBoundingClientRect().width })).slice(0, 12),
  }));
  assert.equal(layout.overflow, false, JSON.stringify(layout.wide));
}
async function recommendationsAfter(page, count) {
  const grid = page.locator(".reading-grid");
  const cards = grid.locator(":scope > .reading-card");
  const rec = page.getByRole("region", { name: "推荐书屋" });
  await expect(rec).toHaveCount(1);
  const priorCards = await rec.evaluate(element => [...element.parentElement.children].slice(0, [...element.parentElement.children].indexOf(element)).filter(row => row.classList.contains("reading-card")).length);
  assert.equal(priorCards, count);
  if (count) assert.ok((await rec.boundingBox()).y >= (await cards.nth(count - 1).boundingBox()).y + (await cards.nth(count - 1).boundingBox()).height);
}

for (const width of [320, 390, 700, 701, 1440]) test(`homepage layout and accessible controls at ${width}px`, async () => {
  const session = await open({ width, guest: true });
  const { page } = session;
  try {
    const mobile = width <= 700;
    await expect(page.getByRole("combobox", { name: "适读年龄", exact: true })).toHaveCount(1);
    await expect(page.getByRole("checkbox", { name: "只看可借", exact: true })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    if (mobile) {
      await expect(page.getByRole("heading", { name: "分享童书 · 免费借阅" })).toBeVisible();
      const category = page.getByRole("combobox", { name: "图书分类", exact: true });
      const age = page.getByRole("combobox", { name: "适读年龄", exact: true });
      const c = await category.boundingBox(), a = await age.boundingBox();
      assert.equal(c.y, a.y);
      assert.ok(c.x + c.width < a.x);
      assert.ok(c.height >= 44 && a.height >= 44);
      await expect(category.locator("option:checked")).toHaveText("全部分类");
      await expect(age.locator("option:checked")).toHaveText("全部年龄");
      await expect(page.locator(".home-results-heading").getByRole("checkbox")).toBeVisible();
      await expect(page.locator(".category-pills")).toBeHidden();
      await recommendationsAfter(page, 4);
      if (width === 390) {
        const navTop = (await page.locator(".mobile-nav").boundingBox()).y;
        for (const card of await page.locator(".reading-card").all().then(rows => rows.slice(0, 2))) {
          for (const element of [card.locator("h3"), card.locator(".series-buttons")]) {
            const box = await element.boundingBox();
            assert.ok(box.y + box.height <= navTop, `First-row content obscured: ${JSON.stringify(box)}, nav=${navTop}`);
          }
        }
        await screenshot(page, "home-390-first");
        await page.evaluate(() => window.scrollTo(0, 460));
        assert.ok((await page.locator(".browse-tools").boundingBox()).y + (await page.locator(".browse-tools").boundingBox()).height < 60);
        assert.equal((await page.locator(".site-header").boundingBox()).y, 0);
        assert.equal((await page.locator(".mobile-nav").boundingBox()).y, navTop);
        await screenshot(page, "home-390-scrolled");
      }
    } else {
      await expect(page.locator(".reading-hero img")).toBeVisible();
      await expect(page.locator(".category-pills")).toBeVisible();
      await expect(page.getByRole("combobox", { name: "图书分类", exact: true })).toHaveCount(0);
      const rec = page.getByRole("region", { name: "推荐书屋" });
      assert.ok((await rec.boundingBox()).y < (await page.locator(".reading-grid").boundingBox()).y);
      await expect(page.locator(".browse-age").getByRole("checkbox")).toBeVisible();
    }
    await noOverflow(page);
    await screenshot(page, `home-${width}-full`, true);
  } finally { await session.close(); }
});

test("recommendations follow the available cards or the empty state", async () => {
  for (const count of [0, 2, 4]) {
    const state = homeCatalog();
    state.books = state.books.filter(book => !book.series).slice(0, count);
    const session = await open({ state });
    try {
      if (count) await recommendationsAfter(session.page, count);
      else {
        const rec = session.page.getByRole("region", { name: "推荐书屋" });
        const empty = await session.page.locator(".empty-state").boundingBox();
        assert.ok((await rec.boundingBox()).y >= empty.y + empty.height);
      }
    } finally { await session.close(); }
  }
});

test("combined filters, volume search, reload and resize preserve catalog state", async () => {
  const session = await open();
  const { page } = session;
  try {
    const category = page.getByRole("combobox", { name: "图书分类", exact: true });
    const age = page.getByRole("combobox", { name: "适读年龄", exact: true });
    await category.selectOption("故事");
    await age.selectOption("6—9 岁");
    await page.getByRole("checkbox", { name: "只看可借" }).check();
    await expect(page.locator(".reading-card")).toHaveCount(1);
    await expect(page.locator(".reading-card h3")).toHaveText("米小圈上学记系列");
    await page.getByRole("textbox", { name: "搜索书名、作者或系列" }).fill("第2册");
    await expect(page.locator(".reading-card")).toHaveCount(1);
    await expect(page.locator(".reading-card h3")).toHaveText("米小圈上学记系列第2册");
    await page.reload();
    await expect(category).toHaveValue("故事");
    await expect(age).toHaveValue("6—9 岁");
    await expect(page.getByRole("checkbox", { name: "只看可借" })).toBeChecked();
    await expect(page.getByRole("textbox", { name: "搜索书名、作者或系列" })).toHaveValue("第2册");
    await page.setViewportSize({ width: 1440, height: 844 });
    await expect(page.locator(".category-pills").getByRole("button", { name: "故事", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".browse-age").getByRole("checkbox")).toBeChecked();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(category).toHaveValue("故事");
    await page.getByRole("button", { name: "清除搜索" }).click();
    await expect(page.locator(".reading-card h3")).toHaveText("米小圈上学记系列");
    await page.getByRole("textbox", { name: "搜索书名、作者或系列" }).fill("不存在的书名");
    await expect(page.locator(".empty-state")).toBeVisible();
    await page.getByRole("button", { name: "清除筛选", exact: true }).click();
    await expect(page.locator(".reading-card")).toHaveCount(8);
    await expect(category).toHaveValue("全部");
    await expect(age).toHaveValue("全部");
  } finally { await session.close(); }
});

test("series selection, detail return, shop navigation and reload retain selections", async () => {
  const session = await open();
  const { page } = session;
  try {
    await page.getByRole("button", { name: "查看彼得兔故事全集详情", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "彼得兔故事全集", exact: true });
    await sheet.getByRole("button", { name: "选这本《彼得兔故事全集第1册》", exact: true }).click();
    await sheet.getByRole("button", { name: "查看彼得兔故事全集第2册详情", exact: true }).click();
    await page.getByRole("button", { name: "‹ 返回分册列表", exact: true }).click();
    await sheet.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(page.locator(".cart-bar b")).toContainText("已选1本");
    await page.reload();
    await expect(page.locator(".cart-bar b")).toContainText("已选1本");
    await page.getByRole("region", { name: "推荐书屋" }).getByRole("button", { name: "进入月亮书屋", exact: true }).click();
    await expect(page.locator(".public-shop-banner h1")).toHaveText("月亮书屋");
    await expect(page.getByRole("combobox", { name: "图书分类", exact: true })).toHaveCount(0);
    await expect(page.locator(".category-pills")).toBeVisible();
    await expect(page.locator(".browse-age").getByRole("checkbox")).toBeVisible();
    await expect(page.getByRole("region", { name: "推荐书屋" })).toHaveCount(0);
    await expect(page.locator(".cart-bar b")).toHaveText("已在1家书屋选好书");
    await page.locator(".cart-bar").getByRole("button", { name: "查看已选", exact: true }).click();
    await expect(page.locator(".cart-book")).toHaveCount(1);
    await expect(page.locator(".cart-book strong")).toHaveText("彼得兔故事全集第1册");
    await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
    await screenshot(page, "public-shop-390", true);
    await page.getByRole("button", { name: "‹ 返回找书", exact: true }).click();
    await page.getByRole("button", { name: "更多书屋 ›", exact: true }).click();
    await expect(page.locator(".page-shops")).toBeVisible();
    await expect(page.locator(".cart-bar b")).toContainText("已选1本");
  } finally { await session.close(); }
});

test("expired filters reset scroll while a valid browse scroll survives reload", async () => {
  const expired = await open({ cached: { shopId: "", category: "已删除分类", age: "已删除年龄", scroll: 300 } });
  try {
    await expect(expired.page.getByRole("combobox", { name: "图书分类", exact: true })).toHaveValue("全部");
    await expect(expired.page.getByRole("combobox", { name: "适读年龄", exact: true })).toHaveValue("全部");
    await expect.poll(() => expired.page.evaluate(() => window.scrollY)).toBe(0);
  } finally { await expired.close(); }
  const valid = await open();
  try {
    await expect(valid.page.getByRole("combobox", { name: "适读年龄", exact: true })).toBeEnabled();
    await valid.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await valid.page.evaluate(() => window.scrollTo(0, 350));
    await expect.poll(() => valid.page.evaluate(() => JSON.parse(sessionStorage.getItem("tt-browse")).scroll)).toBe(350);
    await valid.page.reload();
    await expect.poll(() => valid.page.evaluate(() => window.scrollY)).toBe(350);
  } finally { await valid.close(); }
});

test("large text and long configured options fit without hiding age or availability", async () => {
  const state = homeCatalog();
  state.options.categories[0].label = "适合亲子共读及独立阅读的长分类名称";
  state.options.ages[0].label = "较长的适读年龄与阅读发展阶段";
  const session = await open({ width: 320, state });
  const { page } = session;
  try {
    // Emulate text-only enlargement rather than scaling the whole viewport.
    await page.evaluate(() => {
      const elements = [...document.querySelectorAll("body *")].filter(element => !(element instanceof SVGElement));
      const sizes = elements.map(element => Number.parseFloat(getComputedStyle(element).fontSize));
      elements.forEach((element, i) => { element.style.fontSize = `${sizes[i] * 2}px`; });
    });
    await noOverflow(page);
    await screenshot(page, "home-320-large-text-books", true);
    await page.getByRole("combobox", { name: "图书分类", exact: true }).selectOption(state.options.categories[0].label);
    await page.getByRole("combobox", { name: "适读年龄", exact: true }).selectOption(state.options.ages[0].label);
    await expect(page.getByRole("combobox", { name: "适读年龄", exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "只看可借" })).toBeVisible();
    await screenshot(page, "home-320-large-text", true);
    await noOverflow(page);
  } finally { await session.close(); }
});

test("mobile category and age expose loading and failed-option feedback", async () => {
  const state = homeCatalog();
  let release;
  state.optionsGate = new Promise(resolve => { release = resolve; });
  const session = await open({ state });
  try {
    const category = session.page.getByRole("combobox", { name: "图书分类", exact: true });
    const age = session.page.getByRole("combobox", { name: "适读年龄", exact: true });
    await expect(category).toBeDisabled();
    await expect(age).toBeDisabled();
    state.optionsFailure = true;
    release();
    await expect(session.page.locator(".home-category-filter").getByRole("status")).toHaveText("选项加载失败，请刷新页面重试。");
    await expect(category).toBeDisabled();
    state.optionsFailure = false;
    await session.page.reload();
    await expect(category).toBeEnabled();
    await expect(age).toBeEnabled();
  } finally { release(); await session.close(); }
});
