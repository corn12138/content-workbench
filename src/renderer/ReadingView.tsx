import { useState, type FormEvent } from "react";
import { BookOpen, Link2, Plus } from "lucide-react";
import type { Draft, Reading } from "../shared/contracts";
import { api } from "./api";
import { ReadingAddForm } from "./reading/ReadingAddForm";
import { ReadingDetail } from "./reading/ReadingDetail";
import { ReadingList, type ReadingFilter } from "./reading/ReadingList";
import { useReadingEditor } from "./reading/useReadingEditor";
import "./reading.css";

interface ReadingViewProps {
  items: Reading[];
  onRefresh: () => Promise<void>;
  onDraft: (draft: Draft) => Promise<void>;
  notify: (message: string) => void;
  registerFlush: (flush: () => Promise<void>) => void;
}

export function ReadingView(props: ReadingViewProps) {
  const editor = useReadingEditor(props);
  const [filter, setFilter] = useState<ReadingFilter>("all");
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const select = async (next: Reading) => {
    if (editor.record?.id === next.id || busy) return;
    setBusy(true);
    try {
      await editor.flush();
      editor.selectSaved(next);
    } catch {
      props.notify("请先保存当前笔记，再切换文章。");
    } finally {
      setBusy(false);
    }
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFormError("");
    try {
      await editor.flush();
      const parsed = new URL(url.trim());
      if (!["https:", "http:"].includes(parsed.protocol))
        throw new Error("请填写以 https:// 或 http:// 开头的文章链接。");
      const existing = props.items.find((item) => item.url === parsed.href);
      const saved =
        existing ??
        (await api.saveReading({
          url: parsed.href,
          title: title.trim(),
          note: "",
          read: false,
        }));
      await props.onRefresh();
      editor.selectSaved(saved);
      setFilter("all");
      setAdding(false);
      setUrl("");
      setTitle("");
      props.notify(existing ? "这个链接已收藏，已为你打开。" : "已加入阅读。");
    } catch (error) {
      setFormError(
        error instanceof TypeError
          ? "请填写完整的文章链接。"
          : error instanceof Error
            ? error.message
            : "链接未能保存，请重试。",
      );
    } finally {
      setBusy(false);
    }
  };

  const convert = async () => {
    if (!editor.record || busy) return;
    setBusy(true);
    let created = false;
    try {
      await editor.flush();
      const draft = await api.readingToDraft(editor.record.id);
      created = true;
      await props.onDraft(draft);
    } catch (error) {
      props.notify(
        created
          ? "稿件已创建，可在“稿件”中查看。"
          : error instanceof Error
            ? error.message
            : "暂时无法创建稿件。",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="reading-workspace" aria-label="阅读与笔记">
      <header className="detail-header reading-header">
        <div>
          <p className="eyebrow">从阅读到自己的想法</p>
          <h1>阅读</h1>
          <p className="muted">把有用的链接留下，把想法记在旁边。</p>
        </div>
        <button
          className="button primary"
          onClick={() => setAdding((value) => !value)}
          aria-expanded={adding}
        >
          <Plus size={16} />
          添加链接
        </button>
      </header>
      {adding && (
        <ReadingAddForm
          url={url}
          title={title}
          busy={busy}
          error={formError}
          setUrl={setUrl}
          setTitle={setTitle}
          add={add}
          cancel={() => setAdding(false)}
        />
      )}
      {props.items.length === 0 ? (
        <div className="empty-state reading-empty">
          <span className="reading-empty-icon">
            <BookOpen size={30} strokeWidth={1.4} />
          </span>
          <h2>下一篇好文章，从这里留下</h2>
          <p>
            保存技术文章、版本公告或项目文档。
            <br />
            阅读后记下一点想法，下次写作就有了起点。
          </p>
          <button className="button" onClick={() => setAdding(true)}>
            <Link2 size={16} />
            添加第一个链接
          </button>
          <span className="muted reading-local-hint">
            资料和笔记保存在你的电脑上
          </span>
        </div>
      ) : (
        <div className="split-view reading-split">
          <ReadingList
            items={props.items}
            selectedId={editor.record?.id}
            filter={filter}
            setFilter={setFilter}
            select={select}
            busy={busy}
          />
          {editor.record && (
            <ReadingDetail
              record={editor.record}
              busy={busy}
              saveState={editor.saveState}
              saveError={editor.saveError}
              edit={editor.edit}
              flush={editor.flush}
              convert={convert}
              notify={props.notify}
            />
          )}
        </div>
      )}
    </section>
  );
}
