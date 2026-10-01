import { useState } from "react";

export function FamilyAvatar({ name, src, className = "shop-avatar", decorative = false }: {
  name: string;
  src?: string | null;
  className?: string;
  decorative?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return <span className={`${className} family-avatar-image`} aria-hidden={decorative || undefined}>
    {src && failed !== src
      ? <img src={src} alt={decorative ? "" : `${name}头像`} onError={() => setFailed(src)} />
      : <span>{[...name][0] || "书"}</span>}
  </span>;
}
