"use client";

import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type ToastTone = "success" | "info" | "error";
type ToastItem = { id: number; tone: ToastTone; message: string };

const ToastContext = createContext<((message: string, tone?: ToastTone) => void) | null>(null);

const ICONS = { success: CheckCircle2, info: Info, error: TriangleAlert };
const TONES = {
  success: "border-success/30 text-success-ink",
  info: "border-line-strong text-ink",
  error: "border-error/30 text-error-ink",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);

  const show = useCallback(
    (message: string, tone: ToastTone = "info") => {
      const id = nextId.current++;
      setItems((all) => [...all.slice(-2), { id, tone, message }]);
      window.setTimeout(() => dismiss(id), 4500);
    },
    [dismiss],
  );

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-24 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-6 sm:start-6 sm:items-start"
      >
        {items.map((item) => {
          const Icon = ICONS[item.tone];
          return (
            <div
              key={item.id}
              role={item.tone === "error" ? "alert" : "status"}
              className={cn(
                "pointer-events-auto flex w-full max-w-sm animate-fade-up items-start gap-3 rounded-lg border bg-surface px-4 py-3 text-small shadow-lift",
                TONES[item.tone],
              )}
            >
              <Icon className="mt-1 size-4 shrink-0" aria-hidden />
              <p className="flex-1 text-text">{item.message}</p>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                className="rounded p-1 text-muted hover:text-ink"
                aria-label="إغلاق التنبيه"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
