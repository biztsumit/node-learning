"use client";

import { useState, type FormEvent } from "react";
import { FormField } from "@/components/form-field";
import { ActionMessage } from "@/components/use-action";
import { ApiRequestError, api } from "@/lib/client-api";
import type { Category, ProductWithVariants } from "@/lib/types";
import { errorText, useAdminData } from "../use-admin-data";
import { notifyCatalogChanged } from "./catalog-changed";

// Creating (no `product`) or editing a product's details.
// Price and stock belong to VARIANTS: a new product gets its first variant from the price and
// stock typed here; after that they're edited in the variants table, not in this form.
export function ProductForm({ product, onSaved }: { product?: ProductWithVariants; onSaved: (product: ProductWithVariants) => void }) {
  const categories = useAdminData<{ data: Category[] }>("/categories");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // The API's messages per field ("price must be a whole number"), shown under each input
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    // An empty number box is "not given"; the API explains anything else that's wrong
    const number = (name: string) => (text(name) === "" ? undefined : Number(text(name)));

    const body = {
      name: text("name"),
      description: text("description"),
      categoryId: text("categoryId") || null,
      imageUrl: text("imageUrl") || null,
      ...(!product && { price: number("price"), stock: number("stock") ?? 0 }),
    };

    setBusy(true);
    setMessage(null);
    setFieldErrors({});
    try {
      // POST creates, PUT replaces the details of an existing product
      const res = product
        ? await api<{ data: ProductWithVariants }>(`/products/${product.id}`, { method: "PUT", body })
        : await api<{ data: ProductWithVariants }>("/products", { method: "POST", body });
      await notifyCatalogChanged();
      if (product) {
        setMessage({ ok: true, text: "Saved" });
      } else {
        // Next keeps recently visited pages alive (hidden) so "Back" is instant. Empty the
        // form, so "New product" next time starts blank instead of showing this one again.
        formElement.reset();
      }
      onSaved(res.data);
    } catch (err) {
      if (err instanceof ApiRequestError && err.fieldErrors.length > 0) {
        setFieldErrors(Object.fromEntries(err.fieldErrors.map((f) => [f.field, f.message])));
      } else {
        setMessage({ ok: false, text: errorText(err) });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-line bg-surface shadow-card p-4">
      <FormField label="Name" name="name" required maxLength={255} defaultValue={product?.name} error={fieldErrors.name} />

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Description</span>
        <textarea name="description" rows={4} maxLength={5000} defaultValue={product?.description} className="rounded-lg border border-line-strong px-3 py-2 outline-none focus:border-brand" />
        {fieldErrors.description && <span className="text-danger">{fieldErrors.description}</span>}
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Category</span>
          {/* key: re-create the select once the categories arrive, so defaultValue applies */}
          <select key={categories.data ? "loaded" : "loading"} name="categoryId" defaultValue={product?.category?.id ?? ""} className="rounded-lg border border-line-strong bg-surface px-3 py-2 outline-none focus:border-brand">
            <option value="">No category</option>
            {categories.data?.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {fieldErrors.categoryId && <span className="text-danger">{fieldErrors.categoryId}</span>}
        </label>
        <FormField label="Image URL (optional)" name="imageUrl" type="url" placeholder="https://…" defaultValue={product?.imageUrl ?? ""} error={fieldErrors.imageUrl} />
      </div>

      {!product && (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Price (₹)" name="price" type="number" min={0} step={1} required error={fieldErrors.price} />
          <FormField label="Stock" name="stock" type="number" min={0} step={1} defaultValue={0} error={fieldErrors.stock} />
        </div>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-fg hover:bg-brand-hover disabled:opacity-50">
          {busy ? "Saving…" : product ? "Save details" : "Create product"}
        </button>
        <ActionMessage message={message} />
      </div>
    </form>
  );
}
