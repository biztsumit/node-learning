"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ProductForm } from "../product-form";

export function NewProduct() {
  const router = useRouter();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Link href="/admin/products" className="text-sm text-muted hover:underline">← Products</Link>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">New product</h1>
      {/* Once created, continue on its edit page: that's where sizes/colours (variants) are added */}
      <ProductForm onSaved={(product) => router.push(`/admin/products/${product.id}`)} />
    </div>
  );
}
