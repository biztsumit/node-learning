"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ActionMessage, useAction } from "@/components/use-action";
import { api } from "@/lib/client-api";
import type { ProductWithVariants } from "@/lib/types";
import { useAdminData } from "../../use-admin-data";
import { notifyCatalogChanged } from "../catalog-changed";
import { ProductForm } from "../product-form";
import { VariantsTable } from "./variants-table";

export function EditProduct({ id }: { id: string }) {
  const router = useRouter();
  const { data, error, setData, reload } = useAdminData<{ data: ProductWithVariants }>(`/products/${id}`);
  const deletion = useAction();

  if (error && !data) {
    return <p role="alert" className="text-danger">{error}</p>;
  }
  if (!data) {
    return <div className="h-60 animate-pulse rounded-lg bg-subtle" />;
  }
  const product = data.data;

  const remove = async () => {
    if (!window.confirm(`Delete “${product.name}” and all its variants? Past orders keep their copy of it.`)) return;
    const ok = await deletion.run(() => api(`/products/${product.id}`, { method: "DELETE" }));
    if (ok) {
      await notifyCatalogChanged();
      router.push("/admin/products");
    }
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/products" className="text-sm text-muted hover:underline">← Products</Link>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{product.name}</h1>
        <Link href={`/products/${product.slug}`} className="ml-auto text-sm underline">View in shop</Link>
      </div>

      <ProductForm product={product} onSaved={(saved) => setData(() => ({ data: saved }))} />

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">Variants</h2>
          <p className="text-sm text-muted">
            Each size/colour combination has its own price and stock. The shop shows the lowest price and the total stock.
          </p>
        </div>
        {/* After a variant change, read the product again: its price and stock summary changed too */}
        <VariantsTable product={product} onChanged={reload} />
      </section>

      <section className="flex flex-col items-start gap-2 rounded-lg border border-danger/30 p-4">
        <h2 className="font-medium">Delete product</h2>
        <p className="text-sm text-muted">Removes it from the shop for good. Orders already placed are not affected.</p>
        <button type="button" onClick={remove} disabled={deletion.busy} className="rounded-lg border border-danger/40 px-4 py-2 text-sm text-danger hover:bg-danger-soft disabled:opacity-50">
          {deletion.busy ? "Deleting…" : "Delete product"}
        </button>
        <ActionMessage message={deletion.message} />
      </section>
    </div>
  );
}
