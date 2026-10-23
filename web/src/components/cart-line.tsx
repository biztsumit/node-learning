"use client";

import { ImageOff, Minus, Plus, Trash2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { rupees } from "@/lib/format";
import type { CartItem } from "@/lib/types";

// One item in the cart: photo, name, options, − qty +, remove. Used by the cart page and the
// slide-out cart, which pass in what a change should do (they keep their own copy of the cart).
export function CartLine({ item, busy, compact = false, onQuantity, onRemove, onNavigate }: {
  item: CartItem;
  busy: boolean;
  compact?: boolean;              // the narrow drawer: smaller photo, total under the name
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
  onNavigate?: () => void;        // e.g. close the drawer when the product link is followed
}) {
  return (
    <li className={cn("flex gap-4", compact ? "py-4" : "p-4 sm:p-5", busy && "opacity-60")}>
      <Link href={`/products/${item.slug}`} onClick={onNavigate} className={cn("relative shrink-0 overflow-hidden rounded-xl bg-subtle", compact ? "size-20" : "size-24 sm:size-28")}>
        {item.imageUrl
          ? <Image src={item.imageUrl} alt={item.name} fill sizes="112px" className="object-cover" />
          : <span className="flex h-full items-center justify-center text-faint"><ImageOff className="size-6" aria-hidden /></span>}
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href={`/products/${item.slug}`} onClick={onNavigate} className="line-clamp-2 font-medium hover:underline">{item.name}</Link>
            {item.optionsLabel && <p className="text-sm text-muted">{item.optionsLabel}</p>}
            {!compact && <p className="text-sm text-muted">{rupees(item.price)} each</p>}
          </div>
          {!compact && <p className="font-semibold whitespace-nowrap">{rupees(item.lineTotal)}</p>}
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 pt-2">
          <div className="flex h-9 items-center rounded-lg border border-line-strong" role="group" aria-label={`Quantity of ${item.name}`}>
            <button type="button" aria-label="One fewer" disabled={busy || item.quantity <= 1} onClick={() => onQuantity(item.quantity - 1)} className="flex size-9 items-center justify-center text-muted hover:text-fg disabled:opacity-40">
              <Minus className="size-3.5" aria-hidden />
            </button>
            <span className="w-7 text-center text-sm font-medium tabular-nums">{item.quantity}</span>
            <button type="button" aria-label="One more" disabled={busy || item.quantity >= item.stock} onClick={() => onQuantity(item.quantity + 1)} className="flex size-9 items-center justify-center text-muted hover:text-fg disabled:opacity-40">
              <Plus className="size-3.5" aria-hidden />
            </button>
          </div>
          {compact && <p className="font-semibold">{rupees(item.lineTotal)}</p>}
          <button type="button" onClick={onRemove} disabled={busy} aria-label={`Remove ${item.name}`} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-40">
            <Trash2 className="size-4" aria-hidden /> <span className={compact ? "sr-only" : ""}>Remove</span>
          </button>
        </div>
        {item.quantity >= item.stock && <p className="text-xs text-warning">Only {item.stock} in stock</p>}
      </div>
    </li>
  );
}
