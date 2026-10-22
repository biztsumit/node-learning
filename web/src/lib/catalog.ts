// Reading the public catalog, ON THE SERVER (Server Components call these).
//
// 'use cache' keeps each result, so pages don't ask the API again on every visit, and
// cacheLife says for how long. The arguments are part of the cache key: products for
// "?search=mug" and "?search=lamp" are cached separately.
import { cacheLife, cacheTag } from "next/cache";
import type { Category, Pagination, Product, ProductWithVariants } from "./types";

const API_URL = process.env.API_URL ?? "http://localhost:3000";

export type ProductQuery = {
  search?: string;
  category?: string;
  sort?: string;
  cursor?: string;
  limit?: number;
};

const getJson = async <T>(path: string): Promise<T | null> => {
  const res = await fetch(`${API_URL}${path}`);
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`API ${path} answered ${res.status}`);
  }
  return (await res.json()) as T;
};

export const getProducts = async (query: ProductQuery): Promise<{ products: Product[]; pagination: Pagination }> => {
  "use cache";
  cacheLife("minutes");
  cacheTag("products");

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  const body = await getJson<{ data: Product[]; pagination: Pagination }>(`/products?${params}`);
  return { products: body?.data ?? [], pagination: body?.pagination ?? { limit: 0, nextCursor: null } };
};

export const getProductBySlug = async (slug: string): Promise<ProductWithVariants | null> => {
  "use cache";
  cacheLife("minutes");
  cacheTag("products", `product:${slug}`);

  const body = await getJson<{ data: ProductWithVariants }>(`/products/slug/${encodeURIComponent(slug)}`);
  return body?.data ?? null;
};

export const getCategories = async (): Promise<Category[]> => {
  "use cache";
  cacheLife("hours");
  cacheTag("categories");

  const body = await getJson<{ data: Category[] }>("/categories");
  return body?.data ?? [];
};
