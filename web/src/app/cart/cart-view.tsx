"use client";

import { ArrowRight, ShieldCheck, ShoppingCart, Tag, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth-provider";
import { CartLine } from "@/components/cart-line";
import { useCartCount } from "@/components/cart-provider";
import { EmptyState } from "@/components/empty-state";
import { inputStyles } from "@/components/form-field";
import { Button, buttonStyles } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/card";
import { ApiRequestError, api } from "@/lib/client-api";
import { rupees } from "@/lib/format";
import type { Cart } from "@/lib/types";

export function CartView() {
  const { status } = useAuth();
  const { sync } = useCartCount();
  const [cart, setCartState] = useState<Cart | null>(null);
  const [coupon, setCoupon] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);     // which item is being changed

  // Every new version of the cart also updates the count on the header's cart icon
  const setCart = useCallback((next: Cart) => {
    setCartState(next);
    sync(next);
  }, [sync]);

  // GET /cart, with ?coupon= to preview a discount (nothing is reserved until checkout)
  const load = useCallback(async (code: string | null) => {
    const query = code ? `?coupon=${encodeURIComponent(code)}` : "";
    const res = await api<{ data: Cart }>(`/cart${query}`);
    setCart(res.data);
  }, [setCart]);

  // Load the cart once we know who's logged in. "cancelled": if the user leaves the page
  // before the answer arrives, it's ignored instead of updating a page that's gone.
  useEffect(() => {
    if (status !== "signed-in") {
      return;
    }
    let cancelled = false;
    api<{ data: Cart }>("/cart").then(
      (res) => { if (!cancelled) setCart(res.data); },
      () => { if (!cancelled) setError("Couldn't load your cart"); }
    );
    return () => {
      cancelled = true;
    };
  }, [status, setCart]);

  // Every change answers with the updated cart; show the API's reason when it says no
  const change = async (variantId: string, work: () => Promise<{ data: Cart }>) => {
    setBusy(variantId);
    setError(null);
    try {
      const res = await work();
      setCart(res.data);
      if (coupon) {
        // The discount depends on the new subtotal: ask again with the coupon
        await load(coupon).catch(() => setCoupon(null));
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  const applyCoupon = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("coupon")).trim();
    if (!code) return;
    setCouponError(null);
    try {
      await load(code);
      setCoupon(code);
    } catch (err) {
      setCouponError(err instanceof ApiRequestError ? (err.fieldErrors[0]?.message ?? err.message) : "Couldn't apply that coupon");
    }
  };

  const removeCoupon = async () => {
    setCoupon(null);
    setCouponError(null);
    await load(null).catch(() => undefined);
  };

  if (status === "loading" || (status === "signed-in" && !cart && !error)) {
    return (
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (status === "guest") {
    return (
      <EmptyState icon={ShoppingCart} title="Log in to see your cart" text="Your cart is saved to your account, so it follows you on every device.">
        <Link href="/login?next=/cart" className={buttonStyles()}>Log in</Link>
      </EmptyState>
    );
  }
  if (!cart || cart.items.length === 0) {
    return (
      <>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <EmptyState icon={ShoppingCart} title="Your cart is empty" text="Find something you like and it will show up here.">
          <Link href="/products" className={buttonStyles()}>Start shopping</Link>
        </EmptyState>
      </>
    );
  }

  const checkoutHref = cart.coupon ? `/checkout?coupon=${encodeURIComponent(cart.coupon.code)}` : "/checkout";

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[1fr_22rem]">
      <Card>
        <ul className="divide-y divide-line">
          {cart.items.map((item) => (
            <CartLine
              key={item.variantId}
              item={item}
              busy={busy === item.variantId}
              onQuantity={(quantity) => change(item.variantId, () => api(`/cart/items/${item.variantId}`, { method: "PATCH", body: { quantity } }))}
              onRemove={() => change(item.variantId, () => api(`/cart/items/${item.variantId}`, { method: "DELETE" }))}
            />
          ))}
        </ul>
        {error && <p role="alert" className="border-t border-line p-4 text-sm text-danger">{error}</p>}
      </Card>

      {/* Sticky on big screens: the total and the Checkout button stay in view while scrolling */}
      <Card className="flex flex-col gap-4 p-5 lg:sticky lg:top-24">
        <h2 className="text-lg font-semibold">Order summary</h2>

        {cart.coupon ? (
          <div className="flex items-center justify-between rounded-lg border border-dashed border-success/50 bg-success-soft px-3 py-2 text-sm">
            <span className="flex items-center gap-2 text-success">
              <Tag className="size-4" aria-hidden />
              <span><strong>{cart.coupon.code}</strong> applied</span>
            </span>
            <button type="button" onClick={removeCoupon} aria-label={`Remove coupon ${cart.coupon.code}`} className="rounded p-1 text-muted hover:bg-surface">
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ) : (
          <form onSubmit={applyCoupon} className="flex flex-col gap-1.5">
            <div className="flex gap-2">
              <input name="coupon" placeholder="Coupon code" aria-label="Coupon code" autoCapitalize="characters" className={`${inputStyles} uppercase placeholder:normal-case`} />
              <Button type="submit" variant="secondary">Apply</Button>
            </div>
            {couponError && <p role="alert" className="text-sm text-danger">{couponError}</p>}
          </form>
        )}

        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between"><dt className="text-muted">Subtotal ({cart.totalQuantity} item{cart.totalQuantity === 1 ? "" : "s"})</dt><dd>{rupees(cart.subtotal)}</dd></div>
          {cart.coupon && <div className="flex justify-between text-success"><dt>Discount</dt><dd>−{rupees(cart.discount)}</dd></div>}
          <div className="flex items-baseline justify-between border-t border-line pt-3"><dt className="font-medium">Total</dt><dd className="text-xl font-semibold">{rupees(cart.total)}</dd></div>
        </dl>

        <Link href={checkoutHref} className={buttonStyles({ size: "lg" })}>
          Checkout <ArrowRight className="size-4" aria-hidden />
        </Link>
        <p className="flex items-center justify-center gap-1.5 text-xs text-muted">
          <ShieldCheck className="size-3.5" aria-hidden /> Secure payment with Razorpay
        </p>
      </Card>
    </div>
  );
}
