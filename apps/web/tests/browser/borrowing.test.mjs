import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import { expect } from "playwright/test";
import { homeCatalog } from "./fixtures/home-catalog.mjs";

const webRoot = fileURLToPath(new URL("../../", import.meta.url));
const screenshotRoot = fileURLToPath(new URL("../../../../Dev-Scratch/borrowing-review/", import.meta.url));
const base = "http://127.0.0.1:5199";
let server, browser;

before(async () => {
  server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5199", "--strictPort"], { cwd: webRoot, stdio: "pipe" });
  let output = "";
  server.stdout.on("data", chunk => { output += chunk; });
  server.stderr.on("data", chunk => { output += chunk; });
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null || attempt === 100) throw new Error(`Preview failed: ${output}`);
    if (output.includes("Local:")) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  browser = await (process.env.BROWSER_ENGINE === "webkit" ? webkit : chromium).launch({
    ...(process.env.BROWSER_ENGINE === "webkit" ? {} : { channel: process.env.BROWSER_CHANNEL || "chrome" }), headless: true,
  });
  if (process.env.BORROWING_SCREENSHOTS) await mkdir(screenshotRoot, { recursive: true });
});
after(async () => { await browser?.close(); server?.kill(); });

function loan(id, stage, extra = {}) {
  return { id, groupId: "incoming", message: "", bookId: `book-${id}`, bookTitle: `童书 ${id}`,
    owner: "糖糖书屋", borrower: "月亮书屋", isOwner: false, stage, place: "", contactPhone: null,
    dueAt: null, borrowerLoanConfirmed: false, ownerLoanConfirmed: false, borrowerReturnConfirmed: false,
    ownerReturnConfirmed: false, renewalRequested: false, renewed: false,
    requestedAt: "2026-10-01T00:00:00Z", approvedAt: null, lentAt: null, returnedAt: null, ...extra };
}
function fixture() {
  return { ...homeCatalog(), loans: [
    loan("read-1", "LENT", { dueAt: "2026-10-16" }), loan("read-2", "LENT", { dueAt: "2026-10-16" }),
    loan("ended", "RETURNED", { groupId: "ended", dueAt: "2026-09-01" }),
    ...[1, 2, 3].map(i => loan(`request-${i}`, "REQUESTED", { groupId: "outgoing", isOwner: true, requestedAt: "2026-09-30T00:00:00Z" })),
  ] };
}
async function open(width = 390, state = fixture(), { guest = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width <= 700, hasTouch: width <= 700 });
  const page = await context.newPage();
  const errors = [], mutations = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.clock.install({ time: new Date("2026-10-02T02:00:00Z") });
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(4);
    if (request.method() === "POST") {
      const data = request.postDataJSON();
      mutations.push({ path, data });
      if (path === "/auth/login") { guest = false; return route.fulfill({ json: {} }); }
      if (/^\/(loan-groups|loans)\/[^/]+\/action$/.test(path)) {
        if (state.actionFailure) return route.fulfill({ status: 409, json: { message: "所选图书状态已变化，请刷新" } });
        const groupId = path.split("/")[2];
        const selected = state.loans.filter(row => (row.groupId || row.id) === groupId && data.loanIds.includes(row.id));
        for (const row of selected) {
          if (data.action === "approve" || data.action === "set-place") { row.stage = "HANDOFF_AGREED"; row.place = data.place; }
          if (data.action === "decline" || data.action === "cancel") row.stage = data.action === "decline" ? "REJECTED" : "CANCELLED";
          if (data.action === "confirm-lend") { row.stage = "LENT"; row.borrowerLoanConfirmed = true; row.dueAt = "2026-10-16"; }
          if (data.action === "request-return") { row.stage = "RETURN_REQUESTED"; row.borrowerReturnConfirmed = true; }
          if (data.action === "confirm-return") row.stage = "RETURNED";
          if (data.action === "request-renew") row.renewalRequested = true;
          if (data.action === "approve-renew") { row.renewed = true; row.dueAt = "2026-10-30"; }
        }
        if (data.declineRest) for (const row of state.loans.filter(row => row.groupId === groupId && row.stage === "REQUESTED" && !data.loanIds.includes(row.id))) row.stage = "REJECTED";
        return route.fulfill({ json: { ok: true } });
      }
    }
    if (path === "/me") return route.fulfill(guest ? { status: 401, json: { message: "未登录" } } : { json: state.family });
    if (path === "/options") return route.fulfill({ json: state.options });
    if (path === "/loans") return route.fulfill({ json: state.loans });
    if (path === "/series") return route.fulfill({ json: [] });
    if (path === "/books") return route.fulfill({ json: { items: state.books, total: state.books.length, page: 1, pageSize: 200 } });
    if (path.startsWith("/shops/")) return route.fulfill({ json: state.shops.find(row => row.id === path.split("/")[2]) });
    errors.push(`Unexpected mock request: ${request.method()} ${path}`);
    return route.fulfill({ status: 404, json: { message: "未找到" } });
  });
  await page.goto(base);
  const nav = page.locator(width <= 700 ? ".mobile-nav" : ".desktop-nav");
  await expect(page.locator(".role-button")).toContainText(guest ? "家长登录" : state.family.displayName);
  await nav.getByRole("button", { name: /^借阅/ }).click();
  if (!guest) await expect(page.getByRole("heading", { name: "我的借阅", exact: true })).toBeVisible();
  return { page, nav, state, mutations, async close() { await context.close(); assert.deepEqual(errors, []); } };
}
async function noOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
}
async function screenshot(page, name) {
  if (process.env.BORROWING_SCREENSHOTS) await page.screenshot({ path: `${screenshotRoot}/${process.env.BROWSER_ENGINE || "chromium"}-${name}.png`, fullPage: true });
}

