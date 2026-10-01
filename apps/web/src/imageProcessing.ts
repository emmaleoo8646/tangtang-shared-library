export const MAX_ORIGINAL_BYTES = 20_000_000;
export const MAX_STORED_BYTES = 600_000;

function jpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("无法生成图片预览")), "image/jpeg", quality));
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("无法读取裁剪结果"));
    reader.readAsDataURL(blob);
  });
}

export function squareCrop(width: number, height: number) {
  const size = Math.min(width, height);
  return { unit: "px" as const, x: (width - size) / 2, y: (height - size) / 2, width: size, height: size };
}

export async function compressCrop(image: HTMLImageElement, x: number, y: number, sourceWidth: number, sourceHeight: number) {
  const canvas = document.createElement("canvas");
  let blob: Blob | null = null;
  for (const longest of [960, 900, 840, 780, 720, 660, 600, 540, 480, 420, 360, 300, 240, 180, 120]) {
    const ratio = Math.min(1, longest / Math.max(sourceWidth, sourceHeight));
    canvas.width = Math.max(1, Math.round(sourceWidth * ratio));
    canvas.height = Math.max(1, Math.round(sourceHeight * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法处理这张图片");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, x, y, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.84, 0.78, 0.72, 0.66]) {
      const candidate = await jpegBlob(canvas, quality);
      if (candidate.size <= MAX_STORED_BYTES) { blob = candidate; break; }
    }
    if (blob) break;
  }
  if (!blob) throw new Error("裁剪结果仍然过大，请调整区域后重试");
  return { src: await dataUrl(blob), bytes: blob.size };
}
