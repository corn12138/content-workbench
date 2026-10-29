import { BookOpen, FileText, MessageSquare, Settings } from "lucide-react";

export type View = "drafts" | "feedback" | "reading" | "settings";
interface Props {
  view: View;
  draftCount: number;
  disabled: boolean;
  onChange: (view: View) => void;
}
const navigation = [
  { id: "drafts", label: "稿件", icon: FileText },
  { id: "feedback", label: "反馈", icon: MessageSquare },
  { id: "reading", label: "阅读", icon: BookOpen },
] as const;
export function Sidebar({ view, draftCount, disabled, onChange }: Props) {
  return (
    <aside className="sidebar">
      <div className="titlebar-space" data-tauri-drag-region />
      <div className="brand">
        <div className="brand-icon">
          <FileText size={19} />
        </div>
        <span>内容工作台</span>
      </div>
      <nav aria-label="主导航">
        {navigation.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            disabled={disabled}
            className={view === id ? "nav-item active" : "nav-item"}
            aria-current={view === id ? "page" : undefined}
            onClick={() => onChange(id)}
          >
            <Icon size={18} />
            <span>{label}</span>
            {id === "drafts" && draftCount > 0 && <small>{draftCount}</small>}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="local-indicator">
          <span />
          资料保存在本机
        </div>
        <button
          disabled={disabled}
          className={view === "settings" ? "nav-item active" : "nav-item"}
          aria-current={view === "settings" ? "page" : undefined}
          onClick={() => onChange("settings")}
        >
          <Settings size={17} />
          设置
        </button>
      </div>
    </aside>
  );
}
