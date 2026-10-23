"use client";

import { Check, CircleCheck, ImageOff, MapPin, Pencil, Plus, ShieldCheck, ShoppingCart } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AddressForm } from "@/components/address-form";
import { useAuth } from "@/components/auth-provider";
import { useCartCount } from "@/components/cart-provider";
import { EmptyState } from "@/components/empty-state";
import { PayButton } from "@/components/pay-button";
import { Button, buttonStyles } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/card";
import { ApiRequestError, api } from "@/lib/client-api";
import { cn } from "@/lib/cn";
import { dateTime, rupees } from "@/lib/format";
import type { Address, Cart, Order } from "@/lib/types";

const STEPS = ["Address", "Review", "Payment"] as const;

// Checkout in three clear steps. Splitting it up means each screen asks ONE thing, and the
// progress bar shows how close the shopper is to done (long single forms get abandoned).
//   1. Address: where should it go?
//   2. Review: everything at a glance, then "Place order" (this creates the order and
//      reserves the stock)
//   3. Payment: Razorpay
export function CheckoutView() {
  const { status } = useAuth();
  const { refresh: refreshCartCount } = useCartCount();
  const router = useRouter();
  const coupon = useSearchParams().get("coupon") || null;

  const [cart, setCart] = useState<Cart | null>(null);
  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [addingAddress, setAddingAddress] = useState(false);
  const [step, setStep] = useState<"address" | "review">("address");
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);

  // One Idempotency-Key per checkout attempt: if the request is sent twice (a double click,
  // a flaky connection retrying), the API places ONE order and answers both with it.
  // After a definite answer (like "out of stock"), the next attempt is a NEW action: new key.
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  useEffect(() => {
    if (status !== "signed-in") {
      return;
    }
    let cancelled = false;
    Promise.all([
      api<{ data: Cart }>(`/cart${coupon ? `?coupon=${encodeURIComponent(coupon)}` : ""}`),
      api<{ data: Address[] }>("/addresses"),
    ]).then(
      ([cartRes, addressRes]) => {
        if (cancelled) return;
        setCart(cartRes.data);
        setAddresses(addressRes.data);
        // The default address comes first in the list
        setAddressId(addressRes.data[0]?.id ?? null);
        setAddingAddress(addressRes.data.length === 0);
      },
      (err) => {
        if (!cancelled) setError(err instanceof ApiRequestError ? err.message : "Couldn't load your checkout");
      }
    );
    return () => {
      cancelled = true;
    };
  }, [status, coupon]);

  const placeOrder = async () => {
    setPlacing(true);
    setError(null);
    try {
      const { data } = await api<{ data: Order }>("/orders", {
        method: "POST",
        body: { addressId, ...(cart?.coupon && { couponCode: cart.coupon.code }) },
        headers: { "Idempotency-Key": idempotencyKey.current },
      });
      setOrder(data);
      // Placing the order emptied the cart: the header's count follows
      void refreshCartCount();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        idempotencyKey.current = crypto.randomUUID();
        setError(err.fieldErrors.length > 0 ? err.fieldErrors.map((e) => e.message).join(". ") : err.message);
      } else {
        // No answer at all (network): keep the key, so pressing again can't make a 2nd order
        setError("Couldn't reach the shop. Check your connection and press again: you won't be charged twice");
      }
    } finally {
      setPlacing(false);
    }
  };

  if (status === "guest") {
    return (
      <EmptyState icon={ShoppingCart} title="Log in to check out">
        <Link href="/login?next=/checkout" className={buttonStyles()}>Log in</Link>
      </EmptyState>
    );
  }

  // ---------- Step 3: the order exists, now the payment ----------
  if (order) {
    return (
      <div className="flex flex-col gap-8">
        <Progress current={2} />
        <Card className="mx-auto flex w-full max-w-lg flex-col items-center gap-5 p-8 text-center">
          <CircleCheck className="size-14 text-success" aria-hidden />
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold">Order {order.orderNumber} placed</h2>
            <p className="text-muted">
              Your items are reserved. Pay {rupees(order.totalAmount)} now
              {order.expiresAt && <>, or before {dateTime(order.expiresAt)}</>} to confirm it.
            </p>
          </div>
          {/* Paid: back to the home page, which thanks the customer (see PaymentSuccessBanner) */}
          <PayButton orderId={order.id} size="lg" className="w-full" label={`Pay ${rupees(order.totalAmount)}`} onPaid={() => router.push(`/?paid=${order.orderNumber}`)} />
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <ShieldCheck className="size-3.5" aria-hidden /> UPI, cards and netbanking, secured by Razorpay
          </p>
          <Link href={`/orders/${order.id}`} className="text-sm text-muted underline hover:text-fg">Pay later from Your orders</Link>
        </Card>
      </div>
    );
  }

  if (!cart || !addresses) {
    return error ? <p role="alert" className="text-danger">{error}</p> : <div className="flex flex-col gap-6"><Skeleton className="h-10" /><Skeleton className="h-72" /></div>;
  }

  if (cart.items.length === 0) {
    return (
      <EmptyState icon={ShoppingCart} title="Your cart is empty" text="Add something to your cart, then come back to check out.">
        <Link href="/products" className={buttonStyles()}>Start shopping</Link>
      </EmptyState>
    );
  }

  const address = addresses.find((a) => a.id === addressId);

  return (
    <div className="flex flex-col gap-8">
      <Progress current={step === "address" ? 0 : 1} />

      <div className="grid items-start gap-8 lg:grid-cols-[1fr_22rem]">
        {step === "address" ? (
          // ---------- Step 1: where should it go? ----------
          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">Where should we deliver?</h2>
            {addresses.length > 0 && (
              <fieldset className="grid gap-3 sm:grid-cols-2">
                <legend className="sr-only">Choose an address</legend>
                {addresses.map((a) => (
                  // A whole card is the radio button's label: a big, easy target to tap
                  <label key={a.id} className="relative flex cursor-pointer flex-col gap-1 rounded-2xl border border-line bg-surface p-4 text-sm transition hover:border-line-strong has-[:checked]:border-brand has-[:checked]:ring-2 has-[:checked]:ring-brand/20">
                    <input type="radio" name="address" value={a.id} checked={a.id === addressId} onChange={() => setAddressId(a.id)} className="peer sr-only" />
                    <span className="absolute top-3 right-3 hidden size-5 items-center justify-center rounded-full bg-brand text-brand-fg peer-checked:flex">
                      <Check className="size-3.5" aria-hidden />
                    </span>
                    <span className="font-medium">{a.fullName}{a.label && <span className="font-normal text-muted"> · {a.label}</span>}</span>
                    <span className="text-muted">{a.line1}{a.line2 && `, ${a.line2}`}</span>
                    <span className="text-muted">{a.city}, {a.state} {a.postalCode}</span>
                    <span className="text-muted">{a.phone}</span>
                  </label>
                ))}
              </fieldset>
            )}
            {addingAddress ? (
              <Card className="p-5">
                <AddressForm
                  onSaved={(saved) => {
                    setAddresses([...addresses, saved]);
                    setAddressId(saved.id);
                    setAddingAddress(false);
                  }}
                  onCancel={addresses.length > 0 ? () => setAddingAddress(false) : undefined}
                />
              </Card>
            ) : (
              <Button variant="secondary" onClick={() => setAddingAddress(true)} className="self-start">
                <Plus className="size-4" aria-hidden /> Add a new address
              </Button>
            )}
            <Button size="lg" disabled={!addressId || addingAddress} onClick={() => setStep("review")} className="self-start">
              Continue to review
            </Button>
          </section>
        ) : (
          // ---------- Step 2: everything at a glance ----------
          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">Review your order</h2>
            {address && (
              <Card className="flex items-start gap-3 p-4 text-sm">
                <MapPin className="mt-0.5 size-5 shrink-0 text-brand-text" aria-hidden />
                <div className="flex-1">
                  <p className="font-medium">Delivering to {address.fullName}</p>
                  <p className="text-muted">{address.line1}{address.line2 && `, ${address.line2}`}, {address.city}, {address.state} {address.postalCode} · {address.phone}</p>
                </div>
                <button type="button" onClick={() => setStep("address")} className="flex items-center gap-1 text-brand-text hover:underline">
                  <Pencil className="size-3.5" aria-hidden /> Change
                </button>
              </Card>
            )}
            <Card>
              <ul className="divide-y divide-line">
                {cart.items.map((item) => (
                  <li key={item.variantId} className="flex items-center gap-4 p-4 text-sm">
                    <span className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-subtle">
                      {item.imageUrl
                        ? <Image src={item.imageUrl} alt="" fill sizes="56px" className="object-cover" />
                        : <span className="flex h-full items-center justify-center text-faint"><ImageOff className="size-5" aria-hidden /></span>}
                    </span>
                    <span className="flex-1">
                      <span className="font-medium">{item.name}</span>
                      {item.optionsLabel && <span className="block text-muted">{item.optionsLabel}</span>}
                      <span className="block text-muted">Qty {item.quantity}</span>
                    </span>
                    <span className="font-medium">{rupees(item.lineTotal)}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Link href="/cart" className="self-start text-sm text-brand-text hover:underline">Edit cart</Link>
          </section>
        )}

        {/* The summary is beside every step (below it on phones) */}
        <Card className="flex flex-col gap-4 p-5 lg:sticky lg:top-24">
          <h2 className="text-lg font-semibold">Order summary</h2>
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Items ({cart.totalQuantity})</dt><dd>{rupees(cart.subtotal)}</dd></div>
            {cart.coupon && <div className="flex justify-between text-success"><dt>Coupon {cart.coupon.code}</dt><dd>−{rupees(cart.discount)}</dd></div>}
            <div className="flex items-baseline justify-between border-t border-line pt-3"><dt className="font-medium">Total</dt><dd className="text-xl font-semibold">{rupees(cart.total)}</dd></div>
          </dl>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          {step === "review" ? (
            <Button size="lg" onClick={placeOrder} loading={placing}>
              {placing ? "Placing your order…" : `Place order · ${rupees(cart.total)}`}
            </Button>
          ) : (
            <p className="text-xs text-muted">Choose an address, then review your order before paying.</p>
          )}
          <p className="flex items-center justify-center gap-1.5 text-xs text-muted">
            <ShieldCheck className="size-3.5" aria-hidden /> Secure payment with Razorpay
          </p>
        </Card>
      </div>
    </div>
  );
}

// 1 ── 2 ── 3, with the finished steps ticked
function Progress({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2 sm:gap-4" aria-label="Checkout progress">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex flex-1 items-center gap-2 sm:gap-4 last:flex-none" aria-current={active ? "step" : undefined}>
            <span className="flex items-center gap-2">
              <span className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                done ? "bg-brand text-brand-fg" : active ? "border-2 border-brand text-brand-text" : "border border-line-strong text-muted",
              )}>
                {done ? <Check className="size-4" aria-hidden /> : i + 1}
              </span>
              <span className={cn("text-sm", active ? "font-medium" : "text-muted", !active && "hidden sm:inline")}>{label}</span>
            </span>
            {i < STEPS.length - 1 && <span className={cn("h-0.5 flex-1 rounded-full", done ? "bg-brand" : "bg-line")} aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
