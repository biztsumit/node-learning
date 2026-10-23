"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/client-api";
import { rupees } from "@/lib/format";
import type { Pagination, Product } from "@/lib/types";
import { errorText, useAdminData } from "../use-admin-data";

type Page = { data: Product[]; pagination: Pagination };

export function AdminProductsList() {
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");

  // The public product list: admins see the same catalog customers do.
  // newest first, so a product you just added is at the top.
  const params = new URLSearchParams({ limit: "20", sort: search ? "relevance" : "newest" });
  if (search) params.set("search", search);
  const first = useAdminData<Page>(`/products?${params}`);

  const [more, setMore] = useState<{ key: string; products: Product[]; nextCursor: string | null } | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const extra = more?.key === params.toString() ? more : null;
  const products = first.data ? [...first.data.data, ...(extra?.products ?? [])] : null;
  const nextCursor = extra ? extra.nextCursor : (first.data?.pagination.nextCursor ?? null);

  const loadMore = async () => {
    if (!nextCursor) return;
    setMoreError(null);
    const key = params.toString();
    try {
      const next = new URLSearchParams(params);
      next.set("cursor", nextCursor);
      const res = await api<Page>(`/products?${next}`);
      setMore({ key, products: [...(extra?.products ?? []), ...res.data], nextCursor: res.pagination.nextCursor });
    } catch (err) {
      setMoreError(errorText(err));
    }
  };

  const find = (e: FormEvent) => {
    e.preventDefault();
    setSearch(input.trim());
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Products</h1>
        <form onSubmit={find} className="ml-auto flex gap-2 text-sm">
          <input
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search products"
            aria-label="Search products"
            className="w-48 rounded-lg border border-line-strong px-3 py-1.5 outline-none focus:border-brand"
          />
          <button type="submit" className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 hover:bg-subtle">Search</button>
        </form>
        <Link href="/admin/products/new" className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-brand-fg hover:bg-brand-hover">
          New product
        </Link>
      </div>

      {first.error && <p role="alert" className="text-danger">{first.error}</p>}

      {!products ? (
        !first.error && <div className="h-40 animate-pulse rounded-lg bg-subtle" />
      ) : products.length === 0 ? (
        <p className="text-muted">{search ? `No products match “${search}”.` : "No products yet."}</p>
      ) : (
        <div className={`relative overflow-x-auto rounded-2xl border border-line bg-surface shadow-card transition-opacity ${first.loading ? "opacity-50" : ""}`}>
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Product</th>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 text-right font-medium">Price</th>
                <th className="px-4 py-2 text-right font-medium">Stock</th>
                <th className="px-4 py-2 text-right font-medium">Variants</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line tabular-nums">
              {products.map((p) => (
                <tr key={p.id} className="hover:bg-subtle">
                  <td className="px-4 py-2">
                    <Link href={`/admin/products/${p.id}`} className="flex items-center gap-3 hover:underline">
                      <Thumbnail src={p.thumbnailUrl ?? p.imageUrl} />
                      <span className="font-medium">{p.name}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-muted">{p.category?.name ?? "—"}</td>
                  <td className="px-4 py-2 text-right">{p.variantCount > 1 && <span className="text-muted">from </span>}{rupees(p.price)}</td>
                  {/* Out of stock stands out with a word, not only a colour */}
                  <td className={`px-4 py-2 text-right ${p.stock === 0 ? "font-medium text-danger" : ""}`}>{p.stock === 0 ? "Out of stock" : p.stock}</td>
                  <td className="px-4 py-2 text-right">{p.variantCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {moreError && <p role="alert" className="text-sm text-danger">{moreError}</p>}
      {nextCursor && !first.loading && (
        <button type="button" onClick={loadMore} className="self-center text-sm underline">Load more</button>
      )}
    </div>
  );
}

function Thumbnail({ src }: { src: string | null }) {
  return src
    ? <Image src={src} alt="" width={36} height={36} className="size-9 rounded object-cover" />
    : <span className="size-9 shrink-0 rounded bg-subtle" />;
}
