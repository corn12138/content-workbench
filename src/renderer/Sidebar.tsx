import { BookOpen, FileText, HardDrive, NotebookPen, Send, Settings } from "lucide-react";

/** "feedback" keeps its historical id; the page is presented as 发布记录 with the same data. */
export type View = "drafts" | "feedback" | "reading" | "settings";
interface Props {
  view: View;
  draftCount: number;
  unreadCount: number;
  disabled: boolean;
  onChange: (view: View) => void;
}
const navigation = [
  { id: "drafts", label: "稿件", icon: FileText },
  { id: "reading", label: "阅读", icon: BookOpen },
  { id: "feedback", label: "发布记录", icon: Send },
] as const;
export function Sidebar({ view, draftCount, unreadCount, disabled, onChange }: Props) {
  const counts: Partial<Record<View, [number, string]>> = {
    drafts: [draftCount, `${draftCount} 篇稿件`],
    reading: [unreadCount, `${unreadCount} 篇未读`],
  };
  return (
    <aside className="sidebar">
      <div className="titlebar-space" data-tauri-drag-region />
      <div className="brand">
        <NotebookPen size={19} aria-hidden="true" />
        <span>内容工作台</span>
      </div>
      <nav aria-label="主导航">
        {navigation.map(({ id, label, icon: Icon }) => {
          const count = counts[id];
          return (
            <button
              key={id}
              type="button"
              disabled={disabled}
              className={view === id ? "nav-item active" : "nav-item"}
              aria-current={view === id ? "page" : undefined}
              onClick={() => onChange(id)}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
              {count && count[0] > 0 && <small aria-label={count[1]}>{count[0]}</small>}
            </button>
          );
        })}
      </nav>
      <div className="sidebar-bottom">
        <button
          type="button"
          disabled={disabled}
          className={view === "settings" ? "nav-item active" : "nav-item"}
          aria-current={view === "settings" ? "page" : undefined}
          onClick={() => onChange("settings")}
        >
          <Settings size={17} aria-hidden="true" />
          <span>设置</span>
        </button>
        <div className="local-indicator">
          <HardDrive size={13} aria-hidden="true" />
          资料保存在本机
        </div>
      </div>
    </aside>
  );
}
