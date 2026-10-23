import { OrdersList } from "./orders-list";

export const metadata = { title: "Your orders" };

export default function OrdersPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Your orders</h1>
      <OrdersList />
    </div>
  );
}
