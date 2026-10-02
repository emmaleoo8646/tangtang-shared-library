import { useEffect, useRef, useState } from "react";
import ReactCrop, { convertToPercentCrop, convertToPixelCrop, type Crop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { compressCrop, MAX_ORIGINAL_BYTES, squareCrop } from "./imageProcessing";
import { autoCoverCrop } from "./autoCoverCrop";

export function CoverCropDialog({ file, onClose, onUse, kind = "cover" }: { file: File; kind?: "cover" | "avatar"; onClose: () => void; onUse: (image: string, bytes: number) => void }) {
  const label = kind === "avatar" ? "头像" : "封面";
  const square = kind === "avatar";
  const [source, setSource] = useState("");
  const [crop, setCrop] = useState<Crop>({ unit: "%", x: 0, y: 0, width: 100, height: 100 });
  const [preview, setPreview] = useState<{ src: string; bytes: number } | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [ready, setReady] = useState(false);
  const [detectionNotice, setDetectionNotice] = useState("");
  const imageRef = useRef<HTMLImageElement>(null);
  const detectionRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const activeUrlRef = useRef("");
  const workingRef = useRef(false);

  useEffect(() => {
    generationRef.current++;
    detectionRef.current?.abort();
    workingRef.current = false;
    setWorking(false); setReady(false); setPreview(null); setSource(""); setError(""); setDetectionNotice("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("请选择 JPG、PNG 或 WebP 照片"); return; }
    if (file.size > MAX_ORIGINAL_BYTES) { setError("原始照片不能超过 20 MB"); return; }
    const url = URL.createObjectURL(file);
    activeUrlRef.current = url;
    setSource(url);
    return () => {
      generationRef.current++;
      activeUrlRef.current = "";
      detectionRef.current?.abort();
      URL.revokeObjectURL(url);
    };
  }, [file, kind]);

  function manualAdjustment() {
    if (workingRef.current) return;
    if (detectionRef.current && !detectionRef.current.signal.aborted) {
      detectionRef.current.abort();
    }
    if (!square) setDetectionNotice("可继续调整裁剪范围，或直接确认");
  }

  async function detectEdges(image: HTMLImageElement) {
    detectionRef.current?.abort();
    const controller = new AbortController();
    detectionRef.current = controller;
    const generation = generationRef.current;
    setDetectionNotice("正在识别封面边缘…");
    const detected = await autoCoverCrop(image, controller.signal);
    if (controller.signal.aborted || generation !== generationRef.current || workingRef.current) return;
    if (detected) {
      setCrop(detected);
      setDetectionNotice("已自动选择封面，可调整后确认");
    } else {
      setDetectionNotice("未能准确识别边缘，请手动调整");
    }
  }

  function close() {
    generationRef.current++;
    detectionRef.current?.abort();
    onClose();
  }

  async function processCrop(use: boolean) {
    const image = imageRef.current;
    if (!image || !ready || workingRef.current) return;
    const selected = convertToPixelCrop(crop, image.naturalWidth, image.naturalHeight);
    if (!selected.width || !selected.height) { setError("请先选择裁剪区域"); return; }
    detectionRef.current?.abort();
    if (detectionNotice === "正在识别封面边缘…") setDetectionNotice("当前裁剪范围可调整后确认");
    workingRef.current = true;
    const generation = generationRef.current;
    setWorking(true);
    setError("");
    try {
      const x = Math.max(0, Math.round(selected.x));
      const y = Math.max(0, Math.round(selected.y));
      const width = Math.min(image.naturalWidth - x, Math.round(selected.width));
      const height = Math.min(image.naturalHeight - y, Math.round(selected.height));
      const sourceWidth = square ? Math.min(width, height) : width;
      const sourceHeight = square ? sourceWidth : height;
      if (sourceWidth < 1 || sourceHeight < 1) throw new Error("请选择有效的裁剪区域");
      const result = preview || await compressCrop(image, x, y, sourceWidth, sourceHeight);
      if (generation !== generationRef.current) return;
      if (use) {
        generationRef.current++;
        onUse(result.src, result.bytes);
      } else setPreview(result);
    } catch (cause) {
      if (generation === generationRef.current) setError(cause instanceof Error ? cause.message : "无法处理图片，请重试");
    } finally {
      if (generation === generationRef.current) { workingRef.current = false; setWorking(false); }
    }
  }

  return (
    <div className="modal-backdrop crop-backdrop">
      <div className={`crop-dialog ${square ? "crop-dialog--avatar" : ""}`} role="dialog" aria-modal="true" aria-labelledby="crop-title">
        <button className="modal-close" type="button" aria-label="关闭裁剪" onClick={close}>×</button>
        <h2 id="crop-title">裁剪{label}照片</h2>
        <p>{square ? "拖动裁剪框选择头像区域，头像将以方形圆角展示。" : "拖动边框保留完整书名和封面；也可以用键盘调整。"}原图只在浏览器中处理，服务器仅保存压缩后的{label}。</p>
        {source && <div className="crop-workspace"
          onPointerDownCapture={manualAdjustment}
          onKeyDownCapture={event => { if (event.key.startsWith("Arrow")) manualAdjustment(); }}>
          <ReactCrop aspect={square ? 1 : undefined} crop={crop} keepSelection disabled={working || !ready}
            onChange={(_, percent) => {
              if (workingRef.current) return;
              manualAdjustment(); setCrop(percent); setPreview(null); setError("");
            }}>
            <img ref={imageRef} src={source} alt={`待裁剪的原始${label}`}
              onError={() => {
                detectionRef.current?.abort(); setReady(false);
                setError("照片无法读取，请重新选择 JPG、PNG 或 WebP 图片"); setSource("");
              }}
              onLoad={event => {
                const image = event.currentTarget;
                if (image.src !== activeUrlRef.current) return;
                if (image.naturalWidth * image.naturalHeight > 100_000_000) {
                  setError("照片像素过大，请先在手机相册中缩小后再选"); setSource(""); return;
                }
                const initial = square ? squareCrop(image.width, image.height)
                  : { unit: "px" as const, x: 0, y: 0, width: image.width, height: image.height };
                setCrop(convertToPercentCrop(initial, image.width, image.height));
                setReady(true);
                if (!square) void detectEdges(image);
              }} />
          </ReactCrop>
        </div>}
        {!square && detectionNotice && <p role="status" aria-live="polite">{detectionNotice}</p>}
        {error && <p className="crop-error" role="alert">{error}</p>}
        {preview && <div className="crop-result"><img src={preview.src} alt={`最终${label}预览`} /><span>最终{label}：{Math.round(preview.bytes / 1000)} KB · JPEG</span></div>}
        <div className="crop-actions">
          <button className="secondary-button" type="button" onClick={close}>取消</button>
          <button className="secondary-button" type="button" disabled={!ready || working} onClick={() => void processCrop(false)}>{working ? "处理中…" : "预览裁剪结果"}</button>
          <button className="primary-button" type="button" disabled={!ready || working || (square && !preview)} onClick={() => void processCrop(true)}>使用此{label}</button>
        </div>
      </div>
    </div>
  );
}
