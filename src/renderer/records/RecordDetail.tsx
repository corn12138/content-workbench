import { useEffect, useRef, useState } from "react";
import { CircleAlert, ExternalLink, FileText, History, PenLine, RefreshCw, Trash2 } from "lucide-react";
import type { Draft, Feedback, Publication, Revision } from "../../shared/contracts";
import { api, errorMessage } from "../api";
import { Markdown } from "../Markdown";
import { validPublicationURL } from "../publishing/text";
import {
  formatMetric,
  localInputValue,
  metricFields,
  parseMetrics,
  toISO,
  versionStatus,
} from "./feedback";

const timeFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Details of one publication: trace it back to the local draft and published revision, correct or
 * remove a manual record (local only), and keep a history of feedback observations.
 */
export function RecordDetail({
  publication,
  draft,
  feedback,
  onOpenDraft,
  onChanged,
  notify,
}: {
  publication: Publication;
  draft: Draft | undefined;
  feedback: Feedback[];
  onOpenDraft: (draft: Draft) => void;
  onChanged: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const [revision, setRevision] = useState<Revision | null | undefined>(undefined);
  const [revisionError, setRevisionError] = useState("");
  const [editing, setEditing] = useState(false);
  const [url, setURL] = useState(publication.url);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [observed, setObserved] = useState(() => localInputValue(new Date()));
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [syncing, setSyncing] = useState(false);
  // Responses that arrive after the user moved to another record are discarded.
  const current = useRef(publication.id);
  current.current = publication.id;
  const platform = publication.platform;
  const fields = metricFields[platform];

  useEffect(() => {
    setRevision(undefined);
    setRevisionError("");
    setEditing(false);
    setConfirmRemove(false);
    setURL(publication.url);
    setError("");
    setSyncError("");
  }, [publication.id, publication.url]);

  const task = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const showRevision = () =>
    void task(async () => {
      const id = publication.id;
      try {
        const items = await api.revisions(publication.draftId);
        if (current.current !== id) return;
        setRevision(items.find((item) => item.revision === publication.draftRevision) ?? null);
      } catch (cause) {
        if (current.current === id) setRevisionError(errorMessage(cause));
      }
    });

  const saveCorrection = () =>
    void task(async () => {
      if (!validPublicationURL(platform, url)) throw new Error("请粘贴同一平台的完整作品链接。");
      await api.updatePublication!(publication.id, url.trim());
      setEditing(false);
      await onChanged();
      notify("链接已更正。只更新了本地记录，线上作品没有变化。");
    });

  const remove = () =>
    void task(async () => {
      await api.removePublication!(publication.id);
      await onChanged();
      notify("已移除这条本地记录。线上作品不受影响。");
    });

  const saveFeedback = () =>
    void task(async () => {
      setFormError("");
      const parsed = parseMetrics(platform, values);
      if ("error" in parsed) return setFormError(parsed.error);
      const observedAt = toISO(observed);
      if (!observedAt) return setFormError("请填写观察时间。");
      if (Object.values(parsed.metrics).every((v) => v === null) && !note.trim())
        return setFormError("请至少填写一项数据或跟进笔记。");
      await api.saveFeedback!({ publicationId: publication.id, observedAt, metrics: parsed.metrics, note });
      setRecording(false);
      setValues({});
      setNote("");
      setObserved(localInputValue(new Date()));
      await onChanged();
      notify("已保存这次反馈记录。");
    });

  const sync = async () => {
    if (syncing || !api.xMetrics) return;
    const id = publication.id;
    setSyncing(true);
    setSyncError("");
    try {
      await api.xMetrics(id);
      if (current.current === id) await onChanged();
    } catch (cause) {
      // The last valid snapshot stays visible with its own time; only this attempt failed.
      if (current.current === id) setSyncError(errorMessage(cause));
    } finally {
      if (current.current === id) setSyncing(false);
    }
  };

  const manual = publication.confirmation === "manual";
  const lastApi = feedback.find((item) => item.source === "api");
  return (
    <div className="record-detail" role="region" aria-label={`作品详情：${publication.title || "未命名稿件"}`}>
      <section className="record-detail-section">
        <h3>本地稿件</h3>
        <p className="field-help">{versionStatus(publication, draft)}</p>
        <div className="inline-actions">
          {draft && (
            <button type="button" className="button small" disabled={busy} onClick={() => onOpenDraft(draft)}>
              <FileText size={13} aria-hidden="true" />
              打开稿件
            </button>
          )}
          {draft && (
            <button type="button" className="button quiet small" disabled={busy} onClick={showRevision}>
              <History size={13} aria-hidden="true" />
              查看发布时的版本
            </button>
          )}
          <button
            type="button"
            className="button quiet small"
            onClick={() => void api.openExternal(publication.url).catch((e) => notify(errorMessage(e)))}
          >
            <ExternalLink size={13} aria-hidden="true" />
            打开作品
          </button>
        </div>
        {revisionError && <p className="field-error">{revisionError}</p>}
        {revision === null && <p className="field-help">找不到发布时的版本。</p>}
        {revision && (
          <details className="disclosure record-revision" open>
            <summary>
              版本 {revision.revision} · {timeFormat.format(new Date(revision.savedAt))} · 只读，不会覆盖当前稿件
            </summary>
            <div className="disclosure-body">
              <h4 className="record-revision-title">{revision.title}</h4>
              <Markdown text={revision.body} />
            </div>
          </details>
        )}
      </section>

      <section className="record-detail-section">
        <h3>记录来源</h3>
        <p className="field-help">
          {manual
            ? `人工确认：你在平台发布后粘贴的链接${publication.correctedAt ? `，已于 ${timeFormat.format(new Date(publication.correctedAt))} 更正` : ""}。`
            : "平台回执：通过 X 官方 API 发布时由平台返回，链接不能修改。"}
        </p>
        {editing ? (
          <div className="field">
            <label className="field-label" htmlFor={`fix-${publication.id}`}>
              更正后的链接
            </label>
            <input
              id={`fix-${publication.id}`}
              className="input"
              value={url}
              disabled={busy}
              onChange={(e) => setURL(e.target.value)}
            />
            <div className="inline-actions">
              <button type="button" className="button primary small" disabled={busy || !url.trim()} onClick={saveCorrection}>
                保存更正
              </button>
              <button type="button" className="button quiet small" disabled={busy} onClick={() => setEditing(false)}>
                取消
              </button>
            </div>
          </div>
        ) : confirmRemove ? (
          <div className="notice warning" role="alert">
            <CircleAlert size={15} aria-hidden="true" />
            <div className="notice-body">
              <p>
                只删除这条本地记录{feedback.length ? `和 ${feedback.length} 条反馈记录` : ""}，不会删除线上作品，也不会改动稿件。
              </p>
              <div className="notice-actions">
                <button type="button" className="button" disabled={busy} onClick={remove}>
                  确认移除
                </button>
                <button type="button" className="button quiet" disabled={busy} onClick={() => setConfirmRemove(false)}>
                  取消
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="inline-actions">
            {manual && api.updatePublication && (
              <button type="button" className="button quiet small" disabled={busy} onClick={() => setEditing(true)}>
                <PenLine size={13} aria-hidden="true" />
                更正链接
              </button>
            )}
            {api.removePublication && (
              <button type="button" className="button quiet small" disabled={busy} onClick={() => setConfirmRemove(true)}>
                <Trash2 size={13} aria-hidden="true" />
                移除本地记录
              </button>
            )}
          </div>
        )}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="record-detail-section">
        <h3>反馈记录</h3>
        {api.saveFeedback ? (
          <>
            <div className="inline-actions">
              {!recording && (
                <button type="button" className="button small" disabled={busy} onClick={() => setRecording(true)}>
                  记录反馈
                </button>
              )}
              {platform === "x" && api.xMetrics && (
                <button type="button" className="button quiet small" disabled={syncing} aria-busy={syncing} onClick={() => void sync()}>
                  <RefreshCw size={13} className={syncing ? "spin" : undefined} aria-hidden="true" />
                  {syncing ? "正在读取…" : "从 X 读取公开数据"}
                </button>
              )}
            </div>
            {platform === "x" && api.xMetrics && (
              <p className="field-help">
                需要已连接的官方 API 账号，每次读取可能消耗 X API 额度；不读取评论内容。
                {lastApi ? `上次读取：${timeFormat.format(new Date(lastApi.observedAt))}。` : ""}
              </p>
            )}
            {platform === "juejin" && (
              <p className="field-help">掘金没有公开的作者数据接口，请在掘金创作者中心查看后手动记录。</p>
            )}
            {syncError && (
              <p className="field-error" role="alert">
                未能读取：{syncError}
                {lastApi ? " 下方保留上次读取的数据。" : ""}
              </p>
            )}
            {recording && (
              <div className="inline-panel feedback-form">
                <div className="feedback-fields">
                  {fields.map((field) => (
                    <label key={field.key} className="field">
                      <span className="field-label">{field.label}</span>
                      <input
                        className="input num"
                        inputMode="numeric"
                        placeholder="未知"
                        value={values[field.key] ?? ""}
                        disabled={busy}
                        onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                      />
                    </label>
                  ))}
                </div>
                <label className="field">
                  <span className="field-label">观察时间</span>
                  <input
                    className="input"
                    type="datetime-local"
                    value={observed}
                    disabled={busy}
                    onChange={(e) => setObserved(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field-label">跟进笔记（可选）</span>
                  <textarea
                    className="input"
                    rows={2}
                    maxLength={4000}
                    value={note}
                    disabled={busy}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <p className="field-help">留空表示未知；只有你填写的 0 才记为 0。</p>
                {formError && (
                  <p className="field-error" role="alert">
                    {formError}
                  </p>
                )}
                <div className="inline-actions">
                  <button type="button" className="button primary small" disabled={busy} onClick={saveFeedback}>
                    保存反馈
                  </button>
                  <button type="button" className="button quiet small" disabled={busy} onClick={() => setRecording(false)}>
                    取消
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="field-help">反馈记录请使用 Tauri 版。</p>
        )}
        {feedback.length > 0 ? (
          <ol className="feedback-history" aria-label="反馈历史">
            {feedback.map((item) => (
              <li key={item.id}>
                <div className="feedback-head">
                  <span className="num">{timeFormat.format(new Date(item.observedAt))}</span>
                  <span className={item.source === "api" ? "badge accent" : "badge"}>
                    {item.source === "api" ? "X 公开数据" : "手动记录"}
                  </span>
                  {item.source === "manual" && api.deleteFeedback && (
                    <button
                      type="button"
                      className="link-button"
                      disabled={busy}
                      onClick={() =>
                        void task(async () => {
                          await api.deleteFeedback!(item.id);
                          await onChanged();
                        })
                      }
                    >
                      删除
                    </button>
                  )}
                </div>
                <dl className="feedback-metrics">
                  {fields.map((field) => (
                    <div key={field.key}>
                      <dt>{field.label}</dt>
                      <dd className={item.metrics[field.key] == null ? "unknown num" : "num"}>
                        {formatMetric(item.metrics[field.key])}
                      </dd>
                    </div>
                  ))}
                </dl>
                {item.note && <p className="feedback-note">{item.note}</p>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="field-help">还没有反馈记录。</p>
        )}
      </section>
    </div>
  );
}
