"use client";

// The only parts of the catalog page that need JavaScript: the sort dropdown (changing a
// <select> can't follow a link by itself) and the filter drawer on phones.
import { SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { inputStyles } from "@/components/form-field";
import { Drawer } from "@/components/ui/drawer";
import { SORTS } from "@/lib/sorts";

export function SortSelect({ params, current }: { params: string; current: string }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm whitespace-nowrap">
      <span className="hidden text-muted sm:inline">Sort by</span>
      <select
        value={current}
        onChange={(e) => {
          const next = new URLSearchParams(params);
          if (e.target.value) next.set("sort", e.target.value); else next.delete("sort");
          next.delete("cursor");                 // a new order starts again from the first page
          router.push(`/products?${next}`);
        }}
        className={`${inputStyles} w-auto pr-8`}
      >
        {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
    </label>
  );
}

// On phones the filters live in a drawer. The filter panel itself is server-rendered and
// passed in as children: a Client Component can WRAP server-made content without owning it.
export function FilterDrawer({ activeCount, children }: { activeCount: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-10 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-sm font-medium hover:bg-subtle lg:hidden"
      >
        <SlidersHorizontal className="size-4" aria-hidden /> Filters
        {activeCount > 0 && <span className="rounded-full bg-brand px-1.5 text-xs text-brand-fg">{activeCount}</span>}
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Filters">
        {/* Any link or form inside closes the drawer as it navigates */}
        <div className="p-4" onClick={(e) => { if ((e.target as HTMLElement).closest("a")) setOpen(false); }} onSubmit={() => setOpen(false)}>
          {children}
        </div>
      </Drawer>
    </>
  );
}
