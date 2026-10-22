import Link from "next/link";
import { AccountMenu } from "./account-menu";

// The search box is a plain HTML form (GET /products?search=...): it works before any
// JavaScript has loaded, and the results page can be bookmarked or shared
export function SiteHeader() {
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">Shop</Link>
        <Link href="/products" className="text-sm text-zinc-600 hover:text-zinc-900">All products</Link>
        <form action="/products" className="ml-auto hidden flex-1 sm:block sm:max-w-sm">
          <input
            type="search"
            name="search"
            placeholder="Search products…"
            aria-label="Search products"
            className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm outline-none focus:border-zinc-500"
          />
        </form>
        <div className="ml-auto sm:ml-0">
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
