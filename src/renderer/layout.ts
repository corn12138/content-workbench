import { createContext, useContext, useEffect, useState, type RefObject } from "react";

export type Layout = "wide" | "standard" | "compact";

export function layoutFor(width: number): Layout {
  return width >= 1280 ? "wide" : width >= 960 ? "standard" : "compact";
}

/** Tracks the real shell width; fixed-size prototype frames are not a substitute for continuous resizing. */
export function useShellLayout(shell: RefObject<HTMLElement | null>): Layout {
  const [layout, setLayout] = useState<Layout>(() =>
    layoutFor(typeof window === "undefined" ? 1180 : window.innerWidth),
  );
  useEffect(() => {
    const element = shell.current;
    if (!element) return;
    const update = () => setLayout(layoutFor(element.clientWidth || window.innerWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [shell]);
  return layout;
}

export const LayoutContext = createContext<Layout>("standard");
export const useLayout = () => useContext(LayoutContext);
