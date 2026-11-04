import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { initialUpdateState, updateReducer } from "./updateState";
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
  const [state, dispatch] = useReducer(updateReducer, initialUpdateState);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(
    () => api.onUpdateProgress?.((progress) => dispatch({ type: "installProgress", progress })),
    [],
  );
  const check = useCallback(async (quiet = false) => {
    if (!api.checkUpdate || pending.current) return;
    pending.current = true;
    dispatch({ type: "checkStart", quiet });
    write(checkedKey, String(Date.now()));
    try {
      const value = await api.checkUpdate();
      if (mounted.current) dispatch({ type: "checkSucceeded", value });
    } catch (error) {
      if (mounted.current) dispatch({ type: "checkFailed", message: errorMessage(error), quiet });
    } finally {
      pending.current = false;
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
    if (!state.available || !api.installUpdate || pending.current) return;
    pending.current = true;
    dispatch({ type: "installStart" });
    try {
      await api.installUpdate(state.available.version);
      if (mounted.current) dispatch({ type: "installSettled" });
    } catch (error) {
      if (mounted.current) dispatch({ type: "installFailed", message: errorMessage(error) });
    } finally {
      pending.current = false;
    }
  };
  return {
    automatic,
    state,
    available: state.available,
    checking: state.checking,
    installing: state.install.running,
    progress: state.install.progress,
    check,
    install,
    setAutomatic(value: boolean) {
      write(preferenceKey, value ? "on" : "off");
      setAutomatic(value);
    },
  };
}

export type Updates = ReturnType<typeof useUpdates>;
