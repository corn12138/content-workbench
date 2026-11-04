import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Archive,
  Check,
  ChevronLeft,
  Download,
  Ellipsis,
  Eye,
  History,
  ImagePlus,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PencilLine,
  Send,
  TriangleAlert,
  X,
} from "lucide-react";
import type { Draft, Revision } from "../shared/contracts";
import { api, errorMessage } from "./api";
import { Markdown } from "./Markdown";
import { useDraftEditor } from "./useDraftEditor";
import { updatedLabel } from "./draftText";
import { shortcutFor, shortcutLabel } from "./shortcuts";
import { exportOutcome } from "./exportOutcome";

interface Props {
  draft: Draft;
  onSaved: (draft: Draft) => void;
  onPublish: (draft: Draft) => void;
  onArchive: (id: string) => Promise<void>;
  registerFlush: (flush: () => Promise<void>) => void;
  notify: (message: string) => void;
  onRestored: (draft: Draft) => void;
  compact: boolean;
  listCollapsed: boolean;
  onToggleList: () => void;
  onBack: () => void;
  publishButton: React.RefObject<HTMLButtonElement | null>;
  /** True only right after the explicit "新建稿件" action. */
  focusTitle?: boolean;
  onTitleFocused?: () => void;
  /** An unfinished publishing preparation exists for this draft. */
  preparing?: boolean;
}

/**
 * Grows a textarea with its content so the editor column, not the field, owns scrolling.
 * Width changes (window resize, collapsing the list, layout switches) re-wrap the text, so the
 * height is recomputed on resize as well as on edits.
 */
function useAutosize(
  element: React.RefObject<HTMLTextAreaElement | null>,
  value: string,
  mounted = true,
) {
  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;
    fitHeight(node);
  }, [element, value, mounted]);
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    let width = node.clientWidth;
    const observer = new ResizeObserver(() => {
      if (node.clientWidth === width) return;
      width = node.clientWidth;
      fitHeight(node);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [element, mounted]);
}

export function fitHeight(node: HTMLTextAreaElement) {
  // Keep the scroll position of the surrounding editor column while the field is briefly collapsed.
  const scroller = node.closest(".editor-scroll");
  const top = scroller?.scrollTop;
  node.style.height = "auto";
  node.style.height = `${node.scrollHeight}px`;
  if (scroller && top !== undefined) scroller.scrollTop = top;
}

