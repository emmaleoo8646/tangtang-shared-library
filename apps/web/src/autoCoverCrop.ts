import type { CoverBounds } from "./coverDetection";

/** Everything stays local; aborts, worker errors and timeouts all fall back to manual cropping. */
export function autoCoverCrop(image: HTMLImageElement, signal: AbortSignal): Promise<CoverBounds | null> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(null); return; }
    let worker: Worker | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (result: CoverBounds | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker?.terminate();
      signal.removeEventListener("abort", abort);
      resolve(result);
    };
    const abort = () => finish(null);
    signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => finish(null), 2000);
    try {
      const ratio = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) { finish(null); return; }
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      worker = new Worker(new URL("./coverDetection.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<CoverBounds | null>) => finish(event.data);
      worker.onerror = event => { event.preventDefault(); finish(null); };
      worker.onmessageerror = () => finish(null);
      worker.postMessage({ width: pixels.width, height: pixels.height, data: pixels.data }, [pixels.data.buffer]);
    } catch { finish(null); }
  });
}
