import { Suspense } from "react";
import { AdminOrderView } from "./admin-order-view";

export const metadata = { title: "Order" };

// params (the order id) is request-time data, so the order sits in <Suspense>
export default function AdminOrderPage({ params }: PageProps<"/admin/orders/[id]">) {
  return (
    <Suspense fallback={<div className="h-60 animate-pulse rounded-lg bg-subtle" />}>
      <OrderLoader params={params} />
    </Suspense>
  );
}

async function OrderLoader({ params }: Pick<PageProps<"/admin/orders/[id]">, "params">) {
  const { id } = await params;
  return <AdminOrderView id={id} />;
}
