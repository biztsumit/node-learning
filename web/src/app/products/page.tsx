import { Check, ChevronLeft, ChevronRight, SearchX, X } from "lucide-react";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { EmptyState } from "@/components/empty-state";
import { inputStyles } from "@/components/form-field";
import { ProductCard, ProductGrid, ProductGridSkeleton } from "@/components/product-card";
import { Button, buttonStyles } from "@/components/ui/button";
import { getCategories, getProducts, type ProductQuery } from "@/lib/catalog";
import { cn } from "@/lib/cn";
import { rupees } from "@/lib/format";
import { SORTS } from "@/lib/sorts";
import { FilterDrawer, SortSelect } from "./catalog-controls";

export const metadata = { title: "All products" };

// The URL decides what's shown (?search=…&category=…&minPrice=…&sort=…). searchParams is only
// known at request time, so everything that reads it sits inside <Suspense>.
//
// Why the URL and not React state? A filtered page can be bookmarked, shared, opened in a new
// tab, and "Back" undoes the last filter. And the filters are plain links and a GET form, so
// they work even before any JavaScript has loaded.
export default function ProductsPage({ searchParams }: PageProps<"/products">) {
  return (
    <Suspense fallback={<CatalogSkeleton />}>
      <Catalog searchParams={searchParams} />
    </Suspense>
  );
}

type Filters = Required<Pick<ProductQuery, "search" | "category" | "sort" | "minPrice" | "maxPrice" | "inStock" | "cursor">>;
const KEYS = ["search", "category", "sort", "minPrice", "maxPrice", "inStock", "cursor"] as const;

const pick = (value: string | string[] | undefined): string =>
  typeof value === "string" ? value.trim() : "";

