import { AdminOrdersList } from "./admin-orders-list";

export const metadata = { title: "Orders" };

export default function AdminOrdersPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Orders</h1>
      <AdminOrdersList />
    </div>
  );
}
