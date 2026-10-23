"use client";

import { CircleCheck, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { buttonStyles } from "./ui/button";

// Shown on the home page after a successful checkout (/?paid=ORD-7K3M9Q)
export function PaymentSuccessBanner() {
  const orderNumber = useSearchParams().get("paid");
  const router = useRouter();

  // Only order-number-looking values: the URL is something anyone can type
  if (!orderNumber || !/^ORD-[A-Z0-9]{6}$/.test(orderNumber)) {
    return null;
  }

  return (
    <div role="status" className="relative flex flex-col gap-4 rounded-2xl border border-success/25 bg-success-soft p-5 sm:flex-row sm:items-center">
      <CircleCheck className="size-10 shrink-0 text-success" aria-hidden />
      <div className="flex-1">
        <p className="font-semibold">Thank you! Your payment was received.</p>
        <p className="text-sm text-muted">Order {orderNumber} is confirmed, and we&apos;ll email you when it ships.</p>
      </div>
      <Link href="/orders" className={buttonStyles({ variant: "secondary", size: "sm" })}>Track your order</Link>
      <button type="button" onClick={() => router.replace("/")} aria-label="Dismiss" className="absolute top-2 right-2 rounded-lg p-1.5 text-muted hover:bg-surface/60 sm:static">
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
