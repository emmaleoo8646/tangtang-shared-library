import assert from "node:assert/strict";
import test from "node:test";
import { detectCoverBounds, type DetectionPixels } from "../src/coverDetection.ts";

type Point = [number, number];
function inPolygon(x: number, y: number, points: Point[]) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const rectangle = (x: number, y: number, width: number, height: number): Point[] =>
  [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];

function photo(width: number, height: number, books: Point[][], { contrast = 150, textured = false } = {}): DetectionPixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const covered = books.some(points => inPolygon(x, y, points));
    const texture = textured ? Math.round(Math.sin(x * 0.3) * 5 + Math.cos(y * 0.2) * 5) : 0;
    const value = 210 - (covered ? contrast : 0) + texture;
    const index = (y * width + x) * 4;
    data[index] = value; data[index + 1] = value + (covered ? 12 : 0); data[index + 2] = value;
    data[index + 3] = 255;
    // Small pieces of cover artwork and background clutter do not determine the selection.
    if (textured && ((covered && x % 47 < 6 && y % 59 < 12) || (!covered && x < 20 && y % 80 < 10))) {
      data[index] = 240; data[index + 1] = 120; data[index + 2] = 40;
    }
  }
  return { width, height, data };
}

function includesCover(image: DetectionPixels, points: Point[]) {
  const crop = detectCoverBounds(image);
  assert.ok(crop, "a complete, high-contrast cover should be detected");
  const left = crop.x / 100 * image.width, top = crop.y / 100 * image.height;
  const right = (crop.x + crop.width) / 100 * image.width, bottom = (crop.y + crop.height) / 100 * image.height;
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  assert.ok(left <= Math.min(...xs) && top <= Math.min(...ys), "keep the top/left book edges");
  assert.ok(right >= Math.max(...xs) && bottom >= Math.max(...ys), "keep the bottom/right book edges");
  assert.ok(left >= 0 && top >= 0 && right <= image.width && bottom <= image.height);
  assert.ok(Math.min(...xs) - left < image.width * 0.04 && Math.min(...ys) - top < image.height * 0.04);
  assert.ok(right - Math.max(...xs) < image.width * 0.04 && bottom - Math.max(...ys) < image.height * 0.04);
}

test("portrait, landscape and square covers retain every edge with only a small margin", () => {
  for (const [width, height, book] of [
    [320, 420, rectangle(80, 60, 160, 300)],
    [480, 320, rectangle(60, 80, 360, 160)],
    [400, 400, rectangle(70, 70, 260, 260)],
  ] as [number, number, Point[]][]) includesCover(photo(width, height, [book]), book);
});

test("slightly tilted covers use their enclosing rectangle without cutting off corners", () => {
  const book: Point[] = [[100, 45], [276, 60], [253, 358], [78, 343]];
  includesCover(photo(360, 400, [book]), book);
});

test("texture and small clutter do not replace the main book outline", () => {
  const book = rectangle(85, 65, 230, 290);
  includesCover(photo(400, 420, [book], { textured: true }), book);
});

test("different colours with similar luminance still have detectable cover edges", () => {
  const book = rectangle(60, 60, 240, 280);
  const image = photo(360, 400, [book]);
  for (let index = 0; index < image.data.length; index += 4) {
    const covered = image.data[index] < 100;
    image.data[index] = covered ? 80 : 220;
    image.data[index + 1] = covered ? 122 : 80;
    image.data[index + 2] = 80;
  }
  includesCover(image, book);
});

test("low contrast, flat images, cropped outlines and nonrectangular objects fall back", () => {
  assert.equal(detectCoverBounds(photo(320, 400, [rectangle(60, 50, 200, 300)], { contrast: 8 })), null);
  assert.equal(detectCoverBounds(photo(320, 400, [])), null);
  assert.equal(detectCoverBounds(photo(320, 400, [rectangle(-10, 50, 230, 300)])), null);
  const circle: Point[] = Array.from({ length: 60 }, (_, i) => [160 + Math.cos(i / 60 * Math.PI * 2) * 120, 200 + Math.sin(i / 60 * Math.PI * 2) * 150]);
  assert.equal(detectCoverBounds(photo(320, 400, [circle])), null);
});

test("two similarly plausible books fall back rather than guessing", () => {
  assert.equal(detectCoverBounds(photo(400, 400, [rectangle(20, 60, 140, 280), rectangle(240, 60, 140, 280)])), null);
});

test("a smaller piece of nested cover artwork does not cause ambiguity", () => {
  const book = rectangle(60, 40, 240, 340);
  const image = photo(360, 420, [book]);
  for (let y = 90; y < 310; y++) for (let x = 100; x < 260; x++) {
    const index = (y * image.width + x) * 4;
    image.data[index] = 230; image.data[index + 1] = 230; image.data[index + 2] = 230;
  }
  includesCover(image, book);
});

test("invalid or oversized analysis inputs fail safely", () => {
  for (const [width, height] of [[0, 400], [640, 641], [23, 23], [100.5, 100]]) {
    assert.equal(detectCoverBounds({ width, height, data: new Uint8ClampedArray(0) }), null);
  }
});
