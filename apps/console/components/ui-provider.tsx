"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type UiState = {
  engineer: boolean;
  setEngineer: (on: boolean) => void;
  toast: (message: string) => void;
};

const UiContext = createContext<UiState | null>(null);

/** App-wide UI state: the Engineer view switch (remembered per browser) and toasts. */
export function UiProvider({ children }: { children: ReactNode }) {
  const [engineer, setEngineerState] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      setEngineerState(localStorage.getItem("cr-engineer") === "1");
    } catch {}
  }, []);

  const setEngineer = useCallback((on: boolean) => {
    setEngineerState(on);
    try {
      localStorage.setItem("cr-engineer", on ? "1" : "0");
    } catch {}
  }, []);

  const toast = useCallback((m: string) => {
    setMessage(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 3600);
  }, []);

  return (
    <UiContext.Provider value={{ engineer, setEngineer, toast }}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-none fixed bottom-6 left-1/2 z-50 max-w-[calc(100%-32px)] -translate-x-1/2 rounded-xl bg-ink px-4 py-2.5 text-[13px] font-medium text-bg shadow-2xl transition-all duration-200 ${
          message ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
        }`}
      >
        {message}
      </div>
    </UiContext.Provider>
  );
}

export function useUi() {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error("useUi must be used inside <UiProvider>");
  return ctx;
}

/** Renders children only when Engineer view is on. */
export function EngineerOnly({ children }: { children: ReactNode }) {
  const { engineer } = useUi();
  return engineer ? <>{children}</> : null;
}

/** A button whose only job (in v0) is to explain what the real action will do. */
export function ToastButton({ message, className, children }: { message: string; className?: string; children: ReactNode }) {
  const { toast } = useUi();
  return (
    <button type="button" className={className} onClick={() => toast(message)}>
      {children}
    </button>
  );
}