export function DraftEditor({
  draft,
  onSaved,
  onPublish,
  onArchive,
  registerFlush,
  notify,
  onRestored,
  compact,
  listCollapsed,
  onToggleList,
  onBack,
  publishButton,
  focusTitle,
  onTitleFocused,
  preparing,
}: Props) {
  const editor = useDraftEditor(draft, onSaved, registerFlush);
  const [preview, setPreview] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const titleField = useRef<HTMLTextAreaElement>(null);
  const historyButton = useRef<HTMLButtonElement>(null);
  const historyHeading = useRef<HTMLHeadingElement>(null);
  const moreMenu = useRef<HTMLDetailsElement>(null);
  const imagePending = useRef<Promise<void> | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  useAutosize(titleField, editor.fields.title);
  useAutosize(textarea, editor.fields.body, !preview);
  useEffect(() => {
    // Navigation and Quit must wait for the selected image to become part of the saved draft.
    registerFlush(async () => {
      await imagePending.current;
      await editor.flush();
    });
  }, [registerFlush, editor.flush]);
  useEffect(() => {
    // Only an explicit new-draft action moves focus; reopening, restoring or re-rendering never does.
    if (!focusTitle) return;
    const field = titleField.current;
    if (field) {
      field.focus();
      // New drafts are stored as "未命名稿件"; selecting it lets the first keystroke replace it.
      field.select();
    }
    onTitleFocused?.();
  }, [focusTitle]); // eslint-disable-line react-hooks/exhaustive-deps
  const [exporting, setExporting] = useState(false);
  /** Exports exactly what is in the editor now, even if the last save failed. */
  const exportCurrent = async () => {
    if (exporting) return;
    setExporting(true);
    const fields = editor.latest();
    try {
      if (api.exportCurrent) {
        const receipt = await api.exportCurrent(fields);
        if (receipt) notify(exportOutcome(receipt, !!editor.error));
      } else {
        // Fallback for builds without the snapshot command: save first so the exported copy is current.
        await editor.flush();
        if (await api.exportDraft(draft.id)) notify("已导出 Markdown");
      }
    } catch (error) {
      notify(`未能导出：${errorMessage(error)} 编辑区内容仍保留。`);
    } finally {
      setExporting(false);
    }
  };
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
  const [selectedRevision, setSelectedRevision] = useState<Revision | null>(null);
  useEffect(() => {
    if (history) historyHeading.current?.focus();
  }, [history]);
  const closeHistory = () => {
    setHistory(null);
    setSelectedRevision(null);
    historyButton.current?.focus();
  };
  const run = async (action: () => Promise<unknown>) => {
    try {
      await editor.flush();
      await action();
    } catch (error) {
      notify(errorMessage(error));
    }
  };
  const closeMenu = () => {
    if (moreMenu.current) moreMenu.current.open = false;
  };
  const saving = editor.status === "保存中…";
  const bodyEmpty = !editor.fields.body.trim();
  return (
    <section
      className="detail-pane draft-editor"
      aria-label="稿件编辑"
      onKeyDown={(event) => {
        if (shortcutFor(event.nativeEvent, navigator.platform) === "togglePreview") {
          event.preventDefault();
          setPreview((value) => !value);
        } else if (event.key === "Escape" && history) {
          event.stopPropagation();
          closeHistory();
        }
      }}
    >
      <header className="pane-header editor-toolbar" data-tauri-drag-region>
        {compact ? (
          <button type="button" className="button quiet small" onClick={onBack}>
            <ChevronLeft size={15} aria-hidden="true" />
            稿件
          </button>
        ) : (
          <button
            type="button"
            className="icon-button"
            aria-label={listCollapsed ? "显示稿件列表" : "收起稿件列表，专注写作"}
            title={listCollapsed ? "显示稿件列表" : "收起稿件列表，专注写作"}
            onClick={onToggleList}
          >
            {listCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        )}
        <div className="segmented" role="group" aria-label={`编辑或预览（${shortcutLabel(navigator.platform, "E")} 切换）`}>
          <button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>
            <PencilLine size={13} aria-hidden="true" />
            编辑
          </button>
          <button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>
            <Eye size={13} aria-hidden="true" />
            预览
          </button>
        </div>
        <span className={"save-status" + (editor.error ? " error" : "")} role="status">
          {editor.error ? (
            <TriangleAlert size={12} aria-hidden="true" />
          ) : saving ? (
            <LoaderCircle size={12} className="spin" aria-hidden="true" />
          ) : (
            <Check size={12} aria-hidden="true" />
          )}
          {editor.error ? "未保存" : editor.status}
        </span>
        <span className="spacer" />
        {api.insertImage && (
          <button
            type="button"
            className="button quiet small"
            onClick={insertImage}
            disabled={imageBusy}
            aria-busy={imageBusy}
            aria-label={imageBusy ? "正在保存图片" : "插入图片"}
            title="插入图片"
          >
            <ImagePlus size={14} aria-hidden="true" />
            <span className="toolbar-label">{imageBusy ? "正在保存图片…" : "插入图片"}</span>
          </button>
        )}
        <button
          type="button"
          ref={historyButton}
          className="button quiet small"
          aria-label="历史版本"
          title="历史版本"
          onClick={() =>
            void run(async () => {
              const items = await api.revisions(draft.id);
              setHistory(items);
              setSelectedRevision(items[0] ?? null);
            })
          }
        >
          <History size={14} aria-hidden="true" />
          <span className="toolbar-label">历史版本</span>
        </button>
        <details
          className="more-menu"
          ref={moreMenu}
          onKeyDown={(event) => {
            if (event.key === "Escape" && moreMenu.current?.open) {
              event.stopPropagation();
              closeMenu();
              moreMenu.current.querySelector("summary")?.focus();
            }
          }}
        >
          <summary className="icon-button" aria-label="更多操作" title="更多操作">
            <Ellipsis size={17} />
          </summary>
          <div className="menu-items" role="menu">
            <button
              type="button"
              role="menuitem"
              disabled={exporting}
              onClick={() => {
                closeMenu();
                void exportCurrent();
              }}
            >
              <Download size={15} aria-hidden="true" />
              {api.insertImage ? "导出（含图片）" : "导出 Markdown"}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                closeMenu();
                void run(() => onArchive(draft.id));
              }}
            >
              <Archive size={15} aria-hidden="true" />
              归档稿件
            </button>
          </div>
        </details>
        <button
          type="button"
          ref={publishButton}
          className="button primary"
          disabled={bodyEmpty}
          aria-describedby={bodyEmpty ? "publish-blocked-reason" : undefined}
          onClick={() => void run(async () => onPublish(editor.current()))}
        >
          <Send size={14} aria-hidden="true" />
          {preparing ? "继续准备发布" : "准备发布"}
        </button>
      </header>
      {editor.error && (
        <div className="notice danger banner" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <div className="notice-body">
            <p>
              <strong>未能保存到本机：</strong>
              {editor.error} 你的输入仍在编辑区，没有丢失；切换页面或关闭前会再次尝试保存。
            </p>
            <div className="notice-actions">
              <button
                type="button"
                className="button"
                disabled={saving}
                onClick={() => void editor.flush().catch(() => undefined)}
              >
                重试保存
              </button>
              <button
                type="button"
                className="button quiet"
                disabled={exporting}
                aria-busy={exporting}
                onClick={() => void exportCurrent()}
              >
                <Download size={14} aria-hidden="true" />
                {exporting ? "正在另存…" : "另存当前内容"}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="editor-scroll">
        <div className="editor-column">
          <textarea
            ref={titleField}
            className="title-input"
            aria-label="文章标题"
            placeholder="给这篇文章起个名字"
            rows={1}
            value={editor.fields.title}
            onChange={(e) => editor.update({ title: e.target.value.replace(/\n/g, " ") })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (!preview) textarea.current?.focus();
              }
            }}
          />
          <div className="draft-meta">
            <input
              className="project-input"
              aria-label="所属项目（可选）"
              placeholder="+ 添加项目（可选）"
              value={editor.fields.project}
              onChange={(e) => editor.update({ project: e.target.value })}
              maxLength={80}
            />
            <span>{editor.fields.body.length.toLocaleString()} 字符</span>
            {/* Kept out of the toolbar so the primary action never wraps onto its own row at the default width. */}
            {bodyEmpty && (
              <span className="publish-blocked" id="publish-blocked-reason">
                正文为空，写点内容后即可准备发布
              </span>
            )}
            <span>更新于 {updatedLabel(editor.current().updatedAt)}</span>
          </div>
          <div className="editor-paper">
            {preview ? (
              <div className="editor-content preview">
                <Markdown text={editor.fields.body} />
              </div>
            ) : (
              <textarea
                ref={textarea}
                className="body-editor"
                aria-label="文章正文"
                placeholder="从这里开始写，或者粘贴在 Codex、Claude 中完成的 Markdown…"
                value={editor.fields.body}
                onChange={(e) => editor.update({ body: e.target.value })}
                spellCheck={false}
              />
            )}
          </div>
        </div>
      </div>
      {history && (
        <section className="history-panel" role="dialog" aria-labelledby="history-title">
          <header>
            <h3 id="history-title" tabIndex={-1} ref={historyHeading}>
              历史版本
            </h3>
            <button type="button" className="icon-button" aria-label="关闭历史版本" onClick={closeHistory}>
              <X size={18} />
            </button>
          </header>
          <div className="history-body">
            <div className="history-list" role="group" aria-label="版本列表">
              {history.map((item) => (
                <button
                  type="button"
                  key={item.revision}
                  aria-pressed={selectedRevision?.revision === item.revision}
                  className={selectedRevision?.revision === item.revision ? "active" : ""}
                  onClick={() => setSelectedRevision(item)}
                >
                  <span>
                    版本 {item.revision}
                    {item.revision === editor.current().revision ? " · 当前" : ""}
                  </span>
                  <small>{new Date(item.savedAt).toLocaleString("zh-CN")}</small>
                </button>
              ))}
            </div>
            <div className="history-preview">
              {selectedRevision ? (
                <Markdown text={selectedRevision.body} />
              ) : (
                <p className="history-empty">还没有保存过的版本。</p>
              )}
            </div>
          </div>
          <footer>
            <p>恢复会生成一个新版本，当前内容仍保留在历史中。</p>
            <button type="button" className="button" onClick={closeHistory}>
              关闭
            </button>
            <button
              type="button"
              className="button primary"
              disabled={!selectedRevision || selectedRevision.revision === editor.current().revision}
              onClick={() =>
                selectedRevision &&
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
          </footer>
        </section>
      )}
    </section>
  );
}
