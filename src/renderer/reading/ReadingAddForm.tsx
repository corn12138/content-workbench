import type { FormEvent } from "react";

interface ReadingAddFormProps {
  url: string;
  title: string;
  busy: boolean;
  error: string;
  setUrl: (url: string) => void;
  setTitle: (title: string) => void;
  add: (event: FormEvent) => Promise<void>;
  cancel: () => void;
}

export function ReadingAddForm({
  url,
  title,
  busy,
  error,
  setUrl,
  setTitle,
  add,
  cancel,
}: ReadingAddFormProps) {
  return (
    <form
      className="inline-panel reading-add"
      onSubmit={add}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) {
          event.stopPropagation();
          cancel();
        }
      }}
    >
      <div className="field">
        <label className="field-label" htmlFor="reading-url">
          文章链接
        </label>
        <input
          className="input"
          id="reading-url"
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://…"
          required
          disabled={busy}
          autoFocus
          aria-invalid={!!error}
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="reading-title">
          标题 <span className="field-help">选填，方便以后找到它</span>
        </label>
        <input
          className="input"
          id="reading-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={200}
          disabled={busy}
        />
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="inline-actions">
        <button className="button primary small" type="submit" disabled={busy} aria-busy={busy}>
          {busy ? "正在保存…" : "保存链接"}
        </button>
        <button className="button quiet small" type="button" onClick={cancel} disabled={busy}>
          取消
        </button>
      </div>
    </form>
  );
}
