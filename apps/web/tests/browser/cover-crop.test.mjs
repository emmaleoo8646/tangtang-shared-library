import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import { expect } from "playwright/test";

const webRoot = fileURLToPath(new URL("../../", import.meta.url));
const base = "http://127.0.0.1:5197";
let server, browser;

before(async () => {
  server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5197", "--strictPort"], { cwd: webRoot, stdio: "pipe" });
  let output = "";
  server.stdout.on("data", chunk => { output += chunk; });
  server.stderr.on("data", chunk => { output += chunk; });
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null || attempt === 100) throw new Error(`Preview failed: ${output}`);
    try { if ((await fetch(base)).ok) break; } catch { /* wait for preview */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  browser = await (process.env.BROWSER_ENGINE === "webkit" ? webkit : chromium).launch({
    ...(process.env.BROWSER_ENGINE === "webkit" ? {} : { channel: process.env.BROWSER_CHANNEL || "chrome" }), headless: true,
  });
});
after(async () => { await browser?.close(); server?.kill(); });

async function open({ width = 390, workers = "real" } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 600, hasTouch: width < 600 });
  const page = await context.newPage();
  const requests = [], errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(mode => {
    window.__cropWorkers = [];
    const NativeWorker = window.Worker;
    window.Worker = class {
      constructor(url, options) {
        const worker = mode === "real" ? new NativeWorker(url, options) : this;
        window.__cropWorkers.push(worker);
        if (mode === "real") return worker;
      }
      postMessage(pixels) { this.pixels = pixels; }
      terminate() { this.terminated = true; }
    };
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    window.__heldBlobs = [];
    HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
      if (window.__failNextBlob) { window.__failNextBlob = false; callback(null); return; }
      toBlob.call(this, blob => {
        if (window.__holdBlobs) window.__heldBlobs.push(() => callback(blob));
        else callback(blob);
      }, ...args);
    };
  }, workers);
  const family = { id: "family-test", username: "test", email: "parent@example.test", displayName: "测试书屋", avatarUrl: null, phone: "", children: [] };
  const option = (id, label, kind) => ({ id, label, kind, active: true, sortOrder: 10 });
  const options = {
    categories: [option("category-picture", "绘本", "CATEGORY")],
    ages: [option("age-3-6", "3—6 岁", "AGE")],
    conditions: [option("condition-like-new", "九成新", "CONDITION")],
  };
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname.slice(4);
    if (route.request().method() !== "GET") requests.push({ path, data: route.request().postDataJSON() });
    if (path === "/me") return route.fulfill({ json: family });
    if (path === "/options") return route.fulfill({ json: options });
    if (path === "/loans" || path === "/series") return route.fulfill({ json: [] });
    if (path === "/books") return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 200 } });
    if (path === "/books/recognize") return route.fulfill({ json: { title: "识别后的书名", author: "作者", category: "绘本", summary: "测试简介", sources: [] } });
    return route.fulfill({ status: 404, json: { message: `Unexpected mock: ${path}` } });
  });
  await page.goto(base);
  await expect(page.locator(".role-button")).toContainText("测");
  return { page, requests, async close() { await context.close(); assert.deepEqual(errors, []); } };
}

async function publish(page) {
  const nav = page.viewportSize().width < 600 ? ".mobile-nav" : ".desktop-nav";
  await page.locator(nav).getByRole("button", { name: "我的书屋", exact: true }).click();
  await page.getByRole("button", { name: "发布图书", exact: true }).click();
}

// Deterministic, textured photo-like fixture: background, book, illustration and title.
async function photograph(page, { name = "cover.png", blank = false, large = false } = {}) {
  const encoded = await page.evaluate(({ blank, large }) => {
    const canvas = document.createElement("canvas");
    canvas.width = large ? 1600 : 400; canvas.height = large ? 2000 : 500;
    const ctx = canvas.getContext("2d");
    ctx.scale(canvas.width / 400, canvas.height / 500);
    ctx.fillStyle = "#d8ccb9"; ctx.fillRect(0, 0, 400, 500);
    if (!blank) {
      ctx.fillStyle = "#286a5e"; ctx.fillRect(100, 70, 200, 360);
      ctx.fillStyle = "#dcd888"; ctx.fillRect(135, 150, 130, 160);
      ctx.fillStyle = "#ffffff"; ctx.font = "bold 20px sans-serif"; ctx.fillText("BOOK TITLE", 125, 115);
      ctx.font = "14px sans-serif"; ctx.fillText("Author", 173, 390);
    }
    return canvas.toDataURL("image/png").split(",")[1];
  }, { blank, large });
  return { name, mimeType: "image/png", buffer: Buffer.from(encoded, "base64") };
}

