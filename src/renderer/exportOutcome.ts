import type { ExportReceipt } from "../shared/contracts";

/** Describes an exported copy without implying anything about the database save. */
export function exportOutcome(receipt: ExportReceipt, saveFailed: boolean) {
  const parts = [
    receipt.bundled
      ? `已另存为 ${receipt.filename}（含 ${receipt.images} 张图片）`
      : `已另存为 ${receipt.filename}`,
  ];
  if (receipt.missing) parts.push(`${receipt.missing} 处图片在资料库中找不到，未包含`);
  if (receipt.remote) parts.push(`${receipt.remote} 张外链图片保留为链接，未下载`);
  if (saveFailed) parts.push("这只是一份副本，稿件仍未保存到本机，请继续重试保存");
  return parts.join("。") + "。";
}
