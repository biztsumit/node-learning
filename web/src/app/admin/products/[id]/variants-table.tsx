"use client";

import { useState, type FormEvent } from "react";
import { ActionMessage, useAction } from "@/components/use-action";
import { api } from "@/lib/client-api";
import type { ProductWithVariants, Variant } from "@/lib/types";
import { notifyCatalogChanged } from "../catalog-changed";

// Options are typed as "size: M, colour: Blue" and sent as { size: "M", colour: "Blue" }
const formatOptions = (options: Record<string, string>) =>
  Object.entries(options).map(([name, value]) => `${name}: ${value}`).join(", ");

const parseOptions = (text: string): Record<string, string> | string => {
  const options: Record<string, string> = {};
  for (const part of text.split(",").map((p) => p.trim()).filter(Boolean)) {
    const [name, ...rest] = part.split(":");
    const value = rest.join(":").trim();
    if (!name?.trim() || !value) {
      return `“${part}” should look like “size: M”`;
    }
    options[name.trim()] = value;
  }
  return options;
};

// The form fields → the API's body. Returns a message instead when something can't be read.
const readVariant = (form: FormData) => {
  const field = (name: string) => String(form.get(name) ?? "").trim();
  const options = parseOptions(field("options"));
  if (typeof options === "string") return options;
  return {
    options,
    sku: field("sku") || null,
    price: Number(field("price")),
    stock: Number(field("stock")),
  };
};

const input = "w-full rounded-lg border border-line-strong px-2 py-1 outline-none focus:border-brand";

export function VariantsTable({ product, onChanged }: { product: ProductWithVariants; onChanged: () => void }) {
  const adding = useAction();
  // Bumping this empties the "add" form after a variant is added
  const [addFormKey, setAddFormKey] = useState(0);
  const exampleOptions = formatOptions(product.variants[0]?.options ?? {}) || "size: M, colour: Blue";

  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const body = readVariant(new FormData(e.currentTarget));
    if (typeof body === "string") {
      adding.fail(body);
      return;
    }
    const ok = await adding.run(() => api(`/products/${product.id}/variants`, { method: "POST", body }), "Variant added");
    if (ok) {
      setAddFormKey((k) => k + 1);
      await notifyCatalogChanged();
      onChanged();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="relative overflow-x-auto rounded-2xl border border-line bg-surface shadow-card">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Options</th>
              <th className="px-3 py-2 font-medium">SKU</th>
              <th className="w-28 px-3 py-2 font-medium">Price (₹)</th>
              <th className="w-24 px-3 py-2 font-medium">Stock</th>
              <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {product.variants.map((variant) => (
              <VariantRow
                key={variant.id}
                productId={product.id}
                variant={variant}
                onlyOne={product.variants.length === 1}
                onChanged={onChanged}
              />
            ))}
          </tbody>
        </table>
      </div>

      <form key={addFormKey} onSubmit={add} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface shadow-card p-4">
        <h3 className="font-medium">Add a variant</h3>
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr]">
          <label className="flex flex-col gap-1 text-sm">
            <span>Options</span>
            <input name="options" placeholder={exampleOptions} className={input} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>SKU (optional)</span>
            <input name="sku" className={input} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Price (₹)</span>
            <input name="price" type="number" min={0} step={1} required className={input} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Stock</span>
            <input name="stock" type="number" min={0} step={1} defaultValue={0} required className={input} />
          </label>
        </div>
        <p className="text-xs text-muted">Every variant of a product needs the same option names, e.g. all have “size” and “colour”.</p>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={adding.busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-fg hover:bg-brand-hover disabled:opacity-50">
            {adding.busy ? "Adding…" : "Add variant"}
          </button>
          <ActionMessage message={adding.message} />
        </div>
      </form>
    </div>
  );
}

function VariantRow({ productId, variant, onlyOne, onChanged }: { productId: string; variant: Variant; onlyOne: boolean; onChanged: () => void }) {
  const action = useAction();
  const formId = `variant-${variant.id}`;

  // A table row can't contain a <form>, so the inputs join it with form={formId}
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const body = readVariant(new FormData(e.currentTarget));
    if (typeof body === "string") {
      action.fail(body);
      return;
    }
    const ok = await action.run(() => api(`/products/${productId}/variants/${variant.id}`, { method: "PATCH", body }), "Saved");
    if (ok) {
      await notifyCatalogChanged();
      onChanged();
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete the variant “${variant.label || "default"}”?`)) return;
    const ok = await action.run(() => api(`/products/${productId}/variants/${variant.id}`, { method: "DELETE" }));
    if (ok) {
      await notifyCatalogChanged();
      onChanged();
    }
  };

  return (
    <tr className="align-top">
      <td className="px-3 py-2">
        <form id={formId} onSubmit={save} />
        <input form={formId} name="options" defaultValue={formatOptions(variant.options)} placeholder="No options" aria-label="Options" className={input} />
        <ActionMessage message={action.message} />
      </td>
      <td className="px-3 py-2"><input form={formId} name="sku" defaultValue={variant.sku ?? ""} aria-label="SKU" className={input} /></td>
      <td className="px-3 py-2"><input form={formId} name="price" type="number" min={0} step={1} required defaultValue={variant.price} aria-label="Price" className={input} /></td>
      <td className="px-3 py-2"><input form={formId} name="stock" type="number" min={0} step={1} required defaultValue={variant.stock} aria-label="Stock" className={input} /></td>
      <td className="whitespace-nowrap px-3 py-2 text-right">
        <button type="submit" form={formId} disabled={action.busy} className="rounded-lg border border-line-strong px-3 py-1 hover:bg-subtle disabled:opacity-50">Save</button>
        {/* The API refuses to delete the last variant: a product always has at least one */}
        {!onlyOne && (
          <button type="button" onClick={remove} disabled={action.busy} className="ml-2 rounded-lg px-2 py-1 text-danger hover:bg-danger-soft disabled:opacity-50">Delete</button>
        )}
      </td>
    </tr>
  );
}
