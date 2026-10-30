import { useEffect, useRef, useState } from "react";
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
  const [remoteBusy, setRemoteBusy] = useState<string | null>(null);
  const request = useRef(0);
  useEffect(() => {
    setRemoteBusy(null);
    // A late image response must not overwrite a newer source or an unmounted preview.
    return () => {
      request.current += 1;
    };
  }, [reference]);
  const remote =
    reference && /^https?:\/\//i.test(reference) ? reference : undefined;
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
  const current = loaded?.reference === (name || remote) ? loaded : null;
  if (current?.url)
    return (
      <img
        className="local-image"
        src={current.url}
        alt={alt ?? "文章图片"}
        title={title}
        onError={() =>
          setLoaded({
            reference: (name || remote)!,
            error: "图片无法显示，请检查原图或重新插入。",
          })
        }
        loading="lazy"
      />
    );
  return (
    <span className="image-placeholder" role="status">
      {remote && api.remoteImagePreview ? (
        <>
          {current?.error || `外链图片：${alt || "未命名"}`}
          <button
            type="button"
            disabled={remoteBusy === remote}
            onClick={() => {
              const generation = ++request.current;
              setRemoteBusy(remote);
              void api.remoteImagePreview!(remote)
                .then(
                  (url) => {
                    if (generation === request.current)
                      setLoaded({ reference: remote, url });
                  },
                  () => {
                    if (generation === request.current)
                      setLoaded({
                        reference: remote,
                        error: "外链图片无法读取，请检查图片地址或网络。",
                      });
                  },
                )
                .finally(() => {
                  if (generation === request.current) setRemoteBusy(null);
                });
            }}
          >
            {remoteBusy === remote ? "正在加载…" : "加载这张图片"}
          </button>
          <small>点击后将访问图片网站；不会携带账号或 Cookie。</small>
        </>
      ) : (
        <>
          {name && api.assetData
            ? current?.error || "正在读取图片…"
            : `图片：${alt || "未命名"}（尚未保存在本机，请插入图片或从文章目录导入）`}
        </>
      )}
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
