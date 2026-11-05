const dayFormat = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" });
const timeFormat = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" });

export function updatedLabel(iso: string, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toDateString() === now.toDateString()
    ? `今天 ${timeFormat.format(date)}`
    : dayFormat.format(date);
}

export function excerpt(body: string) {
  let fenced = false;
  let line = "";
  for (const item of body.split("\n")) {
    // Code blocks are not prose; skip everything between fences.
    if (/^\s*(```|~~~)/.test(item)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || !item.trim() || /^(#|\||!\[|>|\s*[-*+]\s|\s*\d+\.\s|---)/.test(item)) continue;
    line = item;
    break;
  }
  return line
    .replace(/[`*_~]/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim()
    .slice(0, 90);
}
