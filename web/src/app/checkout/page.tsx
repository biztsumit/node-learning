import { Suspense } from "react";
import { Skeleton } from "@/components/ui/card";
import { CheckoutView } from "./checkout-view";

export const metadata = { title: "Checkout" };

// The checkout reads ?coupon= from the URL (request-time data), so it sits in <Suspense>
export default function CheckoutPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Checkout</h1>
      <Suspense fallback={<Skeleton className="h-72" />}>
        <CheckoutView />
      </Suspense>
    </div>
  );
}
