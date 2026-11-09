import { useEffect, useRef } from "react";
import { isDeleteShortcut, isEditableTarget } from "../shortcuts";

/**
 * Runs `handler` on ⌘⌫ (macOS) / Delete when the user is not typing and no dialog or menu is open.
 * Pass null when nothing is selected.
 */
export function useDeleteShortcut(handler: (() => void) | null) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!latest.current || !isDeleteShortcut(event, navigator.platform)) return;
      if (isEditableTarget(event.target) || document.querySelector("dialog[open], .context-menu")) return;
      if (event.target instanceof Element && event.target.closest("[inert]")) return;
      event.preventDefault();
      latest.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
