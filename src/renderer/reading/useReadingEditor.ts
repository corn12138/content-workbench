import { useCallback, useEffect, useRef, useState } from "react";
import type { Reading } from "../../shared/contracts";
import { api } from "../api";

export type ReadingSaveState = "saved" | "pending" | "saving" | "error";

interface EditorOptions {
  items: Reading[];
  onRefresh: () => Promise<void>;
  notify: (message: string) => void;
  registerFlush: (flush: () => Promise<void>) => void;
}

export function useReadingEditor(options: EditorOptions) {
  const [record, setRecord] = useState<Reading | null>(null);
  const [saveState, setSaveState] = useState<ReadingSaveState>("saved");
  const [saveError, setSaveError] = useState("");
  const handlers = useRef(options);
  handlers.current = options;
  const mounted = useRef(false);
  const current = useRef<Reading | null>(null);
  const dirty = useRef(false);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const flush = useCallback((): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    // Navigation joins the autosave queue, so failed writes keep the editor open.
    const work = queue.current
      .catch(() => {})
      .then(async () => {
        do {
          let savedAny = false;
          while (mounted.current && dirty.current && current.current) {
            const snapshot = { ...current.current };
            const savingGeneration = generation.current;
            setSaveState("saving");
            try {
              const { id, url, title, note, read } = snapshot;
              const saved = await api.saveReading({
                id,
                url,
                title,
                note,
                read,
              });
              savedAny = true;
              if (!mounted.current) return;
              // A stale response must not replace text typed while the write was in flight.
              if (generation.current === savingGeneration) {
                current.current = saved;
                dirty.current = false;
                setRecord(saved);
                setSaveState("saved");
                setSaveError("");
              }
            } catch (error) {
              if (mounted.current) {
                setSaveState("error");
                setSaveError(
                  error instanceof Error
                    ? error.message
                    : "笔记未能保存，请重试。",
                );
              }
              throw error;
            }
          }
          if (savedAny && mounted.current) {
            await handlers.current.onRefresh().catch(() => {
              if (mounted.current)
                handlers.current.notify("笔记已保存，列表暂时未能刷新。");
            });
          }
          // Refresh also yields to typing; navigation must include those final edits.
        } while (mounted.current && dirty.current);
      });
    queue.current = work;
    return work;
  }, []);

  useEffect(() => {
    mounted.current = true;
    handlers.current.registerFlush(flush);
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      // The app flushes before navigation/close. Cleanup must not start a new write
      // after another screen or a restored backup has become the source of truth.
    };
  }, [flush]);

  useEffect(() => {
    if (!current.current && options.items.length) {
      current.current = options.items[0];
      setRecord(options.items[0]);
    }
  }, [options.items]);

  const edit = (next: Reading) => {
    current.current = next;
    dirty.current = true;
    generation.current += 1;
    setRecord(next);
    setSaveState("pending");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flush().catch(() => {});
    }, 500);
  };

  // Call only after flush or after creating a saved item; changing selection cannot discard edits.
  const selectSaved = (next: Reading) => {
    current.current = next;
    setRecord(next);
    setSaveState("saved");
    setSaveError("");
  };

  return { record, saveState, saveError, edit, flush, selectSaved };
}