for (const width of [320, 390, 700, 701, 1440]) test(`borrowing page prioritizes actions and fits at ${width}px`, async () => {
  const session = await open(width);
  const { page, nav } = session;
  try {
    await expect(page.locator(".borrowing-tabs .selected")).toHaveText("进行中2");
    const cards = page.locator(".loan-group-card");
    await expect(cards).toHaveCount(2);
    await expect(cards.first().getByRole("heading", { level: 2 })).toHaveText("月亮书屋向你借 3 本等你同意");
    await expect(cards.first().locator(".loan-direction")).toHaveText("我借出");
    await expect(cards.last().locator(".loan-direction")).toHaveText("我借入");
    await expect(cards.last().locator(".loan-next-title")).toHaveText("10 月 16 日前归还");
    await expect(page.getByRole("heading", { name: "需要你处理 · 1 条" })).toBeVisible();
    await expect(nav.getByRole("button", { name: "借阅，1 条待办" })).toBeVisible();
    await expect(cards.first().getByRole("button", { name: "同意 3本", exact: true })).toBeDisabled();
    await cards.first().getByLabel("公共交接地点", { exact: true }).fill("社区图书馆门口");
    await expect(cards.first().getByRole("button", { name: "同意 3本", exact: true })).toBeEnabled();
    await expect(page.locator(".loan-progress").first()).toBeHidden();
    await noOverflow(page);
    await screenshot(page, `borrowing-${width}`);
    const summary = cards.first().locator(".loan-details > summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(cards.first().locator(".loan-progress")).toBeVisible();
    await expect(cards.first().locator(".group-loan-row")).toHaveCount(3);
    await noOverflow(page);
    await summary.click();
    await expect(cards.first().locator(".loan-progress")).toBeHidden();
    assert.deepEqual(session.mutations, []);
  } finally { await session.close(); }
});

test("status tabs keep whole batches and ordinary navigation restores ongoing", async () => {
  const session = await open();
  try {
    const { page, nav } = session;
    await page.locator(".borrowing-tabs").getByRole("button", { name: "全部3", exact: true }).click();
    await expect(page.locator(".loan-group-card")).toHaveCount(3);
    await page.locator(".borrowing-tabs").getByRole("button", { name: "已结束1", exact: true }).click();
    await expect(page.locator(".loan-group-card")).toHaveCount(1);
    await expect(page.locator(".loan-next-title")).toHaveText("本次借阅已结束");
    await nav.getByRole("button", { name: "找书", exact: true }).click();
    await nav.getByRole("button", { name: /^借阅/ }).click();
    await expect(page.locator(".borrowing-tabs .selected")).toHaveText("进行中2");
    await expect(page.locator(".loan-group-card")).toHaveCount(2);
  } finally { await session.close(); }
});

test("approval updates badge and ordering without splitting or hiding a partially approved batch", async () => {
  const session = await open();
  try {
    const { page, nav, mutations } = session;
    const card = page.locator(".needs-attention");
    await card.getByLabel("公共交接地点", { exact: true }).fill("社区图书馆门口");
    await card.getByRole("button", { name: "部分同意", exact: true }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("checkbox").nth(2).uncheck();
    await sheet.getByRole("button", { name: "同意2本，其余1本不借", exact: true }).click();
    await expect(sheet).toHaveCount(0);
    await expect(nav.getByRole("button", { name: "借阅", exact: true })).toBeVisible();
    await expect(page.locator(".needs-attention")).toHaveCount(0);
    await expect(page.locator(".loan-group-card").first().locator(".loan-direction")).toHaveText("我借入");
    const outgoing = page.locator(".loan-group-card").filter({ hasText: "我借出" });
    await expect(outgoing.getByRole("heading", { level: 2 })).toContainText("借 3 本");
    await outgoing.locator(".loan-details > summary").click();
    await expect(outgoing.locator(".group-loan-row")).toHaveCount(3);
    await expect(outgoing.locator(".group-loan-row").last()).toContainText("未同意");
    assert.deepEqual(mutations, [{ path: "/loan-groups/outgoing/action", data: { action: "approve", loanIds: ["request-1", "request-2"], place: "社区图书馆门口", declineRest: true } }]);
  } finally { await session.close(); }
});

test("partial receipt, renewal and return remain accessible outside collapsed borrowing details", async () => {
  const state = fixture();
  state.loans = [loan("receive-1", "HANDOFF_AGREED", { place: "社区图书馆门口" }), loan("receive-2", "HANDOFF_AGREED", { place: "社区图书馆门口" })];
  const session = await open(390, state);
  try {
    const { page, nav, mutations } = session;
    await expect(page.locator(".loan-next-title")).toHaveText("取书后确认收到");
    await page.getByRole("button", { name: "只收到部分", exact: true }).click();
    let sheet = page.getByRole("dialog");
    await sheet.getByRole("checkbox").nth(1).uncheck();
    await sheet.getByRole("button", { name: "确认1本", exact: true }).click();
    await expect(sheet).toHaveCount(0);
    await expect(nav.getByRole("button", { name: "借阅，1 条待办" })).toBeVisible();
    await expect(page.getByRole("button", { name: "确认收到剩余1本", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "确认收到剩余1本", exact: true }).click();
    await expect(page.locator(".loan-next-title")).toHaveText("10 月 16 日前归还");
    await page.getByText("续借与归还", { exact: true }).click();
    await page.getByRole("button", { name: "申请续借2本", exact: true }).click();
    await expect(page.locator(".loan-group-heading p")).toContainText("等待书主同意续借");
    await page.getByRole("button", { name: "只送还部分", exact: true }).click();
    sheet = page.getByRole("dialog");
    await sheet.getByRole("checkbox").nth(1).uncheck();
    await sheet.getByRole("button", { name: "确认1本", exact: true }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.locator(".loan-next-title")).toHaveText("10 月 16 日前归还");
    await expect(page.locator(".loan-group-heading p")).toContainText("部分已送还");
    assert.deepEqual(mutations.map(item => item.data.action), ["confirm-lend", "confirm-lend", "request-renew", "request-return"]);
    assert.deepEqual(mutations.at(-1).data.loanIds, ["receive-1"]);
  } finally { await session.close(); }
});

test("owner can handle multiple tasks and still directly confirm books returned without a reminder", async () => {
  const state = fixture();
  state.loans = [loan("return", "RETURN_REQUESTED", { isOwner: true }), loan("renew", "LENT", { isOwner: true, renewalRequested: true }), loan("read", "LENT", { isOwner: true })];
  const session = await open(390, state);
  try {
    const { page, nav, mutations } = session;
    await expect(page.locator(".loan-next-title")).toHaveText("请确认收回");
    await expect(page.locator(".loan-other-todos")).toContainText("1 本请处理续借申请");
    await page.getByRole("button", { name: "确认收回 1本", exact: true }).click();
    await expect(page.locator(".loan-next-title")).toHaveText("请处理续借申请");
    await page.getByRole("button", { name: "同意续借1本", exact: true }).click();
    await expect(page.locator(".needs-attention")).toHaveCount(0);
    await expect(nav.getByRole("button", { name: "借阅", exact: true })).toBeVisible();
    await page.getByText("确认收回", { exact: true }).click();
    await page.getByRole("button", { name: "已收回全部2本", exact: true }).click();
    await expect(page.locator(".loan-group-card")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "目前没有进行中的借阅" })).toBeVisible();
    assert.deepEqual(mutations.map(item => item.data.action), ["confirm-return", "approve-renew", "confirm-return"]);
  } finally { await session.close(); }
});

test("long household names wrap and empty filters have appropriate messages", async () => {
  const state = fixture();
  state.loans.forEach(row => { row.owner = "糖糖和好朋友们一起分享童书的温暖书屋"; row.borrower = "月亮和星星陪伴孩子阅读成长的共享书屋"; });
  const session = await open(320, state);
  try { await noOverflow(session.page); } finally { await session.close(); }
  const empty = fixture();
  empty.loans = [];
  const emptySession = await open(320, empty);
  try {
    const { page } = emptySession;
    await expect(page.getByRole("heading", { name: "目前没有进行中的借阅" })).toBeVisible();
    await page.locator(".borrowing-tabs").getByRole("button", { name: "已结束0", exact: true }).click();
    await expect(page.getByRole("heading", { name: "还没有结束的借阅" })).toBeVisible();
    await page.locator(".borrowing-tabs").getByRole("button", { name: "全部0", exact: true }).click();
    await expect(page.getByRole("heading", { name: "还没有借阅记录" })).toBeVisible();
  } finally { await emptySession.close(); }
});

test("login reached from borrowing opens the ongoing filter", async () => {
  const session = await open(390, fixture(), { guest: true });
  try {
    const { page } = session;
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("账号或邮箱").fill("preview");
    await dialog.getByLabel("密码", { exact: true }).fill("preview-password");
    await dialog.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByRole("heading", { name: "我的借阅", exact: true })).toBeVisible();
    await expect(page.locator(".borrowing-tabs .selected")).toHaveText("进行中2");
  } finally { await session.close(); }
});


