import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

// What a page shows when there's nothing to show: an icon, a friendly line, and the next step.
// Never just "No items." with nowhere to go.
export function EmptyState({ icon: Icon, title, text, children }: { icon: LucideIcon; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line-strong px-6 py-14 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-brand-soft text-brand-text">
        <Icon className="size-7" aria-hidden />
      </span>
      <h2 className="text-lg font-semibold">{title}</h2>
      {text && <p className="max-w-sm text-muted">{text}</p>}
      {children && <div className="mt-2 flex flex-wrap justify-center gap-3">{children}</div>}
    </div>
  );
}
