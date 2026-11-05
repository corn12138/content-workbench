import type { PreparedImage } from "../../shared/contracts";

/** Summary of per-image results; results from an older revision are never treated as current. */
export function imageSummary(images: PreparedImage[], resultRevision: number | null, draftRevision: number) {
  const ready = images.filter((image) => image.status === "ready").length;
  const failed = images.length - ready;
  const stale = images.length > 0 && resultRevision !== draftRevision;
  const allReady = images.length > 0 && failed === 0;
  const text = !images.length
    ? "文中没有可准备的图片。"
    : stale
      ? `这是版本 ${resultRevision} 的准备结果，原稿之后有修改，请重新准备图片。`
      : allReady
        ? `${ready} 张图片已在本地准备好，按编号在掘金对应位置上传。`
        : ready
          ? `${ready} 张已准备，${failed} 张未能准备。可以只重试失败的图片，或在掘金手动上传。`
          : `没有可用图片：${failed} 张未能准备。请检查原始链接或重新插入后重试。`;
  return { ready, failed, stale, allReady: allReady && !stale, text };
}
