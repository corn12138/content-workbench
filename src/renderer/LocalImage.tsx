import { useEffect, useState } from "react";
import { api } from "./api";

export function LocalImage({
  reference,
  alt,
  title,
}: {
  reference?: string;
  alt?: string;
  title?: string;
}) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{
    reference: string;
    url?: string;
    error?: string;
  } | null>(null);
  const name = reference?.match(
    /^assets\/([a-f0-9]{64}\.(?:png|jpg|gif|webp))$/,
  )?.[1];
  useEffect(() => {
    if (!name || !api.assetData) return;
    let active = true;
    void api.assetData(name).then(
      (url) => {
        if (active) setLoaded({ reference: name, url });
      },
      () => {
        if (active)
          setLoaded({
            reference: name,
            error: "图片暂时无法读取，请重新插入。",
          });
      },
    );
    return () => {
      active = false;
    };
  }, [name, attempt]);
  const current = loaded?.reference === name ? loaded : null;
  if (name && current?.url)
    return (
      <img
        className="local-image"
        src={current.url}
        alt={alt ?? "文章图片"}
        title={title}
        onError={() =>
          setLoaded({
            reference: name,
            error: "图片无法显示，请检查原图或重新插入。",
          })
        }
        loading="lazy"
      />
    );
  return (
    <span className="image-placeholder" role="status">
      {name && api.assetData
        ? current?.error || "正在读取图片…"
        : `图片：${alt || "未命名"}（尚未保存在本机，请插入图片或从文章目录导入）`}
      {name && current?.error && (
        <button
          type="button"
          onClick={() => {
            setLoaded(null);
            setAttempt((value) => value + 1);
          }}
        >
          重试读取
        </button>
      )}
    </span>
  );
}