test("legacy location and handoff actions retain their individual loan endpoint", async () => {
  const state = fixture();
  state.loans = [loan("approved", "APPROVED", { groupId: null, isOwner: true }),
    loan("legacy", "HANDOFF_AGREED", { groupId: null, isOwner: true, borrowerLoanConfirmed: true, place: "社区图书馆门口" })];
  const session = await open(390, state);
  try {
    const { page, mutations } = session;
    const approved = page.locator(".loan-group-card").filter({ hasText: "请确认公共交接地点" });
    await approved.getByLabel("公共交接地点", { exact: true }).fill("社区图书馆门口");
    await approved.getByRole("button", { name: "确认交接地点 · 1本", exact: true }).click();
    await expect(approved).toHaveCount(0);
    await page.getByRole("button", { name: "完成旧订单交接 · 1本", exact: true }).click();
    await expect(page.locator(".needs-attention")).toHaveCount(0);
    assert.deepEqual(mutations.map(item => item.path), ["/loans/approved/action", "/loans/legacy/action"]);
    assert.deepEqual(mutations.map(item => item.data.action), ["set-place", "confirm-lend"]);
  } finally { await session.close(); }
});

test("a failed approval keeps the selection open and the pending batch visible", async () => {
  const state = fixture();
  state.actionFailure = true;
  const session = await open(390, state);
  try {
    const { page, nav } = session;
    const card = page.locator(".needs-attention");
    await card.getByLabel("公共交接地点", { exact: true }).fill("社区图书馆门口");
    await card.getByRole("button", { name: "部分同意", exact: true }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "同意3本，其余0本不借", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("所选图书状态已变化，请刷新");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("checkbox").first()).toBeChecked();
    await expect(nav.getByRole("button", { name: "借阅，1 条待办" })).toHaveCount(1);
    assert.ok(state.loans.filter(row => row.groupId === "outgoing").every(row => row.stage === "REQUESTED"));
  } finally { await session.close(); }
});

test("an ended record opened from my library keeps the ended filter", async () => {
  const session = await open();
  try {
    const { page, nav } = session;
    await nav.getByRole("button", { name: "我的书屋", exact: true }).click();
    await page.getByRole("button", { name: "借入", exact: true }).click();
    await page.locator(".record-list").getByRole("button").filter({ hasText: "已归还" }).click();
    await expect(page.locator(".borrowing-tabs .selected")).toHaveText("已结束1");
    await expect(page.locator(".loan-next-title")).toHaveText("本次借阅已结束");
  } finally { await session.close(); }
});
