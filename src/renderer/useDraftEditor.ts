import { useCallback, useEffect, useRef, useState } from "react";
import type { Draft } from "../shared/contracts";
import { api, errorMessage } from "./api";

type Fields = Pick<Draft, "title" | "body" | "project">;
const fieldsOf = ({ title, body, project }: Draft): Fields => ({
  title,
  body,
  project,
});

export function useDraftEditor(
  draft: Draft,
  onSaved: (draft: Draft) => void,
  registerFlush: (flush: () => Promise<void>) => void,
) {
  const [fields, setFields] = useState<Fields>(() => fieldsOf(draft));
  const [status, setStatus] = useState("已保存到本机");
  const [error, setError] = useState("");
  const latest = useRef(fields);
  const saved = useRef(draft);
  const pending = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedCallback = useRef(onSaved);
  savedCallback.current = onSaved;
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    if (pending.current) return pending.current;
    const persist = async () => {
      // Serialize saves and read the latest values again after each write, so slow I/O cannot overwrite newer typing.
      while (
        JSON.stringify(latest.current) !==
        JSON.stringify(fieldsOf(saved.current))
      ) {
        setStatus("保存中…");
        setError("");
        const next = await api.saveDraft({
          ...latest.current,
          id: saved.current.id,
          expectedRevision: saved.current.revision,
        });
        saved.current = next;
        savedCallback.current(next);
      }
      setStatus("已保存到本机");
    };
    pending.current = persist()
      .catch((error) => {
        setStatus("保存失败");
        setError(errorMessage(error));
        throw error;
      })
      .finally(() => {
        pending.current = null;
      });
    return pending.current;
  }, []);
  useEffect(() => {
    registerFlush(flush);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [flush, registerFlush]);
  const update = (patch: Partial<Fields>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setFields(next);
    setStatus("保存中…");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush().catch(() => undefined), 600);
  };
  return { fields, update, status, error, flush, current: () => saved.current, latest: () => latest.current };
}