async function upload(page, options) {
  await page.getByLabel("拍照或上传图书封面", { exact: true }).setInputFiles(await photograph(page, options));
  await expect(page.getByRole("dialog", { name: "裁剪封面照片" })).toBeVisible();
  await expect(page.getByRole("button", { name: "使用此封面", exact: true })).toBeEnabled();
}
async function cropStyle(page) {
  return page.locator(".ReactCrop__crop-selection").evaluate(element => ({
    x: parseFloat(element.style.left), y: parseFloat(element.style.top), width: parseFloat(element.style.width), height: parseFloat(element.style.height),
  }));
}
const suggested = { unit: "%", x: 20, y: 10, width: 60, height: 80 };
async function deliver(page, index, result = suggested) {
  await page.evaluate(({ index, result }) => window.__cropWorkers[index].onmessage({ data: result }), { index, result });
}
async function outputDimensions(page, image) {
  return page.evaluate(async src => {
    const image = new Image(); image.src = src; await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  }, image);
}

for (const width of [320, 390, 1440]) test(`auto selection and direct confirmation use only the compressed cover at ${width}px`, async () => {
  const session = await open({ width });
  const { page, requests } = session;
  try {
    await publish(page); await upload(page, { large: true });
    await expect(page.getByRole("status")).toHaveText("已自动选择封面，可调整后确认");
    const crop = await cropStyle(page);
    assert.ok(crop.x < 25 && crop.x > 20 && crop.y < 14 && crop.y > 10);
    assert.ok(crop.x + crop.width >= 75 && crop.y + crop.height >= 86);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(requests.length, 0, "detecting edges must not upload anything");
    assert.equal(await page.locator(".crop-result").count(), 0);
    if (process.env.COVER_CROP_SCREENSHOTS) {
      const directory = fileURLToPath(new URL("../../../../Dev-Scratch/screenshots/cover-crop/", import.meta.url));
      await mkdir(directory, { recursive: true });
      await page.screenshot({ path: `${directory}${width}.png`, fullPage: true });
    }
    await page.getByRole("button", { name: "使用此封面", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByLabel("书名", { exact: false })).toHaveValue("识别后的书名");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].path, "/books/recognize");
    const image = requests[0].data.coverImage;
    assert.ok(image.startsWith("data:image/jpeg;base64,"));
    assert.ok(Buffer.from(image.split(",")[1], "base64").length <= 600_000);
    const dimensions = await outputDimensions(page, image);
    assert.ok(Math.max(dimensions.width, dimensions.height) <= 960);
    assert.ok(dimensions.height > dimensions.width * 1.5);
  } finally { await session.close(); }
});

