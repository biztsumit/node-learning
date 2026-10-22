import Link from "next/link";
import { Suspense } from "react";
import { ProductCard } from "@/components/product-card";
import { getCategories, getProducts } from "@/lib/catalog";

export const metadata = { title: "All products" };

const SORTS = [
  { value: "", label: "Best match / newest" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "rating_desc", label: "Top rated" },
  { value: "name_asc", label: "Name" },
];

type Search = { search?: string; category?: string; sort?: string; cursor?: string };

// The URL decides what's shown (?search=…&category=…&sort=…). searchParams is only known at
// request time, so everything that reads it sits inside <Suspense>: the page shell around it
// is prerendered and appears at once.
export default function ProductsPage({ searchParams }: PageProps<"/products">) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">All products</h1>
      <Suspense fallback={<ResultsSkeleton />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const pick = (value: string | string[] | undefined): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

async function Results({ searchParams }: Pick<PageProps<"/products">, "searchParams">) {
  const raw = await searchParams;
  const query: Search = { search: pick(raw.search), category: pick(raw.category), sort: pick(raw.sort), cursor: pick(raw.cursor) };

  const [{ products, pagination }, categories] = await Promise.all([
    getProducts({ ...query, limit: 12 }),
    getCategories(),
  ]);

  // Links keep the current filters; the next page continues from the API's cursor
  const href = (changes: Partial<Search>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...query, cursor: undefined, ...changes })) {
      if (value) params.set(key, value);
    }
    return `/products?${params}`;
  };

  return (
    <>
      <form action="/products" className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 bg-white p-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500">Search</span>
          <input name="search" defaultValue={query.search} className="rounded-md border border-zinc-300 px-2 py-1.5" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500">Category</span>
          <select name="category" defaultValue={query.category ?? ""} className="rounded-md border border-zinc-300 px-2 py-1.5">
            <option value="">All</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500">Sort</span>
          <select name="sort" defaultValue={query.sort ?? ""} className="rounded-md border border-zinc-300 px-2 py-1.5">
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <button className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white hover:bg-zinc-700">Apply</button>
      </form>

      {products.length === 0 ? (
        <p className="text-zinc-500">
          No products match{query.search && <> “{query.search}”</>}. <Link href="/products" className="underline">See everything</Link>
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {products.map((product) => <ProductCard key={product.id} product={product} />)}
        </div>
      )}

      <div className="flex justify-between text-sm">
        {query.cursor ? <Link href={href({})} className="underline">← Back to the start</Link> : <span />}
        {pagination.nextCursor && <Link href={href({ cursor: pagination.nextCursor })} className="underline">Next page →</Link>}
      </div>
    </>
  );
}

function ResultsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4" aria-hidden>
      {Array.from({ length: 8 }, (_, i) => <div key={i} className="aspect-[3/4] animate-pulse rounded-lg bg-zinc-200" />)}
    </div>
  );
}
