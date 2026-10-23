import { Search, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { getCategories } from "@/lib/catalog";
import { site } from "@/lib/site";
import { AccountMenu } from "./account-menu";
import { MobileMenu } from "./mobile-menu";

// A Server Component: the categories come from the cached catalog, so the header is part of
// the prerendered HTML. Only the parts that depend on WHO is visiting (cart count, account
// menu) and the mobile drawer are Client Components inside it.
export async function SiteHeader() {
  const categories = await getCategories();

  return (
    // sticky + a translucent background with blur: the header stays reachable while scrolling,
    // and the page shows faintly through it
    <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
        <MobileMenu categories={categories} />

        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-brand-fg">
            <ShoppingBag className="size-4.5" aria-hidden />
          </span>
          <span className="text-lg">{site.name}</span>
        </Link>

        {/* Links never wrap onto two lines: when the header is crowded, the search box shrinks instead */}
        <nav aria-label="Categories" className="ml-4 hidden shrink-0 items-center gap-1 text-sm whitespace-nowrap md:flex">
          <Link href="/products" className="rounded-lg px-3 py-2 text-muted hover:bg-subtle hover:text-fg">All products</Link>
          {categories.slice(0, 4).map((c) => (
            <Link key={c.id} href={`/products?category=${c.id}`} className="rounded-lg px-3 py-2 text-muted hover:bg-subtle hover:text-fg">
              {c.name}
            </Link>
          ))}
        </nav>

        <SearchBox className="ml-auto hidden w-full max-w-xs min-w-40 lg:block" />

        <div className="ml-auto shrink-0 lg:ml-0">
          <AccountMenu />
        </div>
      </div>

      {/* On phones the search gets its own full-width row: search is how most mobile shoppers navigate */}
      <div className="px-4 pb-3 lg:hidden">
        <SearchBox />
      </div>
    </header>
  );
}

// A plain HTML form (GET /products?search=...): works before any JavaScript has loaded, and the
// results page can be bookmarked or shared
function SearchBox({ className }: { className?: string }) {
  return (
    <form action="/products" role="search" className={className}>
      <label className="relative block">
        <span className="sr-only">Search products</span>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" aria-hidden />
        <input
          type="search"
          name="search"
          placeholder="Search products…"
          className="h-10 w-full rounded-full border border-line bg-subtle pr-4 pl-9 text-sm outline-none transition placeholder:text-faint focus:border-brand focus:bg-surface"
        />
      </label>
    </form>
  );
}
