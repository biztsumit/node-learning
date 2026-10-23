"use client";

import { ShieldCheck, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiRequestError, api } from "@/lib/client-api";
import { rupees } from "@/lib/format";
import type { Cart } from "@/lib/types";
import { CartLine } from "./cart-line";
import { useCartCount } from "./cart-provider";
import { EmptyState } from "./empty-state";
import { buttonStyles } from "./ui/button";
import { Skeleton } from "./ui/card";
import { Drawer } from "./ui/drawer";

// The cart sliding in from the right after "Add to cart": the shopper sees what they have,
// and can keep browsing or go to checkout, without leaving the page they were on
export function CartDrawer() {
  const { drawerOpen, closeDrawer, sync } = useCartCount();
  const [cart, setCart] = useState<Cart | null>(null);
  const [busy, setBusy] = useState<string | null>(null);   // which item is being changed
  const [error, setError] = useState<string | null>(null);

  // Read the cart each time the drawer opens: it was probably just changed
  useEffect(() => {
    if (!drawerOpen) return;
    let cancelled = false;
    api<{ data: Cart }>("/cart").then(
      (res) => { if (!cancelled) { setCart(res.data); setError(null); } },
      () => { if (!cancelled) setError("Couldn't load your cart"); },
    );
    return () => {
      cancelled = true;
    };
  }, [drawerOpen]);

  const change = async (variantId: string, work: () => Promise<{ data: Cart }>) => {
    setBusy(variantId);
    setError(null);
    try {
      const res = await work();
      setCart(res.data);
      sync(res.data);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Drawer open={drawerOpen} onClose={closeDrawer} title={cart ? `Your cart (${cart.totalQuantity})` : "Your cart"} side="right">
      {!cart ? (
        error ? <p role="alert" className="p-4 text-danger">{error}</p> : <div className="flex flex-col gap-3 p-4"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
      ) : cart.items.length === 0 ? (
        <div className="p-4">
          <EmptyState icon={ShoppingCart} title="Your cart is empty">
            <Link href="/products" onClick={closeDrawer} className={buttonStyles()}>Browse products</Link>
          </EmptyState>
        </div>
      ) : (
        <div className="flex h-full flex-col">
          <ul className="flex-1 divide-y divide-line overflow-y-auto px-4">
            {cart.items.map((item) => (
              <CartLine
                key={item.variantId}
                item={item}
                compact
                busy={busy === item.variantId}
                onNavigate={closeDrawer}
                onQuantity={(quantity) => change(item.variantId, () => api(`/cart/items/${item.variantId}`, { method: "PATCH", body: { quantity } }))}
                onRemove={() => change(item.variantId, () => api(`/cart/items/${item.variantId}`, { method: "DELETE" }))}
              />
            ))}
          </ul>

          {/* The footer stays put at the bottom while the list scrolls */}
          <div className="flex flex-col gap-3 border-t border-line bg-surface p-4">
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <div className="flex items-center justify-between">
              <span className="text-muted">Subtotal</span>
              <span className="text-lg font-semibold">{rupees(cart.subtotal)}</span>
            </div>
            <p className="text-xs text-muted">Coupons can be added in your cart.</p>
            <Link href="/checkout" onClick={closeDrawer} className={buttonStyles({ size: "lg" })}>Checkout</Link>
            <Link href="/cart" onClick={closeDrawer} className={buttonStyles({ variant: "secondary" })}>View cart</Link>
            <p className="flex items-center justify-center gap-1.5 text-xs text-muted">
              <ShieldCheck className="size-3.5" aria-hidden /> Secure payment with Razorpay
            </p>
          </div>
        </div>
      )}
    </Drawer>
  );
}