test("manual keyboard and pointer adjustment stop detection, and late results never replace the crop", async () => {
  const session = await open({ workers: "held" });
  const { page, requests } = session;
  try {
    await publish(page); await upload(page);
    await expect(page.getByRole("status")).toHaveText("正在识别封面边缘…");
    await page.locator(".ReactCrop__drag-handle.ord-se").press("ArrowLeft");
    await expect.poll(async () => (await cropStyle(page)).width).toBeLessThan(100);
    const manual = await cropStyle(page);
    assert.ok(manual.width < 100);
    assert.equal(await page.evaluate(() => window.__cropWorkers[0].terminated), true);
    await deliver(page, 0);
    assert.deepEqual(await cropStyle(page), manual);
    const box = await page.locator(".ReactCrop__drag-handle.ord-se").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x - 40, box.y + box.height / 2); await page.mouse.up();
    assert.ok((await cropStyle(page)).width < manual.width);
    await page.getByRole("button", { name: "使用此封面", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(() => requests.length).toBe(1);
  } finally { await session.close(); }
});

test("flat images and worker timeouts preserve the full image and allow confirmation", async () => {
  for (const workers of ["real", "held"]) {
    const session = await open({ workers });
    const { page, requests } = session;
    try {
      await publish(page); await upload(page, { blank: true });
      await expect(page.getByRole("status")).toHaveText("未能准确识别边缘，请手动调整");
      assert.deepEqual(await cropStyle(page), { x: 0, y: 0, width: 100, height: 100 });
      if (workers === "held") {
        assert.equal(await page.evaluate(() => window.__cropWorkers[0].terminated), true);
        await deliver(page, 0); // Even a late result after the timeout is ignored.
        assert.deepEqual(await cropStyle(page), { x: 0, y: 0, width: 100, height: 100 });
      }
      await page.getByRole("button", { name: "使用此封面", exact: true }).click();
      await expect.poll(() => requests.length).toBe(1);
    } finally { await session.close(); }
  }
});

test("worker errors fall back without preventing manual confirmation", async () => {
  const session = await open({ workers: "held" });
  const { page, requests } = session;
  try {
    await publish(page); await upload(page);
    await page.evaluate(() => window.__cropWorkers[0].onerror(new Event("error", { cancelable: true })));
    await expect(page.getByRole("status")).toHaveText("未能准确识别边缘，请手动调整");
    await page.getByRole("button", { name: "使用此封面", exact: true }).click();
    await expect.poll(() => requests.length).toBe(1);
  } finally { await session.close(); }
});

test("replacing the file and closing the dialog cancel old detection tasks", async () => {
  const session = await open({ workers: "held" });
  const { page, requests } = session;
  try {
    await publish(page); await upload(page);
    await upload(page, { name: "replacement.png", blank: true });
    await expect.poll(() => page.evaluate(() => window.__cropWorkers.length)).toBe(2);
    assert.equal(await page.evaluate(() => window.__cropWorkers[0].terminated), true);
    await deliver(page, 0);
    assert.deepEqual(await cropStyle(page), { x: 0, y: 0, width: 100, height: 100 });
    await deliver(page, 1);
    await expect(page.getByRole("status")).toHaveText("已自动选择封面，可调整后确认");
    await page.getByRole("button", { name: "关闭裁剪", exact: true }).click();
    assert.equal(await page.evaluate(() => window.__cropWorkers[1].terminated), true);
    await deliver(page, 1);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    assert.equal(requests.length, 0);
  } finally { await session.close(); }
});

test("compression failures can be retried; preview remains optional and duplicate confirmation is blocked", async () => {
  const session = await open();
  const { page, requests } = session;
  try {
    await publish(page); await upload(page);
    await expect(page.getByRole("status")).toHaveText("已自动选择封面，可调整后确认");
    const before = await cropStyle(page);
    await page.evaluate(() => { window.__failNextBlob = true; });
    await page.getByRole("button", { name: "使用此封面", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("无法生成图片预览");
    assert.deepEqual(await cropStyle(page), before);
    await page.getByRole("button", { name: "预览裁剪结果", exact: true }).click();
    await expect(page.getByAltText("最终封面预览")).toBeVisible();
    const preview = await page.getByAltText("最终封面预览").getAttribute("src");
    await page.locator(".ReactCrop__drag-handle.ord-se").press("ArrowLeft");
    await expect(page.getByAltText("最终封面预览")).toHaveCount(0);
    await page.evaluate(() => { window.__holdBlobs = true; });
    await page.getByRole("button", { name: "使用此封面", exact: true }).evaluate(button => { button.click(); button.click(); });
    await expect.poll(() => page.evaluate(() => window.__heldBlobs.length)).toBe(1);
    await expect(page.getByRole("button", { name: "使用此封面", exact: true })).toBeDisabled();
    assert.equal(requests.length, 0);
    await page.evaluate(() => { window.__holdBlobs = false; window.__heldBlobs[0](); });
    await expect.poll(() => requests.length).toBe(1);
    assert.notEqual(requests[0].data.coverImage, preview);
  } finally { await session.close(); }
});

test("closing during compression prevents a late upload", async () => {
  const session = await open();
  const { page, requests } = session;
  try {
    await publish(page); await upload(page);
    await page.evaluate(() => { window.__holdBlobs = true; });
    await page.getByRole("button", { name: "使用此封面", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__heldBlobs.length)).toBe(1);
    await page.getByRole("button", { name: "关闭裁剪", exact: true }).click();
    await page.evaluate(() => { window.__holdBlobs = false; window.__heldBlobs[0](); });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    assert.equal(requests.length, 0);
  } finally { await session.close(); }
});

test("avatar cropping remains square and still requires a preview", async () => {
  const session = await open();
  const { page } = session;
  try {
    await page.locator(".role-button").click();
    await page.getByLabel("上传书屋头像", { exact: true }).setInputFiles(await photograph(page));
    await expect(page.getByRole("dialog", { name: "裁剪头像照片" })).toBeVisible();
    await expect(page.getByRole("button", { name: "使用此头像", exact: true })).toBeDisabled();
    assert.equal(await page.evaluate(() => window.__cropWorkers.length), 0);
    const bounds = await page.locator(".ReactCrop__crop-selection").boundingBox();
    assert.ok(Math.abs(bounds.width - bounds.height) < 1);
    await page.getByRole("button", { name: "预览裁剪结果", exact: true }).click();
    await expect(page.getByAltText("最终头像预览")).toBeVisible();
    const dimensions = await outputDimensions(page, await page.getByAltText("最终头像预览").getAttribute("src"));
    assert.equal(dimensions.width, dimensions.height);
    await page.getByRole("button", { name: "使用此头像", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally { await session.close(); }
});
