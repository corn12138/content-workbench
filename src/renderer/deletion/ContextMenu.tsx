import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  run: () => void;
}

interface Open {
  x: number;
  y: number;
  items: MenuItem[];
  /** Element to return focus to when the menu closes without running an item. */
  origin: HTMLElement | null;
}

/** Right-click menu for list rows. Returns a handler to attach to `onContextMenu` and the menu node. */
export function useContextMenu() {
  const [open, setOpen] = useState<Open | null>(null);
  const show = useCallback((event: MouseEvent<HTMLElement>, items: MenuItem[]) => {
    event.preventDefault();
    setOpen({ x: event.clientX, y: event.clientY, items, origin: event.currentTarget });
  }, []);
  const menu = open ? <Menu {...open} close={() => setOpen(null)} /> : null;
  return { show, menu };
}

function Menu({ x, y, items, origin, close }: Open & { close: () => void }) {
  const node = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const box = node.current?.getBoundingClientRect();
    if (!box) return;
    // Keep the menu inside the window near the edges.
    setPosition({
      left: Math.max(4, Math.min(x, window.innerWidth - box.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - box.height - 4)),
    });
    node.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [x, y]);
  useEffect(() => {
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && node.current?.contains(event.target)) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        origin?.focus();
      }
    };
    window.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [close, origin]);
  return (
    <div
      ref={node}
      className="menu-items context-menu"
      role="menu"
      style={{ position: "fixed", left: position.left, top: position.top, right: "auto" }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const buttons = [...(node.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "ArrowDown" ? index + 1 : index - 1;
        buttons[(next + buttons.length) % buttons.length]?.focus();
      }}
    >
      {items.map((item) => (
        <button
          type="button"
          role="menuitem"
          key={item.label}
          className={item.danger ? "danger" : undefined}
          disabled={item.disabled}
          onClick={() => {
            close();
            item.run();
          }}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}
