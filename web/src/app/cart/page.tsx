import { CartView } from "./cart-view";

export const metadata = { title: "Your cart" };

export default function CartPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Your cart</h1>
      <CartView />
    </div>
  );
}
