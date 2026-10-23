import { Search } from "lucide-react";
import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";

export const metadata = { title: "Page not found" };

// Shown for any URL that doesn't exist, and when a page calls notFound() (e.g. a product that
// was deleted). A dead end loses the shopper, so it offers a search and a way back.
export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-6 py-12 text-center">
      <p className="text-7xl font-semibold tracking-tight text-brand-text">404</p>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">We couldn&apos;t find that page</h1>
        <p className="text-muted">The link may be old, or the product is no longer sold. Try a search instead:</p>
      </div>
      <form action="/products" role="search" className="w-full">
        <label className="relative block">
          <span className="sr-only">Search products</span>
          <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-faint" aria-hidden />
          <input type="search" name="search" placeholder="Search products…" className="h-12 w-full rounded-full border border-line-strong bg-surface pr-4 pl-12 outline-none focus:border-brand focus:ring-3 focus:ring-brand/15" />
        </label>
      </form>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/" className={buttonStyles()}>Go to the home page</Link>
        <Link href="/products" className={buttonStyles({ variant: "secondary" })}>Browse all products</Link>
      </div>
    </div>
  );
}
