"use client";

// Small "Added to cart ✓" messages that appear for a few seconds, from anywhere:
//   const toast = useToast();
//   toast.show("Added to cart");                 or  toast.show("Couldn't save", "error")
import { CircleAlert, CircleCheck, X } from "lucide-react";
import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from "react";

type Tone = "success" | "error";
type Toast = { id: number; text: string; tone: Tone };

const ToastContext = createContext<{ show: (text: string, tone?: Tone) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  const show = useCallback((text: string, tone: Tone = "success") => {
    const id = nextId.current++;
    // At most 3 on screen: the newest replace the oldest
    setToasts((all) => [...all.slice(-2), { id, text, tone }]);
    setTimeout(() => dismiss(id), 3500);
  }, [dismiss]);

  // useMemo: the same object every render, so components using the toast don't re-render
  // just because a toast appeared
  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext value={value}>
      {children}
      {/* aria-live: screen readers announce new messages without moving the user's focus */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:items-end">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className="pointer-events-auto flex w-full max-w-sm animate-toast-in items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm shadow-pop"
          >
            {toast.tone === "success"
              ? <CircleCheck className="size-5 shrink-0 text-success" aria-hidden />
              : <CircleAlert className="size-5 shrink-0 text-danger" aria-hidden />}
            <span className="flex-1">{toast.text}</span>
            <button type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss" className="rounded p-1 text-muted hover:bg-subtle">
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext>
  );
}

export function useToast() {
  const value = use(ToastContext);
  if (!value) throw new Error("useToast must be used inside <ToastProvider>");
  return value;
}
