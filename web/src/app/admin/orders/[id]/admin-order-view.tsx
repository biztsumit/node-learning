"use client";

import Link from "next/link";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { ActionMessage, useAction } from "@/components/use-action";
import { api } from "@/lib/client-api";
import { dateTime, rupees } from "@/lib/format";
import type { AdminOrder, OrderStatus } from "@/lib/types";
import { useAdminData } from "../../use-admin-data";

// The buttons each status offers. Mirrors ORDER_TRANSITIONS in the API
// (src/utils/order-status.ts): the API refuses anything else anyway, this just avoids
// showing buttons that could only fail.
const NEXT_STEPS: Record<OrderStatus, Array<{ to: OrderStatus; label: string; confirm?: string }>> = {
  pending: [
    { to: "paid", label: "Mark as paid", confirm: "Only for money received outside the website (e.g. cash or bank transfer). Mark this order as paid?" },
    { to: "cancelled", label: "Cancel order", confirm: "Cancel this order? Its items go back into stock." },
  ],
  paid: [
    { to: "shipped", label: "Mark as shipped" },
    { to: "cancelled", label: "Cancel and refund", confirm: "Cancel this order? An online payment is refunded to the customer, and the items go back into stock." },
  ],
  shipped: [{ to: "delivered", label: "Mark as delivered" }],
  delivered: [],
  cancelled: [],
};

const CANCELLED_BY = { customer: "the customer", admin: "an admin", payment_timeout: "the shop: it wasn't paid in time" } as const;

export function AdminOrderView({ id }: { id: string }) {
  const { data, error, setData } = useAdminData<{ data: AdminOrder }>(`/admin/orders/${id}`);
  const action = useAction();

  if (error && !data) {
    return <p role="alert" className="text-danger">{error}</p>;
  }
  if (!data) {
    return <div className="h-60 animate-pulse rounded-lg bg-subtle" />;
  }
  const order = data.data;

  const changeStatus = async (step: (typeof NEXT_STEPS)[OrderStatus][number]) => {
    if (step.confirm && !window.confirm(step.confirm)) return;
    await action.run(async () => {
      const res = await api<{ data: AdminOrder }>(`/admin/orders/${order.id}/status`, { method: "PATCH", body: { status: step.to } });
      // The answer is the updated order: show it straight away
      setData(() => res);
    }, `Order marked as ${step.to}`);
  };

  const a = order.shippingAddress;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/orders" className="text-sm text-muted hover:underline">← Orders</Link>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{order.orderNumber}</h1>
        <OrderStatusBadge status={order.status} />
        <span className="text-sm text-muted">Placed {dateTime(order.createdAt)}</span>
      </div>

      <section className="flex flex-wrap items-center gap-3">
        {NEXT_STEPS[order.status].map((step) => (
          <button
            key={step.to}
            type="button"
            disabled={action.busy}
            onClick={() => changeStatus(step)}
            className={step.to === "cancelled"
              ? "rounded-lg border border-danger/40 px-4 py-2 text-sm text-danger hover:bg-danger-soft disabled:opacity-50"
              : "rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-fg hover:bg-brand-hover disabled:opacity-50"}
          >
            {step.label}
          </button>
        ))}
        {NEXT_STEPS[order.status].length === 0 && <p className="text-sm text-muted">This order is finished: nothing more to do.</p>}
        <ActionMessage message={action.message} />
      </section>

      {order.cancelReason && <p className="text-sm text-muted">Cancelled by {CANCELLED_BY[order.cancelReason]}.</p>}
      {order.refund && (
        <p className="text-sm text-muted">
          Refund of {rupees(order.refund.amount)}: <span className="font-medium">{order.refund.status}</span> (requested {dateTime(order.refund.requestedAt)})
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-2xl border border-line bg-surface shadow-card p-4 text-sm">
          <h2 className="mb-2 font-medium">Customer</h2>
          <p>{order.customer.name}</p>
          <p className="text-muted">{order.customer.email}</p>
        </section>
        <section className="rounded-2xl border border-line bg-surface shadow-card p-4 text-sm">
          <h2 className="mb-2 font-medium">Ship to</h2>
          <p>{a.fullName} · {a.phone}</p>
          <p className="text-muted">{a.line1}{a.line2 && `, ${a.line2}`}, {a.city}, {a.state} {a.postalCode}, {a.country}</p>
        </section>
      </div>

      <section className="relative overflow-x-auto rounded-2xl border border-line bg-surface shadow-card">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Item</th>
              <th className="px-4 py-2 font-medium">SKU</th>
              <th className="px-4 py-2 text-right font-medium">Price</th>
              <th className="px-4 py-2 text-right font-medium">Qty</th>
              <th className="px-4 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line tabular-nums">
            {order.items.map((item, i) => (
              <tr key={item.variantId ?? i}>
                <td className="px-4 py-2">
                  {item.productName}
                  {item.optionsLabel && <span className="block text-xs text-muted">{item.optionsLabel}</span>}
                </td>
                <td className="px-4 py-2 text-muted">{item.sku ?? "—"}</td>
                <td className="px-4 py-2 text-right">{rupees(item.unitPrice)}</td>
                <td className="px-4 py-2 text-right">{item.quantity}</td>
                <td className="px-4 py-2 text-right">{rupees(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-line tabular-nums">
            <tr><td colSpan={4} className="px-4 pt-2 text-right text-muted">Subtotal</td><td className="px-4 pt-2 text-right">{rupees(order.subtotalAmount)}</td></tr>
            {order.discountAmount > 0 && (
              <tr><td colSpan={4} className="px-4 text-right text-muted">Coupon {order.couponCode}</td><td className="px-4 text-right">−{rupees(order.discountAmount)}</td></tr>
            )}
            <tr><td colSpan={4} className="px-4 pb-2 text-right font-medium">Total</td><td className="px-4 pb-2 text-right font-medium">{rupees(order.totalAmount)}</td></tr>
          </tfoot>
        </table>
      </section>
    </div>
  );
}
