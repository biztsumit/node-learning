// Every status an order can have (must match the CHECK on orders.status)
export const ORDER_STATUSES = ["pending", "paid", "shipped", "delivered", "cancelled"];

// Which status an order may move to next. Anything not listed is not allowed.
//
//   pending ──▶ paid ──▶ shipped ──▶ delivered
//      │          │
//      └──────────┴──▶ cancelled
//
export const ORDER_TRANSITIONS = {
  pending: ["paid", "cancelled"],
  paid: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: []
};

export const canChangeStatus = (from, to) => ORDER_TRANSITIONS[from].includes(to);
