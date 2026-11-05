import { useEffect, useRef, type ReactNode } from "react";
import { Trash2 } from "lucide-react";

interface Props {
  title: string;
  /** What is removed, then what is kept. Plain sentences, one per line. */
  lines: string[];
  confirmLabel: string;
  busy?: boolean;
  /** Optional choices (e.g. keep saved articles) rendered above the actions. */
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The one confirmation used by every delete. Cancel has focus, so Return never deletes by accident;
 * Escape cancels without leaking to the page behind.
 */
export function ConfirmDelete({ title, lines, confirmLabel, busy, children, onConfirm, onCancel }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="dialog confirm-delete"
      aria-labelledby="confirm-delete-title"
      aria-describedby="confirm-delete-description"
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id="confirm-delete-title">{title}</h2>
      <div id="confirm-delete-description">
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      {children}
      <div className="dialog-actions">
        <button type="button" className="button" autoFocus disabled={busy} onClick={onCancel}>
          取消
        </button>
        <button type="button" className="button danger" disabled={busy} aria-busy={busy} onClick={onConfirm}>
          <Trash2 size={14} aria-hidden="true" />
          {busy ? "正在删除…" : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
