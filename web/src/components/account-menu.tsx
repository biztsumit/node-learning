"use client";

import { ChevronDown, Heart, LayoutDashboard, LogOut, Package, ShoppingCart, User } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "./auth-provider";
import { useCartCount } from "./cart-provider";
import { buttonStyles } from "./ui/button";
import { useWishlist } from "./wishlist-provider";

// Right side of the header: who's logged in (decided in the browser, see AuthProvider)
export function AccountMenu() {
  const { status, user } = useAuth();

  if (status === "loading") {
    return <span className="block h-9 w-28 animate-pulse rounded-lg bg-subtle" aria-hidden />;
  }

  if (!user) {
    return (
      <div className="flex items-center gap-1">
        <Link href="/login" className={buttonStyles({ variant: "ghost", size: "sm" })}>Log in</Link>
        <Link href="/register" className={buttonStyles({ size: "sm" })}>Sign up</Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {user.role === "admin" && (
        <Link href="/admin" className={buttonStyles({ variant: "ghost", size: "sm", className: "max-sm:hidden" })}>
          <LayoutDashboard className="size-4" aria-hidden /> Admin
        </Link>
      )}
      <WishlistLink />
      <CartLink />
      <UserMenu name={user.name} isAdmin={user.role === "admin"} />
    </div>
  );
}

function WishlistLink() {
  const { items } = useWishlist();
  const count = items?.length ?? 0;
  return (
    <Link href="/wishlist" aria-label={count > 0 ? `Wishlist, ${count} saved` : "Wishlist"} className="relative hidden rounded-lg p-2 hover:bg-subtle sm:block">
      <Heart className="size-5" aria-hidden />
      {count > 0 && <CountBadge count={count} />}
    </Link>
  );
}

// The small number on the corner of an icon
function CountBadge({ count }: { count: number }) {
  return (
    <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[11px] font-semibold text-brand-fg ring-2 ring-surface">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function CartLink() {
  const { count } = useCartCount();
  return (
    // The number is part of the link's name, so a screen reader hears "Cart, 3 items"
    <Link href="/cart" aria-label={count > 0 ? `Cart, ${count} item${count === 1 ? "" : "s"}` : "Cart"} className="relative rounded-lg p-2 hover:bg-subtle">
      <ShoppingCart className="size-5" aria-hidden />
      {count > 0 && <CountBadge count={count} />}
    </Link>
  );
}

// A small dropdown: Account, Orders, Log out
function UserMenu({ name, isAdmin }: { name: string; isAdmin: boolean }) {
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Close it on a click anywhere else, or on Esc: what people expect from any menu
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(false);
  const item = "flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-subtle";

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-1.5 rounded-lg p-1.5 hover:bg-subtle"
      >
        {/* The first letter of the name, in a circle */}
        <span className="flex size-7 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand-text" aria-hidden>
          {name.trim().charAt(0).toUpperCase()}
        </span>
        <span className="sr-only">Account menu</span>
        <ChevronDown className={`size-4 text-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-56 animate-toast-in rounded-xl border border-line bg-surface p-1.5 shadow-pop">
          <p className="truncate px-3 py-2 text-sm text-muted">Signed in as <span className="font-medium text-fg">{name}</span></p>
          <div className="my-1 border-t border-line" />
          <Link role="menuitem" href="/account" onClick={close} className={item}><User className="size-4 text-muted" aria-hidden /> Your account</Link>
          <Link role="menuitem" href="/orders" onClick={close} className={item}><Package className="size-4 text-muted" aria-hidden /> Your orders</Link>
          <Link role="menuitem" href="/wishlist" onClick={close} className={item}><Heart className="size-4 text-muted" aria-hidden /> Wishlist</Link>
          {isAdmin && (
            <Link role="menuitem" href="/admin" onClick={close} className={`${item} sm:hidden`}><LayoutDashboard className="size-4 text-muted" aria-hidden /> Admin</Link>
          )}
          <div className="my-1 border-t border-line" />
          <button role="menuitem" type="button" onClick={() => { close(); void logout(); }} className={`${item} w-full text-danger`}>
            <LogOut className="size-4" aria-hidden /> Log out
          </button>
        </div>
      )}
    </div>
  );
}
