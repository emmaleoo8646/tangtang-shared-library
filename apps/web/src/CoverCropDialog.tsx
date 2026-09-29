import { useEffect, useRef, useState } from "react";
import ReactCrop, { type Crop, type PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";

const MAX_ORIGINAL_BYTES = 20_000_000;
const MAX_STORED_BYTES = 600_000;

function jpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("无法生成封面预览")), "image/jpeg", quality));
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("无法读取裁剪结果"));
    reader.readAsDataURL(blob);
  });
}

export function CoverCropDialog({ file, onClose, onUse }: { file: File; onClose: () => void; onUse: (image: string, bytes: number) => void }) {
  const [source, setSource] = useState("");
  const [crop, setCrop] = useState<Crop>({ unit: "%", x: 0, y: 0, width: 100, height: 100 });
  const [completed, setCompleted] = useState<PixelCrop | null>(null);
  const [preview, setPreview] = useState<{ src: string; bytes: number } | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("请选择 JPG、PNG 或 WebP 照片"); return; }
    if (file.size > MAX_ORIGINAL_BYTES) { setError("原始照片不能超过 20 MB"); return; }
    const url = URL.createObjectURL(file);
    setSource(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function makePreview() {
    const image = imageRef.current;
    const selected = completed;
    if (!image || !selected?.width || !selected.height) { setError("请先选择裁剪区域"); return; }
    setWorking(true);
    setError("");
    try {
      const scaleX = image.naturalWidth / image.width;
      const scaleY = image.naturalHeight / image.height;
      const x = Math.round(selected.x * scaleX);
      const y = Math.round(selected.y * scaleY);
      const sourceWidth = Math.min(image.naturalWidth - x, Math.round(selected.width * scaleX));
      const sourceHeight = Math.min(image.naturalHeight - y, Math.round(selected.height * scaleY));
      if (sourceWidth < 1 || sourceHeight < 1) throw new Error("请选择有效的裁剪区域");
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
      setPreview({ src: await dataUrl(blob), bytes: blob.size });
    } catch (cause) { setError((cause as Error).message); }
    finally { setWorking(false); }
  }

  return (
    <div className="modal-backdrop crop-backdrop">
      <div className="crop-dialog" role="dialog" aria-modal="true" aria-labelledby="crop-title">
        <button className="modal-close" type="button" aria-label="关闭裁剪" onClick={onClose}>×</button>
        <h2 id="crop-title">裁剪封面照片</h2>
        <p>拖动边框保留完整书名和封面；也可以用键盘调整。原图只在浏览器中处理，服务器仅保存压缩后的封面。</p>
        {source && <div className="crop-workspace"><ReactCrop crop={crop} onChange={(_, percent) => { setCrop(percent); setPreview(null); }} onComplete={(pixel) => { setCompleted(pixel); setPreview(null); }} keepSelection><img ref={imageRef} src={source} alt="待裁剪的原始封面" onLoad={(event) => { const image = event.currentTarget; if (image.naturalWidth * image.naturalHeight > 100_000_000) setError("照片像素过大，请先在手机相册中缩小后再选"); else setCompleted({ unit: "px", x: 0, y: 0, width: image.width, height: image.height }); }} /></ReactCrop></div>}
        {error && <p className="crop-error" role="alert">{error}</p>}
        {preview && <div className="crop-result"><img src={preview.src} alt="最终封面预览" /><span>最终封面：{Math.round(preview.bytes / 1000)} KB · JPEG</span></div>}
        <div className="crop-actions">
          <button className="secondary-button" type="button" onClick={onClose}>取消</button>
          <button className="secondary-button" type="button" disabled={!source || working || !!error} onClick={() => void makePreview()}>{working ? "处理中…" : "预览裁剪结果"}</button>
          <button className="primary-button" type="button" disabled={!preview} onClick={() => preview && onUse(preview.src, preview.bytes)}>使用此封面</button>
        </div>
      </div>
    </div>
  );
}
