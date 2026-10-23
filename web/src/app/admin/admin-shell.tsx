"use client";

import { ArrowLeft, LayoutDashboard, Package, ShieldAlert, ShoppingBag, TicketPercent, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";
import { EmptyState } from "@/components/empty-state";
import { buttonStyles } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/card";

const SECTIONS: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/orders", label: "Orders", icon: ShoppingBag },
  { href: "/admin/products", label: "Products", icon: Package },
  { href: "/admin/coupons", label: "Coupons", icon: TicketPercent },
];

// Who may see the admin pages is decided HERE only for convenience: hiding screens a customer
// can't use. The real protection is the API, which checks the token's role (and 2FA, when
// REQUIRE_ADMIN_2FA is on) on every admin request. Anyone can edit the JavaScript in their
// own browser, so a check in the browser alone would protect nothing.
export function AdminShell({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();

  if (status === "loading") {
    return <Skeleton className="h-60" />;
  }
  if (status === "guest") {
    return (
      <EmptyState icon={ShieldAlert} title="Admins only" text="Log in with an admin account to manage the shop.">
        <Link href="/login?next=/admin" className={buttonStyles()}>Log in</Link>
      </EmptyState>
    );
  }
  if (user.role !== "admin") {
    return (
      <EmptyState icon={ShieldAlert} title="This area is for shop admins">
        <Link href="/" className={buttonStyles({ variant: "secondary" })}>Back to the shop</Link>
      </EmptyState>
    );
  }

  return (
    // minmax(0, 1fr): lets wide tables scroll inside their card instead of widening the page
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-24">
        <div className="hidden items-center gap-2 px-3 lg:flex">
          <span className="rounded-md bg-brand px-1.5 py-0.5 text-xs font-semibold text-brand-fg">ADMIN</span>
          <span className="text-sm text-muted">Shop manager</span>
        </div>
        {/* The menu reads the URL (to highlight the current section). On a page like
            /admin/orders/[id] the URL is only known when someone visits, so with Cache
            Components that part must be inside <Suspense>; the fallback is the same menu,
            without the highlight. */}
        <Suspense fallback={<AdminNav pathname={null} />}>
          <CurrentAdminNav />
        </Suspense>
        <Link href="/" className="hidden items-center gap-2 px-3 text-sm text-muted hover:text-fg lg:flex">
          <ArrowLeft className="size-4" aria-hidden /> Back to the shop
        </Link>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function CurrentAdminNav() {
  return <AdminNav pathname={usePathname()} />;
}

function AdminNav({ pathname }: { pathname: string | null }) {
  // /admin/orders/123 belongs to "Orders"; "/admin" itself only matches exactly
  const isActive = (href: string) => pathname !== null && (href === "/admin" ? pathname === href : pathname.startsWith(href));

  return (
    <nav aria-label="Admin" className="relative -mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
      <ul className="flex gap-1 lg:flex-col">
        {SECTIONS.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              aria-current={isActive(href) ? "page" : undefined}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm whitespace-nowrap text-muted transition hover:bg-subtle hover:text-fg aria-[current=page]:bg-brand-soft aria-[current=page]:font-medium aria-[current=page]:text-brand-text"
            >
              <Icon className="size-4" aria-hidden /> {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