async function Catalog({ searchParams }: Pick<PageProps<"/products">, "searchParams">) {
  const raw = await searchParams;
  const filters = Object.fromEntries(KEYS.map((key) => [key, pick(raw[key])])) as Filters;
  // Only whole, non-negative prices; anything else is ignored rather than breaking the page
  for (const key of ["minPrice", "maxPrice"] as const) {
    if (!/^\d{1,9}$/.test(filters[key])) filters[key] = "";
  }
  if (filters.inStock !== "true") filters.inStock = "";
  // Typed the wrong way round (min 5000, max 500)? Swap them rather than show an error
  if (filters.minPrice && filters.maxPrice && +filters.minPrice > +filters.maxPrice) {
    [filters.minPrice, filters.maxPrice] = [filters.maxPrice, filters.minPrice];
  }

  const [{ products, pagination }, categories] = await Promise.all([
    getProducts({ ...filters, limit: 12 }),
    getCategories(),
  ]);

  // A link to this page with some filters changed. Changing a filter starts again at page 1.
  const href = (changes: Partial<Filters>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...filters, cursor: "", ...changes })) {
      if (value) params.set(key, value);
    }
    const query = params.toString();
    return query ? `/products?${query}` : "/products";
  };

  const category = categories.find((c) => c.id === filters.category);
  const title = filters.search ? `Results for “${filters.search}”` : (category?.name ?? "All products");

  // The filters in use, each as a chip that removes it
  const chips = [
    filters.search && { label: `“${filters.search}”`, href: href({ search: "" }) },
    category && { label: category.name, href: href({ category: "" }) },
    (filters.minPrice || filters.maxPrice) && {
      label: filters.minPrice && filters.maxPrice ? `${rupees(+filters.minPrice)} – ${rupees(+filters.maxPrice)}`
        : filters.minPrice ? `From ${rupees(+filters.minPrice)}` : `Up to ${rupees(+filters.maxPrice)}`,
      href: href({ minPrice: "", maxPrice: "" }),
    },
    filters.inStock && { label: "In stock", href: href({ inStock: "" }) },
  ].filter((chip): chip is { label: string; href: string } => Boolean(chip));

  const panel = <FilterPanel filters={filters} categories={categories} href={href} />;
  const currentParams = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <nav aria-label="Breadcrumb" className="text-sm text-muted">
          <Link href="/" className="hover:text-fg">Home</Link> <span aria-hidden>/</span>{" "}
          {category || filters.search ? <Link href="/products" className="hover:text-fg">Products</Link> : <span>Products</span>}
        </nav>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      </div>

      <div className="grid gap-8 lg:grid-cols-[15rem_1fr]">
        <aside className="hidden lg:block" aria-label="Filters">
          <div className="sticky top-24">{panel}</div>
        </aside>

        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <FilterDrawer activeCount={chips.length}>{panel}</FilterDrawer>
            {chips.map((chip) => (
              <Link key={chip.label} href={chip.href} aria-label={`Remove filter ${chip.label}`} className="flex h-8 items-center gap-1.5 rounded-full bg-brand-soft pr-2 pl-3 text-sm text-brand-text hover:bg-brand/15">
                {chip.label} <X className="size-3.5" aria-hidden />
              </Link>
            ))}
            {chips.length > 1 && <Link href="/products" className="text-sm text-muted underline hover:text-fg">Clear all</Link>}
            <div className="ml-auto">
              <SortSelect params={currentParams} current={SORTS.some((s) => s.value === filters.sort) ? filters.sort : ""} />
            </div>
          </div>

          {products.length === 0 ? (
            <EmptyState icon={SearchX} title="Nothing matches these filters" text="Try a different search, or remove a filter or two.">
              <Link href="/products" className={buttonStyles({ variant: "secondary" })}>See all products</Link>
            </EmptyState>
          ) : (
            <ProductGrid narrow>
              {products.map((product, i) => <ProductCard key={product.id} product={product} priority={i < 3} />)}
            </ProductGrid>
          )}

          {(filters.cursor || pagination.nextCursor) && (
            <div className="flex items-center justify-between gap-3 pt-2">
              {filters.cursor
                ? <Link href={href({})} className={buttonStyles({ variant: "secondary" })}><ChevronLeft className="size-4" aria-hidden /> Back to the start</Link>
                : <span />}
              {pagination.nextCursor && (
                <Link href={href({ cursor: pagination.nextCursor })} className={buttonStyles({ variant: "secondary" })}>
                  Next page <ChevronRight className="size-4" aria-hidden />
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterPanel({ filters, categories, href }: {
  filters: Filters;
  categories: Array<{ id: string; name: string }>;
  href: (changes: Partial<Filters>) => string;
}) {
  const option = (active: boolean) => cn(
    "flex items-center justify-between rounded-lg px-3 py-2 text-sm",
    active ? "bg-brand-soft font-medium text-brand-text" : "text-muted hover:bg-subtle hover:text-fg",
  );

  return (
    <div className="flex flex-col gap-6">
      <FilterGroup title="Category">
        <ul className="flex flex-col gap-0.5">
          <li><Link href={href({ category: "" })} className={option(!filters.category)} aria-current={!filters.category ? "true" : undefined}>All products</Link></li>
          {categories.map((c) => (
            <li key={c.id}>
              <Link href={href({ category: c.id })} className={option(filters.category === c.id)} aria-current={filters.category === c.id ? "true" : undefined}>
                {c.name} {filters.category === c.id && <Check className="size-4" aria-hidden />}
              </Link>
            </li>
          ))}
        </ul>
      </FilterGroup>

      <FilterGroup title="Price (₹)">
        {/* A plain GET form: submitting it loads /products?minPrice=…&maxPrice=… The hidden
            fields carry the other filters along, so setting a price doesn't lose them. */}
        <form action="/products" className="flex flex-col gap-3">
          {(["search", "category", "sort", "inStock"] as const).map((key) =>
            filters[key] ? <input key={key} type="hidden" name={key} value={filters[key]} /> : null)}
          <div className="flex items-center gap-2">
            <input name="minPrice" type="number" min={0} step={1} inputMode="numeric" placeholder="Min" aria-label="Minimum price" defaultValue={filters.minPrice} className={inputStyles} />
            <span className="text-faint" aria-hidden>–</span>
            <input name="maxPrice" type="number" min={0} step={1} inputMode="numeric" placeholder="Max" aria-label="Maximum price" defaultValue={filters.maxPrice} className={inputStyles} />
          </div>
          <Button type="submit" variant="secondary" size="sm">Apply price</Button>
        </form>
      </FilterGroup>

      <FilterGroup title="Availability">
        <Link href={href({ inStock: filters.inStock ? "" : "true" })} role="checkbox" aria-checked={Boolean(filters.inStock)} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-subtle">
          <span className={cn("flex size-5 items-center justify-center rounded-md border", filters.inStock ? "border-brand bg-brand text-brand-fg" : "border-line-strong bg-surface")}>
            {filters.inStock && <Check className="size-3.5" aria-hidden />}
          </span>
          In stock only
        </Link>
      </FilterGroup>
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-3 text-xs font-semibold tracking-wider text-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

function CatalogSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy>
      <div className="h-9 w-56 animate-pulse rounded-lg bg-subtle" />
      <div className="grid gap-8 lg:grid-cols-[15rem_1fr]">
        <div className="hidden flex-col gap-2 lg:flex">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-9 animate-pulse rounded-lg bg-subtle" />)}
        </div>
        <ProductGridSkeleton count={6} narrow />
      </div>
    </div>
  );
}
