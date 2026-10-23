import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

// A white (or dark) panel with a hairline border and a soft shadow
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-line bg-surface shadow-card", className)} {...props} />;
}

// A grey placeholder shaped like the content that's loading, so nothing jumps when it arrives
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-lg bg-subtle", className)} />;
}
