import { useLayoutEffect, useRef, useState } from "react";

export type AiBusyTone = "thinking" | "done" | "error";

interface AiBusyNoteProps {
  text: string;
  busy: boolean;
  /** When `text` exactly matches this string, the note renders the error expression. */
  errorText?: string;
  /** Force a specific tone (overrides auto-detection). */
  tone?: AiBusyTone;
}

function resolveTone(text: string, busy: boolean, errorText: string | undefined, tone: AiBusyTone | undefined): AiBusyTone {
  if (tone) return tone;
  if (busy) return "thinking";
  if (errorText && text === errorText) return "error";
  return "done";
}

export function AiBusyNote({ text, busy, errorText, tone }: AiBusyNoteProps) {
  const containerRef = useRef<HTMLParagraphElement>(null);
  const [dropPath, setDropPath] = useState("");

  useLayoutEffect(() => {
    if (!busy || !containerRef.current) { setDropPath(""); return; }
    const el = containerRef.current;
    const update = () => {
      if (!el.offsetWidth || !el.offsetHeight) { setDropPath(""); return; }
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const r = 13;
      setDropPath(`M ${r} 0 L ${w - r} 0 Q ${w} 0 ${w} ${r} L ${w} ${h - r} Q ${w} ${h} ${w - r} ${h} L ${r} ${h} Q 0 ${h} 0 ${h - r} L 0 ${r} Q 0 0 ${r} 0 Z`);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [busy]);

  if (!text) return null;
  const resolvedTone = resolveTone(text, busy, errorText, tone);
  const loading = busy || resolvedTone === "thinking";

  return (
    <p
      ref={containerRef}
      className={`suggestion-note suggestion-note--${resolvedTone}${loading ? " suggestion-note--loading" : ""}`}
      role="status"
      aria-live="polite"
      aria-busy={loading || undefined}
    >
      {loading && dropPath && (
        <span
          className="suggestion-note__drop"
          style={{ offsetPath: `path('${dropPath}')` }}
          aria-hidden="true"
        />
      )}
      <span className="suggestion-note__robot" aria-hidden="true">
        <svg className="suggestion-note__robot-svg" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <g className="suggestion-note__robot-gaze">
            <g className="suggestion-note__robot-antenna">
              <line x1="16" y1="6" x2="16" y2="9" stroke="#e66e4e" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="16" cy="5" r="1.6" fill="#e66e4e" />
            </g>
            <rect x="5" y="9" width="22" height="18" rx="4" stroke="#e66e4e" strokeWidth="1.5" fill="rgba(230,110,78,.08)" />
            {resolvedTone === "thinking" && (
              <>
                <circle className="suggestion-note__robot-eye" cx="12" cy="17" r="2" fill="#e66e4e" />
                <circle className="suggestion-note__robot-eye" cx="20" cy="17" r="2" fill="#e66e4e" />
                <rect x="13" y="22" width="6" height="1.6" rx="0.8" fill="#e66e4e" />
              </>
            )}
            {resolvedTone === "done" && (
              <>
                <path d="M 10 18 Q 12 14.5 14 18" stroke="#e66e4e" strokeWidth="1.6" fill="none" strokeLinecap="round" />
                <path d="M 18 18 Q 20 14.5 22 18" stroke="#e66e4e" strokeWidth="1.6" fill="none" strokeLinecap="round" />
                <path d="M 12.5 21.5 Q 16 24.2 19.5 21.5" stroke="#e66e4e" strokeWidth="1.6" fill="none" strokeLinecap="round" />
              </>
            )}
            {resolvedTone === "error" && (
              <>
                <path d="M 10 17 L 14 17" stroke="#e66e4e" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M 18 17 L 22 17" stroke="#e66e4e" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M 12.5 22.8 Q 16 19.8 19.5 22.8" stroke="#e66e4e" strokeWidth="1.6" fill="none" strokeLinecap="round" />
              </>
            )}
            <rect x="3" y="14" width="2" height="6" rx="1" fill="#e66e4e" />
            <rect x="27" y="14" width="2" height="6" rx="1" fill="#e66e4e" />
          </g>
          {resolvedTone === "done" && (
            <g className="suggestion-note__robot-spark" aria-hidden="true">
              <path d="M 28.5 4 L 29.6 6.4 L 31.6 7.5 L 29.6 8.6 L 28.5 11 L 27.4 8.6 L 25.4 7.5 L 27.4 6.4 Z" fill="#ffc17a" />
            </g>
          )}
        </svg>
        {loading && (
          <span className="suggestion-note__thought">
            <i /><i /><i />
          </span>
        )}
      </span>
      <span className="suggestion-note__text">{text}</span>
    </p>
  );
}
