"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth-provider";
import { ApiRequestError, api } from "@/lib/client-api";
import { rupees } from "@/lib/format";
import type { Cart } from "@/lib/types";

export function CartView() {
  const { status } = useAuth();
  const [cart, setCart] = useState<Cart | null>(null);
  const [coupon, setCoupon] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // GET /cart, with ?coupon= to preview a discount (nothing is reserved until checkout)
  const load = useCallback(async (code: string | null) => {
    const query = code ? `?coupon=${encodeURIComponent(code)}` : "";
    const res = await api<{ data: Cart }>(`/cart${query}`);
    setCart(res.data);
  }, []);

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
  }, [status]);

  // Every change answers with the updated cart; show the API's reason when it says no
  const change = async (work: () => Promise<{ data: Cart }>) => {
    setError(null);
    try {
      const res = await work();
      setCart(res.data);
      if (coupon) {
        await load(coupon).catch(() => setCoupon(null));
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Something went wrong");
    }
  };

  const applyCoupon = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("coupon")).trim();
    setError(null);
    try {
      await load(code);
      setCoupon(code);
    } catch (err) {
      setError(err instanceof ApiRequestError ? (err.fieldErrors[0]?.message ?? err.message) : "Couldn't apply that coupon");
    }
  };

  if (status === "loading" || (status === "signed-in" && !cart && !error)) {
    return <div className="h-40 animate-pulse rounded-lg bg-zinc-200" />;
  }
  if (status === "guest") {
    return (
      <p className="text-zinc-600">
        <Link href="/login?next=/cart" className="underline">Log in</Link> to see your cart.
      </p>
    );
  }
  if (!cart || cart.items.length === 0) {
    return (
      <>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <p className="text-zinc-600">Your cart is empty. <Link href="/products" className="underline">Start shopping</Link></p>
      </>
    );
  }

  return (
    <div className="grid gap-8 md:grid-cols-[1fr_18rem]">
      <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white">
        {cart.items.map((item) => (
          <li key={item.variantId} className="flex items-center gap-4 p-4">
            <div className="flex-1">
              <Link href={`/products/${item.slug}`} className="font-medium hover:underline">{item.name}</Link>
              {item.optionsLabel && <p className="text-sm text-zinc-500">{item.optionsLabel}</p>}
              <p className="text-sm text-zinc-500">{rupees(item.price)} each</p>
            </div>
            <input
              type="number"
              min={1}
              max={item.stock}
              defaultValue={item.quantity}
              aria-label={`Quantity of ${item.name}`}
              onBlur={(e) => {
                const quantity = Number(e.target.value);
                if (quantity !== item.quantity && quantity >= 1) {
                  void change(() => api(`/cart/items/${item.variantId}`, { method: "PATCH", body: { quantity } }));
                }
              }}
              className="w-16 rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
            />
            <p className="w-20 text-right font-medium">{rupees(item.lineTotal)}</p>
            <button
              type="button"
              onClick={() => change(() => api(`/cart/items/${item.variantId}`, { method: "DELETE" }))}
              className="text-sm text-zinc-500 hover:text-red-600"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      <aside className="flex h-fit flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <div className="flex justify-between"><span>Subtotal</span><span>{rupees(cart.subtotal)}</span></div>
        {cart.coupon && (
          <div className="flex justify-between text-green-700"><span>Coupon {cart.coupon.code}</span><span>−{rupees(cart.discount)}</span></div>
        )}
        <div className="flex justify-between border-t border-zinc-200 pt-3 text-base font-semibold"><span>Total</span><span>{rupees(cart.total)}</span></div>

        <form onSubmit={applyCoupon} className="flex gap-2">
          <input name="coupon" placeholder="Coupon code" defaultValue={coupon ?? ""} className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2 py-1.5 uppercase" />
          <button className="rounded-md border border-zinc-300 px-3 hover:bg-zinc-100">Apply</button>
        </form>

        {error && <p role="alert" className="text-red-600">{error}</p>}

        <button type="button" disabled className="rounded-md bg-zinc-900 py-2 font-medium text-white opacity-50" title="Coming in the next step">
          Checkout (coming next)
        </button>
      </aside>
    </div>
  );
}
