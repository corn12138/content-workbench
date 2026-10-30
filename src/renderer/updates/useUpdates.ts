import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../api";

const preferenceKey = "workbench-auto-update-check";
const checkedKey = "workbench-update-checked-at";
const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Updates remain usable when preferences cannot be persisted. */
  }
};

export function useUpdates() {
  const [automatic, setAutomatic] = useState(
    () => read(preferenceKey) !== "off",
  );
  const [available, setAvailable] = useState<{
    version: string;
    notes: string;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState("");
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => api.onUpdateProgress?.(setProgress), []);
  const check = useCallback(async (quiet = false) => {
    if (!api.checkUpdate || pending.current) return;
    pending.current = true;
    setChecking(true);
    if (!quiet) setMessage("");
    write(checkedKey, String(Date.now()));
    try {
      const value = await api.checkUpdate();
      if (!mounted.current) return;
      setAvailable(value);
      setMessage(value ? `发现新版本 ${value.version}` : "当前已是最新版本");
    } catch (error) {
      if (mounted.current && !quiet) setMessage(errorMessage(error));
    } finally {
      pending.current = false;
      if (mounted.current) setChecking(false);
    }
  }, []);
  useEffect(() => {
    if (!automatic || !api.checkUpdate) return;
    const tick = () => {
      const age = Date.now() - Number(read(checkedKey) || 0);
      if (!Number.isFinite(age) || age < 0 || age >= 24 * 60 * 60 * 1000)
        void check(true);
    };
    const first = window.setTimeout(tick, 5000);
    const timer = window.setInterval(tick, 60 * 60 * 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [automatic, check]);
  const install = async () => {
    if (!available || !api.installUpdate || pending.current) return;
    pending.current = true;
    setInstalling(true);
    setProgress("正在准备升级…");
    try {
      await api.installUpdate(available.version);
    } catch (error) {
      if (mounted.current) setMessage(errorMessage(error));
    } finally {
      pending.current = false;
      if (mounted.current) setInstalling(false);
    }
  };
  return {
    automatic,
    available,
    checking,
    installing,
    message,
    progress,
    check,
    install,
    setAutomatic(value: boolean) {
      write(preferenceKey, value ? "on" : "off");
      setAutomatic(value);
    },
  };
}

export type Updates = ReturnType<typeof useUpdates>;
