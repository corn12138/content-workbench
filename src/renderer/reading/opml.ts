import type { OpmlEntry } from "../../shared/contracts";

const labels: Record<OpmlEntry["status"], string> = {
  new: "将添加",
  resubscribe: "将重新订阅",
  duplicate: "已存在",
  invalid: "地址无效",
  blocked: "本机或内网地址",
  overLimit: "超出 50 个上限",
};

export const opmlLabel = (entry: OpmlEntry) =>
  entry.status === "duplicate" && entry.reason ? entry.reason : labels[entry.status];

export function opmlCounts(entries: OpmlEntry[]) {
  const addable = entries.filter((e) => e.status === "new" || e.status === "resubscribe").length;
  const duplicate = entries.filter((e) => e.status === "duplicate").length;
  return { addable, duplicate, skipped: entries.length - addable - duplicate };
}
