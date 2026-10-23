"use client";

import { useState, type FormEvent } from "react";
import { FormField } from "@/components/form-field";
import { ActionMessage } from "@/components/use-action";
import { ApiRequestError, api } from "@/lib/client-api";
import type { Coupon } from "@/lib/types";
import { errorText } from "../use-admin-data";

// <input type="datetime-local"> works in the browser's local time, without a time zone:
// "2026-12-31T23:59". These convert between that and the API's full ISO dates.
const toLocalInput = (iso: string | null): string => {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
// new Date("2026-12-31T23:59") reads it as local time; toISOString() adds the zone (as UTC)
const fromLocalInput = (value: string): string | null => (value ? new Date(value).toISOString() : null);

// Creating (no `coupon`) or editing one. Both send every field: on create the API fills in
// nothing unexpected, and on edit (PATCH) sending unchanged values is harmless.
export function CouponForm({ coupon, onSaved, onCancel }: { coupon?: Coupon; onSaved: (coupon: Coupon) => void; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [discountType, setDiscountType] = useState<Coupon["discountType"]>(coupon?.discountType ?? "percent");

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    // Empty = "no limit" (null). The API checks the numbers themselves.
    const numberOrNull = (name: string) => (text(name) === "" ? null : Number(text(name)));

    const body = {
      code: text("code"),
      description: text("description"),
      discountType,
      discountValue: Number(text("discountValue")),
      minOrderAmount: Number(text("minOrderAmount") || 0),
      maxDiscount: discountType === "percent" ? numberOrNull("maxDiscount") : null,
      startsAt: fromLocalInput(text("startsAt")),
      expiresAt: fromLocalInput(text("expiresAt")),
      usageLimit: numberOrNull("usageLimit"),
      perUserLimit: numberOrNull("perUserLimit"),
      isActive: form.get("isActive") === "on",
    };

    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = coupon
        ? await api<{ data: Coupon }>(`/admin/coupons/${coupon.id}`, { method: "PATCH", body })
        : await api<{ data: Coupon }>("/admin/coupons", { method: "POST", body });
      onSaved(res.data);
    } catch (err) {
      if (err instanceof ApiRequestError && err.fieldErrors.length > 0) {
        setFieldErrors(Object.fromEntries(err.fieldErrors.map((f) => [f.field, f.message])));
      } else {
        // Rules about several fields together ("expiresAt must be after startsAt") come
        // back as one message
        setError(errorText(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-line bg-surface shadow-card p-4">
      <h2 className="font-medium">{coupon ? `Edit ${coupon.code}` : "New coupon"}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Code" name="code" required defaultValue={coupon?.code} placeholder="WELCOME10" error={fieldErrors.code} />
        <FormField label="Description (shown to customers)" name="description" maxLength={255} defaultValue={coupon?.description} error={fieldErrors.description} />
      </div>

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium">Discount</legend>
        <div className="flex gap-4">
          <label className="flex items-center gap-2">
            <input type="radio" name="discountType" checked={discountType === "percent"} onChange={() => setDiscountType("percent")} /> Percent off
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="discountType" checked={discountType === "fixed"} onChange={() => setDiscountType("fixed")} /> Fixed amount off
          </label>
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label={discountType === "percent" ? "Percent (1–100)" : "Amount off (₹)"} name="discountValue" type="number" min={1} max={discountType === "percent" ? 100 : undefined} step={1} required defaultValue={coupon?.discountValue} error={fieldErrors.discountValue} />
        <FormField label="Minimum order (₹)" name="minOrderAmount" type="number" min={0} step={1} defaultValue={coupon?.minOrderAmount ?? 0} error={fieldErrors.minOrderAmount} />
        {discountType === "percent" && (
          <FormField label="Maximum discount (₹, optional)" name="maxDiscount" type="number" min={1} step={1} defaultValue={coupon?.maxDiscount ?? ""} error={fieldErrors.maxDiscount} />
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Starts (optional)" name="startsAt" type="datetime-local" defaultValue={toLocalInput(coupon?.startsAt ?? null)} error={fieldErrors.startsAt} />
        <FormField label="Expires (optional)" name="expiresAt" type="datetime-local" defaultValue={toLocalInput(coupon?.expiresAt ?? null)} error={fieldErrors.expiresAt} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Total uses allowed (empty = unlimited)" name="usageLimit" type="number" min={1} step={1} defaultValue={coupon?.usageLimit ?? ""} error={fieldErrors.usageLimit} />
        <FormField label="Uses per customer (empty = unlimited)" name="perUserLimit" type="number" min={1} step={1} defaultValue={coupon ? (coupon.perUserLimit ?? "") : 1} error={fieldErrors.perUserLimit} />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isActive" defaultChecked={coupon?.isActive ?? true} /> Active (customers can use it)
      </label>

      {error && <ActionMessage message={{ ok: false, text: error }} />}
      <div className="flex gap-3">
        <button type="submit" disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-fg hover:bg-brand-hover disabled:opacity-50">
          {busy ? "Saving…" : coupon ? "Save coupon" : "Create coupon"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-line-strong px-4 py-2 text-sm hover:bg-subtle">Cancel</button>
      </div>
    </form>
  );
}
