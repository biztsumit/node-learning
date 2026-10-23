"use client";

import { ChevronRight, Package } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { EmptyState } from "@/components/empty-state";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { Button, buttonStyles } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/card";
import { api } from "@/lib/client-api";
import { rupees } from "@/lib/format";
import type { OrderSummary, Pagination } from "@/lib/types";

type Page = { data: OrderSummary[]; pagination: Pagination };

// The customer's orders, newest first. "Load more" continues from the API's cursor.
export function OrdersList() {
  const { status } = useAuth();
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "signed-in") {
      return;
    }
    let cancelled = false;
    api<Page>("/orders?limit=10").then(
      (res) => {
        if (!cancelled) {
          setOrders(res.data);
          setNextCursor(res.pagination.nextCursor);
        }
      },
      // Every request can fail (the API is down, the connection drops): say so on the page,
      // instead of leaving an unhandled error and a skeleton that never goes away
      () => { if (!cancelled) setError("Couldn't load your orders. Please try again in a moment"); }
    );
    return () => {
      cancelled = true;
    };
  }, [status]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    setError(null);
    try {
      const res = await api<Page>(`/orders?limit=10&cursor=${encodeURIComponent(nextCursor)}`);
      setOrders((current) => [...(current ?? []), ...res.data]);
      setNextCursor(res.pagination.nextCursor);
    } catch {
      setError("Couldn't load more orders. Please try again");
    } finally {
      setLoadingMore(false);
    }
  };

  if (status === "guest") {
    return (
      <EmptyState icon={Package} title="Log in to see your orders">
        <Link href="/login?next=/orders" className={buttonStyles()}>Log in</Link>
      </EmptyState>
    );
  }
  if (!orders) {
    return error
      ? <p role="alert" className="text-danger">{error}</p>
      : <div className="flex flex-col gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />)}</div>;
  }
  if (orders.length === 0) {
    return (
      <EmptyState icon={Package} title="No orders yet" text="When you buy something, you can follow it here, from payment to your door.">
        <Link href="/products" className={buttonStyles()}>Start shopping</Link>
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-3">
        {orders.map((order) => (
          <li key={order.id}>
            <Link href={`/orders/${order.id}`} className="group block rounded-xl">
              <Card className="flex items-center gap-4 p-4 transition group-hover:border-line-strong group-hover:shadow-pop sm:p-5">
                <span className="hidden size-11 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-text sm:flex">
                  <Package className="size-5" aria-hidden />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{order.orderNumber}</span>
                    <OrderStatusBadge status={order.status} />
                  </div>
                  <span className="text-sm text-muted">
                    {new Date(order.createdAt).toLocaleDateString("en-IN", { dateStyle: "medium" })} · {order.itemCount} item{order.itemCount === 1 ? "" : "s"}
                  </span>
                </div>
                <span className="font-semibold">{rupees(order.totalAmount)}</span>
                <ChevronRight className="size-5 text-faint transition group-hover:translate-x-0.5" aria-hidden />
              </Card>
            </Link>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {nextCursor && (
        <Button variant="secondary" onClick={loadMore} loading={loadingMore} className="self-center">
          {loadingMore ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}
