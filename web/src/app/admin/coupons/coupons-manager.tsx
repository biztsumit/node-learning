"use client";

import { useState } from "react";
import { ActionMessage, useAction } from "@/components/use-action";
import { api } from "@/lib/client-api";
import { dateTime, rupees } from "@/lib/format";
import type { Coupon, Pagination } from "@/lib/types";
import { useAdminData } from "../use-admin-data";
import { CouponForm } from "./coupon-form";

type Page = { data: Coupon[]; pagination: Pagination };

// "10% off (up to ₹200) on ₹999+"
const describe = (c: Coupon) =>
  `${c.discountType === "percent" ? `${c.discountValue}% off` : `${rupees(c.discountValue)} off`}` +
  `${c.maxDiscount ? ` (up to ${rupees(c.maxDiscount)})` : ""}` +
  `${c.minOrderAmount > 0 ? ` on ${rupees(c.minOrderAmount)}+` : ""}`;

// Whether customers can use it right now, and if not, why. In words, not only colour.
const state = (c: Coupon): { text: string; usable: boolean } => {
  const now = Date.now();
  if (!c.isActive) return { text: "Off", usable: false };
  if (c.expiresAt && Date.parse(c.expiresAt) <= now) return { text: "Expired", usable: false };
  if (c.startsAt && Date.parse(c.startsAt) > now) return { text: "Scheduled", usable: false };
  if (c.usageLimit !== null && c.timesUsed >= c.usageLimit) return { text: "Used up", usable: false };
  return { text: "Live", usable: true };
};

export function CouponsManager() {
  const [page, setPage] = useState(1);
  const list = useAdminData<Page>(`/admin/coupons?page=${page}&limit=20`);
  // null = no form open; "new" = creating; a coupon = editing that one
  const [editing, setEditing] = useState<Coupon | "new" | null>(null);

  const saved = () => {
    setEditing(null);
    list.reload();
  };

  const totalPages = list.data?.pagination.totalPages ?? 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Coupons</h1>
        {editing === null && (
          <button type="button" onClick={() => setEditing("new")} className="ml-auto rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-brand-fg hover:bg-brand-hover">
            New coupon
          </button>
        )}
      </div>

      {editing !== null && (
        // key: a fresh form for each coupon (its inputs start from that coupon's values)
        <CouponForm key={editing === "new" ? "new" : editing.id} coupon={editing === "new" ? undefined : editing} onSaved={saved} onCancel={() => setEditing(null)} />
      )}

      {list.error && <p role="alert" className="text-danger">{list.error}</p>}

      {!list.data ? (
        !list.error && <div className="h-40 animate-pulse rounded-lg bg-subtle" />
      ) : list.data.data.length === 0 ? (
        <p className="text-muted">No coupons yet.</p>
      ) : (
        <div className={`relative overflow-x-auto rounded-2xl border border-line bg-surface shadow-card transition-opacity ${list.loading ? "opacity-50" : ""}`}>
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Discount</th>
                <th className="px-4 py-2 font-medium">Used</th>
                <th className="px-4 py-2 font-medium">Valid</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.data.data.map((coupon) => (
                <CouponRow key={coupon.id} coupon={coupon} onEdit={() => setEditing(coupon)} onChanged={list.reload} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="underline disabled:no-underline disabled:opacity-40">Previous</button>
          <span className="text-muted">Page {page} of {totalPages}</span>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="underline disabled:no-underline disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}

function CouponRow({ coupon, onEdit, onChanged }: { coupon: Coupon; onEdit: () => void; onChanged: () => void }) {
  const action = useAction();
  const { text, usable } = state(coupon);

  // Switching a coupon off is the gentle option: it stops new uses, and keeps its history
  const toggle = async () => {
    const ok = await action.run(() => api(`/admin/coupons/${coupon.id}`, { method: "PATCH", body: { isActive: !coupon.isActive } }));
    if (ok) onChanged();
  };

  const remove = async () => {
    if (!window.confirm(`Delete coupon ${coupon.code}?`)) return;
    const ok = await action.run(() => api(`/admin/coupons/${coupon.id}`, { method: "DELETE" }));
    if (ok) onChanged();
  };

  return (
    <tr className="align-top">
      <td className="px-4 py-2">
        <span className="font-mono font-medium">{coupon.code}</span>
        {coupon.description && <span className="block text-xs text-muted">{coupon.description}</span>}
        <ActionMessage message={action.message} />
      </td>
      <td className="px-4 py-2">{describe(coupon)}</td>
      <td className="whitespace-nowrap px-4 py-2 tabular-nums">
        {coupon.timesUsed}{coupon.usageLimit !== null && ` / ${coupon.usageLimit}`}
        {coupon.perUserLimit !== null && <span className="block text-xs text-muted">{coupon.perUserLimit} per customer</span>}
      </td>
      <td className="px-4 py-2 text-xs text-muted">
        {coupon.startsAt && <span className="block">From {dateTime(coupon.startsAt)}</span>}
        {coupon.expiresAt ? <span className="block">Until {dateTime(coupon.expiresAt)}</span> : !coupon.startsAt && "Always"}
      </td>
      <td className="px-4 py-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${usable ? "bg-success-soft text-success" : "bg-subtle text-muted"}`}>{text}</span>
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-right">
        <button type="button" onClick={toggle} disabled={action.busy} className="rounded-lg border border-line-strong px-3 py-1 hover:bg-subtle disabled:opacity-50">
          {coupon.isActive ? "Turn off" : "Turn on"}
        </button>
        <button type="button" onClick={onEdit} className="ml-2 rounded-lg px-2 py-1 hover:bg-subtle">Edit</button>
        {/* A used coupon is part of past orders' history: the API refuses to delete it (turn it off instead) */}
        {coupon.timesUsed === 0 && (
          <button type="button" onClick={remove} disabled={action.busy} className="ml-1 rounded-lg px-2 py-1 text-danger hover:bg-danger-soft disabled:opacity-50">Delete</button>
        )}
      </td>
    </tr>
  );
}
