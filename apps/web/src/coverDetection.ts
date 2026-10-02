export type CoverBounds = { unit: "%"; x: number; y: number; width: number; height: number };
export type DetectionPixels = { width: number; height: number; data: Uint8ClampedArray };
type Point = { x: number; y: number };
type Candidate = { left: number; top: number; right: number; bottom: number; score: number };

function cross(a: Point, b: Point, c: Point) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function convexHull(points: Point[]) {
  points.sort((a, b) => a.x - b.x || a.y - b.y);
  const lower: Point[] = [], upper: Point[] = [];
  for (const point of points) {
    while (lower.length > 1 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  for (let i = points.length - 1; i >= 0; i--) {
    const point = points[i];
    while (upper.length > 1 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function quadrilateral(hull: Point[], tolerance: number) {
  const points = [...hull];
  while (points.length > 4) {
    let minimum = Infinity, index = -1;
    for (let i = 0; i < points.length; i++) {
      const before = points[(i + points.length - 1) % points.length];
      const after = points[(i + 1) % points.length];
      const distance = Math.abs(cross(before, after, points[i])) / Math.hypot(after.x - before.x, after.y - before.y);
      if (distance < minimum) { minimum = distance; index = i; }
    }
    if (minimum > tolerance) return null;
    points.splice(index, 1);
  }
  if (points.length !== 4) return null;
  for (let i = 0; i < 4; i++) {
    const p = points[i], a = points[(i + 3) % 4], b = points[(i + 1) % 4];
    const cosine = ((a.x - p.x) * (b.x - p.x) + (a.y - p.y) * (b.y - p.y)) /
      (Math.hypot(a.x - p.x, a.y - p.y) * Math.hypot(b.x - p.x, b.y - p.y));
    if (!Number.isFinite(cosine) || Math.abs(cosine) > 0.4) return null;
  }
  return points;
}

function sideSupport(a: Point, b: Point, edges: Uint8Array, width: number, height: number) {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y));
  let supported = 0;
  for (let step = 0; step <= steps; step++) {
    const x = Math.round(a.x + (b.x - a.x) * step / steps);
    const y = Math.round(a.y + (b.y - a.y) * step / steps);
    let found = false;
    for (let dy = -3; dy <= 3 && !found; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height && edges[(y + dy) * width + x + dx]) {
          found = true; break;
        }
      }
    }
    if (found) supported++;
  }
  return supported / (steps + 1);
}

/** Conservative edge/contour detector. Ambiguous or incomplete outlines return null. */
export function detectCoverBounds({ width, height, data }: DetectionPixels): CoverBounds | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 24 || height < 24 ||
      width > 640 || height > 640 || data.length !== width * height * 4) return null;
  const size = width * height;
  const blurred = new Uint8Array(size * 3);
  // Blur each colour channel so equal-luminance cover/background colours still have edges.
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      for (let channel = 0; channel < 3; channel++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += data[((y + dy) * width + x + dx) * 4 + channel];
        blurred[(y * width + x) * 3 + channel] = Math.round(sum / 9);
      }
    }
  }
  const edges = new Uint8Array(size);
  const connected = new Uint8Array(size);
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const p = y * width + x;
      let strength = 0;
      for (let c = 0; c < 3; c++) {
        const sample = (dx: number, dy: number) => blurred[(p + dy * width + dx) * 3 + c];
        const gx = sample(1, -1) + 2 * sample(1, 0) + sample(1, 1) - sample(-1, -1) - 2 * sample(-1, 0) - sample(-1, 1);
        const gy = sample(-1, 1) + 2 * sample(0, 1) + sample(1, 1) - sample(-1, -1) - 2 * sample(0, -1) - sample(1, -1);
        strength = Math.max(strength, Math.hypot(gx, gy));
      }
      if (strength < 100) continue;
      edges[p] = 1;
      // Bridge small gaps before tracing connected outlines.
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) connected[p + dy * width + dx] = 1;
    }
  }
  const queue = new Int32Array(size);
  const candidates: Candidate[] = [];
  for (let start = 0; start < size; start++) {
    if (!connected[start]) continue;
    let head = 0, tail = 1;
    queue[0] = start; connected[start] = 0;
    const rowMin = new Int32Array(height).fill(width), rowMax = new Int32Array(height).fill(-1);
    let left = width, right = 0, top = height, bottom = 0;
    while (head < tail) {
      const p = queue[head++], x = p % width, y = Math.floor(p / width);
      rowMin[y] = Math.min(rowMin[y], x); rowMax[y] = Math.max(rowMax[y], x);
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && connected[next]) {
          connected[next] = 0; queue[tail++] = next;
        }
      }
    }
    const area = (right - left) * (bottom - top) / size;
    // A clipped outline cannot tell us where the book ends. Small artwork is not a cover.
    if (area < 0.15 || area > 0.96 || left <= 1 || top <= 1 || right >= width - 2 || bottom >= height - 2 ||
        right - left < width * 0.2 || bottom - top < height * 0.2) continue;
    const extremes: Point[] = [];
    for (let y = top; y <= bottom; y++) if (rowMax[y] >= 0) extremes.push({ x: rowMin[y], y }, { x: rowMax[y], y });
    const corners = quadrilateral(convexHull(extremes), Math.max(2, Math.max(right - left, bottom - top) * 0.015));
    if (!corners) continue;
    const supports = corners.map((point, i) => sideSupport(point, corners[(i + 1) % 4], edges, width, height));
    if (Math.min(...supports) < 0.8) continue;
    const support = supports.reduce((sum, value) => sum + value, 0) / 4;
    const centerDistance = Math.hypot((left + right) / 2 / width - 0.5, (top + bottom) / 2 / height - 0.5);
    candidates.push({ left, right, top, bottom, score: Math.sqrt(area) * support * (1 - centerDistance * 0.25) });
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) return null;
  // Ignore nested artwork, but never guess between similarly plausible separate books.
  const rival = candidates.slice(1).find(candidate => !(candidate.left >= best.left && candidate.right <= best.right &&
    candidate.top >= best.top && candidate.bottom <= best.bottom));
  if (rival && rival.score >= best.score * 0.8) return null;
  const padding = Math.max(2, Math.max(width, height) * 0.01);
  const x = Math.max(0, best.left - padding), y = Math.max(0, best.top - padding);
  const right = Math.min(width, best.right + padding + 1), bottom = Math.min(height, best.bottom + padding + 1);
  return { unit: "%", x: x / width * 100, y: y / height * 100, width: (right - x) / width * 100, height: (bottom - y) / height * 100 };
}
