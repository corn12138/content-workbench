import { useEffect, useId, useState } from "react";

// Mermaid's configuration is process-global; serial rendering keeps simultaneous previews deterministic.
let queue: Promise<unknown> = Promise.resolve();
export function MermaidPreview({ source }: { source: string }) {
  const id = `diagram-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [result, setResult] = useState<{
    source: string;
    url?: string;
    error?: string;
  } | null>(null);
  useEffect(() => {
    let active = true;
    const render = async () => {
      if (!active) return;
      try {
        if (source.length > 30_000)
          throw new Error("图表超过 3 万字符，请拆成较小的图表。");
        // Per-document directives can override security/layout settings; use the workbench's fixed configuration.
        if (
          /%%\s*\{|^\s*---|(?:https?:|data:|file:|blob:|img\s*:|image\s*:)/im.test(
            source,
          )
        )
          throw new Error("暂不支持图表内配置指令，请移除配置后预览。");
        const [{ default: mermaid }, { default: purifier }] = await Promise.all(
          [import("mermaid"), import("dompurify")],
        );
        if (!active) return;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "default",
          htmlLabels: false,
          deterministicIds: true,
          deterministicIDSeed: "workbench",
          maxTextSize: 30_000,
          flowchart: { htmlLabels: false, useMaxWidth: true },
          suppressErrorRendering: true,
        });
        const { svg } = await mermaid.render(id, source);
        // Display as an image rather than live SVG: links, callbacks and embedded HTML cannot interact with the app.
        const safe = purifier.sanitize(svg.replaceAll(id, "diagram"), {
          USE_PROFILES: { svg: true, svgFilters: true },
          FORBID_TAGS: ["foreignObject", "image", "a", "script"],
        });
        const xml = new DOMParser().parseFromString(safe, "image/svg+xml");
        if (xml.querySelector("parsererror"))
          throw new Error("Invalid diagram image");
        const root = xml.documentElement;
        const [, , width, height] = (root.getAttribute("viewBox") || "")
          .trim()
          .split(/[\s,]+/)
          .map(Number);
        if (
          !Number.isFinite(width) ||
          !Number.isFinite(height) ||
          width <= 0 ||
          height <= 0
        )
          throw new Error("Invalid diagram dimensions");
        // Explicit intrinsic dimensions keep percentage-width SVGs identical across preview containers.
        const scale = Math.min(1, 4096 / Math.max(width, height));
        root.setAttribute("width", String(Math.ceil(width * scale)));
        root.setAttribute("height", String(Math.ceil(height * scale)));
        const image = new XMLSerializer().serializeToString(root);
        // A data URL works in WKWebView custom origins; isolated images can share stable SVG IDs.
        if (active)
          setResult({
            source,
            url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(image)}`,
          });
      } catch {
        if (active)
          setResult({
            source,
            error:
              "图表未能渲染，请检查 Mermaid 语法、长度或配置指令。源码仍保留在下方。",
          });
      } finally {
        document.getElementById(id)?.remove();
        document.getElementById(`d${id}`)?.remove();
      }
    };
    queue = queue.then(render, render);
    return () => {
      active = false;
    };
  }, [source, id]);
  const current = result?.source === source ? result : null;
  return (
    <div className="mermaid-preview" aria-label="Mermaid 图表">
      {current?.url ? (
        <img
          src={current.url}
          alt="Mermaid 图表"
          onError={() =>
            setResult({ source, error: "图表图片无法显示，源码仍保留在下方。" })
          }
        />
      ) : (
        <p role="status">{current?.error || "正在绘制图表…"}</p>
      )}
    </div>
  );
}
