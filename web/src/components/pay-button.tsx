"use client";

import { Lock } from "lucide-react";
import { useState } from "react";
import { ApiRequestError, api } from "@/lib/client-api";
import { site } from "@/lib/site";
import { PaymentCancelled, payWithRazorpay, type PaymentResult } from "@/lib/razorpay";
import type { Order, PaymentDetails } from "@/lib/types";
import { Button } from "./ui/button";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// After Razorpay says "paid", our API must confirm it (it checks Razorpay's signature).
// That one request is the most important of the whole checkout: the money has already moved.
// So it's retried, and if it still can't get through, the API is asked to check with Razorpay
// directly (payment/sync). Only a definite "no" from the API is shown as a failure.
const confirmPayment = async (orderId: string, result: PaymentResult): Promise<Order | null> => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return (await api<{ data: Order }>(`/orders/${orderId}/payment/verify`, { method: "POST", body: result })).data;
    } catch (err) {
      // A 4xx is a real answer (e.g. a bad signature): retrying won't change it
      if (err instanceof ApiRequestError && err.status < 500) throw err;
      await wait(attempt * 1000);
    }
  }
  try {
    const { data } = await api<{ data: Order }>(`/orders/${orderId}/payment/sync`, { method: "POST" });
    return data.status === "pending" ? null : data;
  } catch {
    return null;
  }
};

// Pays for one pending order: create the Razorpay payment, open Razorpay's window, then let
// our API verify it (the order only counts as paid once the API says so)
export function PayButton({ orderId, label = "Pay now", onPaid, size = "md", className }: {
  orderId: string;
  label?: string;
  onPaid: (order: Order) => void;
  size?: "md" | "lg";
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const pay = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { data: details } = await api<{ data: PaymentDetails }>(`/orders/${orderId}/payment`, { method: "POST" });
      const result = await payWithRazorpay(details, site.name);
      const order = await confirmPayment(orderId, result);
      if (order) {
        onPaid(order);
      } else {
        // Razorpay took the payment, but we couldn't confirm it yet. The server keeps checking
        // with Razorpay by itself, so it will show as paid shortly: nothing is lost.
        setMessage("Your payment went through. We're still confirming it: it will show as paid in Your orders in a few minutes.");
      }
    } catch (err) {
      if (err instanceof PaymentCancelled) {
        setMessage("Payment cancelled. Your order is saved: you can pay any time before it expires.");
      } else if (err instanceof ApiRequestError && err.status === 503) {
        setMessage("Online payment isn't set up on this server yet. Your order is saved as unpaid.");
      } else {
        setMessage(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Button size={size} onClick={pay} loading={busy} className={className}>
        {!busy && <Lock className="size-4" aria-hidden />}
        {busy ? "Processing payment…" : label}
      </Button>
      {message && <p role="status" className="text-sm text-muted">{message}</p>}
    </div>
  );
}
