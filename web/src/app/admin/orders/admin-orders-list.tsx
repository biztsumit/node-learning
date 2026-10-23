"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { api } from "@/lib/client-api";
import { dateTime, rupees } from "@/lib/format";
import type { AdminOrderSummary, OrderStatus, Pagination } from "@/lib/types";
import { errorText, useAdminData } from "../use-admin-data";

type Page = { data: AdminOrderSummary[]; pagination: Pagination };

const FILTERS: Array<{ value: OrderStatus | ""; label: string }> = [
  { value: "", label: "All" },
  { value: "paid", label: "To ship" },          // paid = waiting to be shipped
  { value: "pending", label: "Awaiting payment" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

// Every order in the shop, newest first: filter by status, or find one by its number
export function AdminOrdersList() {
  const [status, setStatus] = useState<OrderStatus | "">("paid");
  const [orderNumber, setOrderNumber] = useState("");
  const [search, setSearch] = useState("");

  const params = new URLSearchParams({ limit: "20" });
  if (search) params.set("orderNumber", search);
  else if (status) params.set("status", status);
  const first = useAdminData<Page>(`/admin/orders?${params}`);

  // Pages after the first, from "Load more". Kept apart from the first page, and cleared
  // whenever the filter changes (they belong to the old filter).
  const [more, setMore] = useState<{ key: string; orders: AdminOrderSummary[]; nextCursor: string | null } | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const extra = more?.key === params.toString() ? more : null;

  const orders = first.data ? [...first.data.data, ...(extra?.orders ?? [])] : null;
  const nextCursor = extra ? extra.nextCursor : (first.data?.pagination.nextCursor ?? null);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    setMoreError(null);
    const key = params.toString();
    try {
      const next = new URLSearchParams(params);
      next.set("cursor", nextCursor);
      const res = await api<Page>(`/admin/orders?${next}`);
      setMore({ key, orders: [...(extra?.orders ?? []), ...res.data], nextCursor: res.pagination.nextCursor });
    } catch (err) {
      setMoreError(errorText(err));
    } finally {
      setLoadingMore(false);
    }
  };

  const find = (e: FormEvent) => {
    e.preventDefault();
    setSearch(orderNumber.trim());
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Status" className="flex flex-wrap gap-1 text-sm">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={!search && status === f.value}
              onClick={() => { setStatus(f.value); setSearch(""); setOrderNumber(""); }}
              className="rounded-full border border-line-strong bg-surface px-3 py-1 text-muted hover:text-fg aria-pressed:border-brand aria-pressed:bg-brand aria-pressed:text-brand-fg"
            >
              {f.label}
            </button>
          ))}
        </div>
        <form onSubmit={find} className="ml-auto flex gap-2 text-sm">
          <input
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            placeholder="ORD-7K3M9Q"
            aria-label="Order number"
            className="w-36 rounded-lg border border-line-strong px-3 py-1.5 outline-none focus:border-brand"
          />
          <button type="submit" className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 hover:bg-subtle">Find</button>
        </form>
      </div>

      {first.error && <p role="alert" className="text-danger">{first.error}</p>}

      {!orders ? (
        !first.error && <div className="h-40 animate-pulse rounded-lg bg-subtle" />
      ) : orders.length === 0 ? (
        <p className="text-muted">{search ? `No order ${search.toUpperCase()}.` : "No orders here."}</p>
      ) : (
        <div className={`relative overflow-x-auto rounded-2xl border border-line bg-surface shadow-card transition-opacity ${first.loading ? "opacity-50" : ""}`}>
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Order</th>
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Placed</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {orders.map((order) => (
                <tr key={order.id} className="hover:bg-subtle">
                  <td className="px-4 py-2">
                    <Link href={`/admin/orders/${order.id}`} className="font-medium hover:underline">{order.orderNumber}</Link>
                  </td>
                  <td className="px-4 py-2">
                    {order.customer.name}
                    <span className="block text-xs text-muted">{order.customer.email}</span>
                  </td>
                  <td className="px-4 py-2"><OrderStatusBadge status={order.status} /></td>
                  <td className="whitespace-nowrap px-4 py-2 text-muted">{dateTime(order.createdAt)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{rupees(order.totalAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {moreError && <p role="alert" className="text-sm text-danger">{moreError}</p>}
      {nextCursor && !first.loading && (
        <button type="button" onClick={loadMore} disabled={loadingMore} className="self-center text-sm underline disabled:opacity-50">
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
