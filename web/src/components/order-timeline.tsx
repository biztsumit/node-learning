import { Check, CreditCard, PackageCheck, Receipt, Truck, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import type { OrderStatus } from "@/lib/types";

const STEPS: Array<{ status: OrderStatus; label: string; icon: LucideIcon }> = [
  { status: "pending", label: "Placed", icon: Receipt },
  { status: "paid", label: "Paid", icon: CreditCard },
  { status: "shipped", label: "Shipped", icon: Truck },
  { status: "delivered", label: "Delivered", icon: PackageCheck },
];

// Where the order is on its way: done steps filled, the current one highlighted, the rest
// waiting. A cancelled order shows where it stopped. (The order list in the API is
// pending → paid → shipped → delivered, with cancelled possible from pending or paid.)
export function OrderTimeline({ status, wasPaid }: { status: OrderStatus; wasPaid: boolean }) {
  const steps = status === "cancelled"
    // Cancelled after paying: Placed ✓, Paid ✓, Cancelled ✗. Before paying: Placed ✓, Cancelled ✗.
    ? [...STEPS.slice(0, wasPaid ? 2 : 1), { status: "cancelled" as const, label: "Cancelled", icon: X }]
    : STEPS;
  const current = status === "cancelled" ? steps.length - 1 : STEPS.findIndex((s) => s.status === status);

  return (
    <ol className="flex items-start" aria-label="Order progress">
      {steps.map((step, i) => {
        const done = i < current || (i === current && status === "delivered");
        const active = i === current;
        const cancelled = step.status === "cancelled";
        const Icon = done && !cancelled ? Check : step.icon;
        return (
          <li key={step.label} className="flex flex-1 flex-col items-center gap-2 text-center" aria-current={active ? "step" : undefined}>
            <div className="flex w-full items-center">
              {/* The line to the left of each step (none before the first) */}
              <span className={cn("h-0.5 flex-1", i === 0 ? "invisible" : i <= current ? (cancelled ? "bg-danger/40" : "bg-brand") : "bg-line")} aria-hidden />
              <span className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-full",
                cancelled ? "bg-danger-soft text-danger"
                  : done ? "bg-brand text-brand-fg"
                  : active ? "bg-brand-soft text-brand-text ring-4 ring-brand/15"
                  : "border border-line-strong bg-surface text-faint",
              )}>
                <Icon className="size-5" aria-hidden />
              </span>
              <span className={cn("h-0.5 flex-1", i === steps.length - 1 ? "invisible" : i < current ? "bg-brand" : "bg-line")} aria-hidden />
            </div>
            <span className={cn("text-xs sm:text-sm", active || done ? "font-medium" : "text-muted")}>
              {step.label}
              <span className="sr-only">{done ? " (done)" : active ? " (current)" : " (not yet)"}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
