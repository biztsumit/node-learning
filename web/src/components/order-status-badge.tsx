import { CircleCheck, CircleX, Clock, CreditCard, Truck, type LucideIcon } from "lucide-react";
import type { OrderStatus } from "@/lib/types";
import { Badge, type BadgeTone } from "./ui/badge";

// Each status has a colour AND an icon AND a word, so it never depends on colour alone
const STATUS: Record<OrderStatus, { label: string; tone: BadgeTone; icon: LucideIcon }> = {
  pending: { label: "Awaiting payment", tone: "warning", icon: Clock },
  paid: { label: "Paid", tone: "brand", icon: CreditCard },
  shipped: { label: "Shipped", tone: "info", icon: Truck },
  delivered: { label: "Delivered", tone: "success", icon: CircleCheck },
  cancelled: { label: "Cancelled", tone: "neutral", icon: CircleX },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const { label, tone, icon: Icon } = STATUS[status];
  return (
    <Badge tone={tone}>
      <Icon className="size-3.5" aria-hidden />
      {label}
    </Badge>
  );
}
