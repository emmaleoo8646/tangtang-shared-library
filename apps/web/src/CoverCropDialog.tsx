import { useEffect, useRef, useState } from "react";
import ReactCrop, { convertToPercentCrop, convertToPixelCrop, type Crop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { compressCrop, MAX_ORIGINAL_BYTES, squareCrop } from "./imageProcessing";

export function CoverCropDialog({ file, onClose, onUse, kind = "cover" }: { file: File; kind?: "cover" | "avatar"; onClose: () => void; onUse: (image: string, bytes: number) => void }) {
  const label = kind === "avatar" ? "头像" : "封面";
  const square = kind === "avatar";
  const [source, setSource] = useState("");
  const [crop, setCrop] = useState<Crop>({ unit: "%", x: 0, y: 0, width: 100, height: 100 });
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
    if (!image) return;
    const selected = convertToPixelCrop(crop, image.width, image.height);
    if (!selected.width || !selected.height) { setError("请先选择裁剪区域"); return; }
    setWorking(true);
    setError("");
    try {
      const scaleX = image.naturalWidth / image.width;
      const scaleY = image.naturalHeight / image.height;
      const x = Math.round(selected.x * scaleX);
      const y = Math.round(selected.y * scaleY);
      const width = Math.min(image.naturalWidth - x, Math.round(selected.width * scaleX));
      const height = Math.min(image.naturalHeight - y, Math.round(selected.height * scaleY));
      const sourceWidth = square ? Math.min(width, height) : width;
      const sourceHeight = square ? sourceWidth : height;
      if (sourceWidth < 1 || sourceHeight < 1) throw new Error("请选择有效的裁剪区域");
      setPreview(await compressCrop(image, x, y, sourceWidth, sourceHeight));
    } catch (cause) { setError((cause as Error).message); }
    finally { setWorking(false); }
  }

  return (
    <div className="modal-backdrop crop-backdrop">
      <div className={`crop-dialog ${square ? "crop-dialog--avatar" : ""}`} role="dialog" aria-modal="true" aria-labelledby="crop-title">
        <button className="modal-close" type="button" aria-label="关闭裁剪" onClick={onClose}>×</button>
        <h2 id="crop-title">裁剪{label}照片</h2>
        <p>{square ? "拖动裁剪框选择头像区域，头像将以方形圆角展示。" : "拖动边框保留完整书名和封面；也可以用键盘调整。"}原图只在浏览器中处理，服务器仅保存压缩后的{label}。</p>
        {source && <div className="crop-workspace">
          <ReactCrop aspect={square ? 1 : undefined} crop={crop} keepSelection
            onChange={(_, percent) => { setCrop(percent); setPreview(null); setError(""); }}>
            <img ref={imageRef} src={source} alt={`待裁剪的原始${label}`}
              onError={() => { setError("照片无法读取，请重新选择 JPG、PNG 或 WebP 图片"); setSource(""); }}
              onLoad={event => {
                const image = event.currentTarget;
                if (image.naturalWidth * image.naturalHeight > 100_000_000) {
                  setError("照片像素过大，请先在手机相册中缩小后再选"); setSource(""); return;
                }
                const initial = square ? squareCrop(image.width, image.height)
                  : { unit: "px" as const, x: 0, y: 0, width: image.width, height: image.height };
                setCrop(convertToPercentCrop(initial, image.width, image.height));
              }} />
          </ReactCrop>
        </div>}
        {error && <p className="crop-error" role="alert">{error}</p>}
        {preview && <div className="crop-result"><img src={preview.src} alt={`最终${label}预览`} /><span>最终{label}：{Math.round(preview.bytes / 1000)} KB · JPEG</span></div>}
        <div className="crop-actions">
          <button className="secondary-button" type="button" onClick={onClose}>取消</button>
          <button className="secondary-button" type="button" disabled={!source || working || !!error} onClick={() => void makePreview()}>{working ? "处理中…" : "预览裁剪结果"}</button>
          <button className="primary-button" type="button" disabled={!preview} onClick={() => preview && onUse(preview.src, preview.bytes)}>使用此{label}</button>
        </div>
      </div>
    </div>
  );
}
