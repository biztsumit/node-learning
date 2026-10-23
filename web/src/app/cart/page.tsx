import Link from "next/link";
import { CartView } from "./cart-view";

export const metadata = { title: "Your cart" };

export default function CartPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Your cart</h1>
        <Link href="/products" className="text-sm font-medium text-brand-text hover:underline">Continue shopping</Link>
      </div>
      <CartView />
    </div>
  );
}
  