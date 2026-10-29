import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, History, ImagePlus, Send, X } from "lucide-react";
import type { Draft, Revision } from "../shared/contracts";
import { api, errorMessage } from "./api";
import { Markdown } from "./Markdown";
import { useDraftEditor } from "./useDraftEditor";

interface Props {
  draft: Draft;
  onSaved: (draft: Draft) => void;
  onPublish: (draft: Draft) => void;
  onArchive: (id: string) => Promise<void>;
  registerFlush: (flush: () => Promise<void>) => void;
  notify: (message: string) => void;
  onRestored: (draft: Draft) => void;
}
export function DraftEditor({
  draft,
  onSaved,
  onPublish,
  onArchive,
  registerFlush,
  notify,
  onRestored,
}: Props) {
  const editor = useDraftEditor(draft, onSaved, registerFlush);
  const [preview, setPreview] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const imagePending = useRef<Promise<void> | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  useEffect(() => {
    // Navigation and Quit must wait for the selected image to become part of the saved draft.
    registerFlush(async () => {
      await imagePending.current;
      await editor.flush();
    });
  }, [registerFlush, editor.flush]);
  const insertImage = () => {
    if (!api.insertImage || imagePending.current) return;
    const start = textarea.current?.selectionStart;
    const end = textarea.current?.selectionEnd;
    setImageBusy(true);
    const operation = (async () => {
      await editor.flush();
      const reference = await api.insertImage!();
      if (!reference) return;
      const body = editor.latest().body;
      const from = Math.min(start ?? body.length, body.length);
      const to = Math.min(end ?? from, body.length);
      editor.update({
        body: `${body.slice(0, from)}\n![图片](${reference})\n${body.slice(to)}`,
      });
      setPreview(false);
      await editor.flush();
    })()
      .catch((error) => {
        notify(errorMessage(error));
      })
      .finally(() => {
        imagePending.current = null;
        setImageBusy(false);
      });
    imagePending.current = operation;
  };
  const [history, setHistory] = useState<Revision[] | null>(null);
  const [selectedRevision, setSelectedRevision] = useState<Revision | null>(
    null,
  );
  const run = async (action: () => Promise<unknown>) => {
    try {
      await editor.flush();
      await action();
    } catch (error) {
      notify(errorMessage(error));
    }
  };
  return (
    <section className="detail-pane draft-editor" aria-label="稿件编辑">
      <header className="detail-header">
        <span className={"save-status " + (editor.error ? "error-text" : "")}>
          <Check size={13} />
          {editor.status}
        </span>
        <div className="toolbar">
          <details className="more-menu">
            <summary className="button quiet">
              更多 <ChevronDown size={13} />
            </summary>
            <div className="menu-items">
              <button
                onClick={() =>
                  void run(async () =>
                    setHistory(await api.revisions(draft.id)),
                  )
                }
              >
                <History size={15} />
                历史版本
              </button>
              <button
                onClick={() =>
                  void run(async () => {
                    if (await api.exportDraft(draft.id))
                      notify(
                        api.insertImage
                          ? "文章已导出，已保存的图片会一起带走"
                          : "已导出 Markdown",
                      );
                  })
                }
              >
                导出文章
              </button>
              <button onClick={() => void run(() => onArchive(draft.id))}>
                归档稿件
              </button>
            </div>
          </details>
          <button
            className="button primary"
            disabled={!editor.fields.body.trim()}
            onClick={() => void run(async () => onPublish(editor.current()))}
          >
            <Send size={15} />
            准备发布
          </button>
        </div>
      </header>
      {editor.error && (
        <div className="inline-error" role="alert">
          {editor.error}
          <button onClick={() => void editor.flush().catch(() => undefined)}>
            重试保存
          </button>
        </div>
      )}
      <div className="draft-heading">
        <input
          className="title-input"
          aria-label="文章标题"
          placeholder="给这篇文章起个名字"
          value={editor.fields.title}
          onChange={(e) => editor.update({ title: e.target.value })}
        />
        <div className="draft-meta">
          <input
            aria-label="所属项目（可选）"
            placeholder="添加项目（可选）"
            value={editor.fields.project}
            onChange={(e) => editor.update({ project: e.target.value })}
            maxLength={80}
          />
          <span>{editor.fields.body.length.toLocaleString()} 字符</span>
        </div>
      </div>
      <div className="editor-tabs" role="tablist" aria-label="编辑模式">
        <button
          role="tab"
          aria-selected={!preview}
          className={!preview ? "selected" : ""}
          onClick={() => setPreview(false)}
        >
          正文
        </button>
        <button
          role="tab"
          aria-selected={preview}
          className={preview ? "selected" : ""}
          onClick={() => setPreview(true)}
        >
          预览
        </button>
        {api.insertImage && (
          <button
            className="insert-image"
            onClick={insertImage}
            disabled={imageBusy}
          >
            <ImagePlus size={15} />
            {imageBusy ? "正在保存图片…" : "插入图片"}
          </button>
        )}
        <span>支持 Markdown</span>
      </div>
      {preview ? (
        <div className="editor-content preview">
          <Markdown text={editor.fields.body} />
        </div>
      ) : (
        <textarea
          ref={textarea}
          className="body-editor"
          aria-label="文章正文"
          placeholder="从这里开始写，或者粘贴在 Codex 中完成的内容…"
          value={editor.fields.body}
          onChange={(e) => editor.update({ body: e.target.value })}
          spellCheck={false}
        />
      )}
      {history && (
        <div className="history-panel">
          <header>
            <h3>历史版本</h3>
            <button
              className="icon-button"
              aria-label="关闭历史版本"
              onClick={() => {
                setHistory(null);
                setSelectedRevision(null);
              }}
            >
              <X size={18} />
            </button>
          </header>
          <div className="history-list">
            {history.map((item) => (
              <button
                key={item.revision}
                className={
                  selectedRevision?.revision === item.revision ? "active" : ""
                }
                onClick={() => setSelectedRevision(item)}
              >
                <span>
                  版本 {item.revision} · {item.title || "未命名"}
                </span>
                <small>{new Date(item.savedAt).toLocaleString()}</small>
              </button>
            ))}
          </div>
          {selectedRevision && (
            <>
              <div className="history-preview">
                <Markdown text={selectedRevision.body} />
              </div>
              <button
                className="button"
                onClick={() =>
                  void run(async () => {
                    const restored = await api.restoreRevision(
                      draft.id,
                      selectedRevision.revision,
                      editor.current().revision,
                    );
                    onRestored(restored);
                    notify("已恢复为新版本，旧记录仍保留");
                  })
                }
              >
                恢复这个版本
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
