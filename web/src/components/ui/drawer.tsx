"use client";

// A panel that slides in from the side (mobile menu, and later the cart).
//
// Built on the browser's own <dialog> element: showModal() gives us, for free, what used to
// need a library: focus moves into the panel and stays there, Esc closes it, the rest of the
// page can't be clicked or read by screen readers, and it sits above everything else.
import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Drawer({ open, onClose, title, side = "left", children }: {
  open: boolean;
  onClose: () => void;
  title: string;
  side?: "left" | "right";
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  // React state says open/closed; the dialog element follows it
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      // A click on the dark backdrop lands on the <dialog> itself (the panel is its child)
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className={cn(
        "m-0 h-dvh max-h-none w-[85vw] max-w-sm bg-surface p-0 text-fg shadow-pop backdrop:bg-black/40 backdrop:backdrop-blur-sm",
        side === "left" ? "mr-auto" : "ml-auto",
      )}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-muted hover:bg-subtle">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </dialog>
  );
}
