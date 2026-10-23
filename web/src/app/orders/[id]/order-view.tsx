"use client";

import { ArrowLeft, Clock, MapPin } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { OrderTimeline } from "@/components/order-timeline";
import { PayButton } from "@/components/pay-button";
import { Button, buttonStyles } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/card";
import { ApiRequestError, api } from "@/lib/client-api";
import { dateTime, rupees } from "@/lib/format";
import type { Order } from "@/lib/types";

const CANCELLED_BECAUSE: Record<NonNullable<Order["cancelReason"]>, string> = {
  customer: "You cancelled this order.",
  admin: "We had to cancel this order.",
  payment_timeout: "Payment wasn't received in time, so the order was cancelled.",
};

export function OrderView({ id }: { id: string }) {
  const { status } = useAuth();
  const justPaid = useSearchParams().get("paid") === "1";
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const fetchOrder = useCallback(() => api<{ data: Order }>(`/orders/${id}`).then((res) => res.data), [id]);

  useEffect(() => {
    if (status !== "signed-in") {
      return;
    }
    let cancelled = false;
    fetchOrder().then(
      (data) => { if (!cancelled) setOrder(data); },
      (err) => { if (!cancelled) setError(err instanceof ApiRequestError && err.status === 404 ? "Order not found" : "Couldn't load this order"); }
    );
    return () => {
      cancelled = true;
    };
  }, [status, fetchOrder]);

  const cancel = async () => {
    if (!window.confirm("Cancel this order? The items go back on sale.")) {
      return;
    }
    setCancelling(true);
    try {
      const { data } = await api<{ data: Order }>(`/orders/${id}/cancel`, { method: "POST" });
      setOrder(data);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't cancel the order");
    } finally {
      setCancelling(false);
    }
  };

  if (status === "guest") {
    return <p className="text-muted"><Link href={`/login?next=/orders/${id}`} className="underline">Log in</Link> to see this order.</p>;
  }
  if (error && !order) {
    return <p className="text-muted">{error}. <Link href="/orders" className="underline">Your orders</Link></p>;
  }
  if (!order) {
    return <div className="flex flex-col gap-6"><Skeleton className="h-10 w-72" /><Skeleton className="h-28" /><Skeleton className="h-60" /></div>;
  }

  const address = order.shippingAddress;

  return (
    <div className="flex flex-col gap-6">
      <Link href="/orders" className="flex items-center gap-1.5 self-start text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> All your orders
      </Link>

      {justPaid && order.status === "paid" && (
        <p role="status" className="rounded-2xl border border-success/25 bg-success-soft p-4 text-success">Thank you! Your payment was received. We&apos;ll email you when it ships.</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Order {order.orderNumber}</h1>
        <OrderStatusBadge status={order.status} />
        <span className="w-full text-sm text-muted sm:w-auto">Placed {dateTime(order.createdAt)}</span>
      </div>

      <Card className="px-2 py-6 sm:px-6">
        <OrderTimeline status={order.status} wasPaid={Boolean(order.refund)} />
      </Card>

      {order.status === "pending" && (
        <Card className="flex flex-col gap-4 border-warning/30 bg-warning-soft p-5 sm:flex-row sm:items-center">
          <Clock className="size-6 shrink-0 text-warning" aria-hidden />
          <p className="flex-1 text-sm">
            <span className="font-medium">Waiting for payment.</span>
            {order.expiresAt && <> Pay before <strong>{dateTime(order.expiresAt)}</strong>, or the order is cancelled and the items go back on sale.</>}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <PayButton orderId={order.id} label={`Pay ${rupees(order.totalAmount)}`} onPaid={setOrder} />
            <Button variant="ghost" onClick={cancel} loading={cancelling}>{cancelling ? "Cancelling…" : "Cancel order"}</Button>
          </div>
        </Card>
      )}

      {order.status === "cancelled" && (
        <p className="rounded-2xl bg-subtle p-4 text-sm text-muted">
          {order.cancelReason ? CANCELLED_BECAUSE[order.cancelReason] : "This order was cancelled."}
          {order.refund && <> Your payment of {rupees(order.refund.amount)} {order.refund.status === "processed" ? "has been refunded" : "is being refunded"}.</>}
        </p>
      )}

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <h2 className="border-b border-line px-5 py-3 font-medium">Items</h2>
          <ul className="divide-y divide-line">
            {order.items.map((item, i) => (
              <li key={`${item.variantId ?? i}`} className="flex items-center gap-4 px-5 py-4 text-sm">
                <span className="flex-1">
                  <span className="font-medium">{item.productName}</span>
                  {item.optionsLabel && <span className="block text-muted">{item.optionsLabel}</span>}
                  <span className="block text-muted">{rupees(item.unitPrice)} × {item.quantity}</span>
                </span>
                <span className="font-medium">{rupees(item.lineTotal)}</span>
              </li>
            ))}
          </ul>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="p-5 text-sm">
            <dl className="flex flex-col gap-2">
              <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd>{rupees(order.subtotalAmount)}</dd></div>
              {order.discountAmount > 0 && (
                <div className="flex justify-between text-success"><dt>Coupon {order.couponCode}</dt><dd>−{rupees(order.discountAmount)}</dd></div>
              )}
              <div className="flex items-baseline justify-between border-t border-line pt-3"><dt className="font-medium">Total</dt><dd className="text-lg font-semibold">{rupees(order.totalAmount)}</dd></div>
            </dl>
          </Card>
          <Card className="flex gap-3 p-5 text-sm">
            <MapPin className="mt-0.5 size-5 shrink-0 text-brand-text" aria-hidden />
            <div>
              <h2 className="mb-1 font-medium">Shipping to</h2>
              <p className="text-muted">
                {address.fullName}<br />
                {address.line1}{address.line2 && <><br />{address.line2}</>}<br />
                {address.city}, {address.state} {address.postalCode}<br />
                {address.phone}
              </p>
            </div>
          </Card>
          <Link href="/products" className={buttonStyles({ variant: "secondary" })}>Continue shopping</Link>
        </div>
      </div>
    </div>
  );
}
