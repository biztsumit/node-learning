// Every status an order can have (must match the CHECK on orders.status).
// "as const" keeps the exact words, so OrderStatus below is "pending" | "paid" | ... rather
// than any string: a typo like "canceled" becomes a type error.
export const ORDER_STATUSES = ["pending", "paid", "shipped", "delivered", "cancelled"] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

// Which status an order may move to next. Anything not listed is not allowed.
//
//   pending ──▶ paid ──▶ shipped ──▶ delivered
//      │          │
//      └──────────┴──▶ cancelled
//
// Record<OrderStatus, ...>: TypeScript insists that EVERY status has an entry, so adding a
// new status without deciding its transitions is a type error, not a crash later.
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["paid", "cancelled"],
  paid: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: []
};

export const canChangeStatus = (from: OrderStatus, to: OrderStatus): boolean =>
  ORDER_TRANSITIONS[from].includes(to);
