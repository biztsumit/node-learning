"use client";

import { Heart, MapPin, Package, ShieldCheck, User, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useAuth } from "./auth-provider";

const SECTIONS: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/account", label: "Profile", icon: User },
  { href: "/account/addresses", label: "Addresses", icon: MapPin },
  { href: "/account/security", label: "Security", icon: ShieldCheck },
  { href: "/orders", label: "Orders", icon: Package },
  { href: "/wishlist", label: "Wishlist", icon: Heart },
];

// The frame around every "your stuff" page: a side menu on big screens, a row of tabs on
// phones. Used by the /account pages AND by /orders and /wishlist (which keep their own URLs:
// payment and emails link to /orders), so the shopper always sees one consistent account area.
export function AccountShell({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();

  // Guests get each page's own "Log in to…" message, without a menu of pages they can't use
  if (status !== "signed-in") {
    return <>{children}</>;
  }

  return (
    // minmax(0, 1fr): grid columns normally refuse to shrink below their content, so on a phone
    // the row of tabs would stretch the whole PAGE sideways instead of scrolling by itself
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-24">
        <div className="hidden items-center gap-3 lg:flex">
          <span className="flex size-11 items-center justify-center rounded-full bg-brand-soft text-lg font-semibold text-brand-text" aria-hidden>
            {user.name.trim().charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold">{user.name}</p>
            <p className="truncate text-sm text-muted">{user.email}</p>
          </div>
        </div>
        {/* The menu highlights the current page, which means reading the URL: inside
            <Suspense> because /orders/[id] is only known when someone visits */}
        <Suspense fallback={<AccountNav pathname={null} />}>
          <CurrentAccountNav />
        </Suspense>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function CurrentAccountNav() {
  return <AccountNav pathname={usePathname()} />;
}

function AccountNav({ pathname }: { pathname: string | null }) {
  // "/account" only matches itself; the others also match their sub-pages (/orders/123)
  const isActive = (href: string) => pathname !== null && (href === "/account" ? pathname === href : pathname.startsWith(href));

  return (
    <nav aria-label="Account menu" className="relative -mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
      <ul className="flex gap-1 lg:flex-col">
        {SECTIONS.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              aria-current={isActive(href) ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition",
                "text-muted hover:bg-subtle hover:text-fg",
                "aria-[current=page]:bg-brand-soft aria-[current=page]:font-medium aria-[current=page]:text-brand-text",
              )}
            >
              <Icon className="size-4" aria-hidden /> {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// A titled card for one part of a page ("Change your password", "Two-factor login")
export function AccountCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

// Shows `children` only to a logged-in shopper: a skeleton while we find out, a log-in
// prompt for guests (who come back to this page afterwards)
export function RequireLogin({ next, children }: { next: string; children: ReactNode }) {
  const { status } = useAuth();
  if (status === "loading") {
    return <div className="h-60 animate-pulse rounded-2xl bg-subtle" />;
  }
  if (status === "guest") {
    return (
      <p className="text-muted">
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-medium text-brand-text underline">Log in</Link> to manage your account.
      </p>
    );
  }
  return <>{children}</>;
}
