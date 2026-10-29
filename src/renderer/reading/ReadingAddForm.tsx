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
    <form className="reading-add" onSubmit={add}>
      <div className="field">
        <label htmlFor="reading-url">文章链接</label>
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
        />
      </div>
      <div className="field">
        <label htmlFor="reading-title">
          标题 <span className="muted">选填</span>
        </label>
        <input
          className="input"
          id="reading-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="方便以后找到它"
          maxLength={200}
          disabled={busy}
        />
      </div>
      <div className="reading-add-actions">
        <button className="button primary" type="submit" disabled={busy}>
          {busy ? "正在保存…" : "保存链接"}
        </button>
        <button
          className="button quiet"
          type="button"
          onClick={cancel}
          disabled={busy}
        >
          取消
        </button>
      </div>
      {error && (
        <p className="reading-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
