import { Suspense } from "react";
import { OrderView } from "./order-view";

export const metadata = { title: "Order" };

// params (the order id) and ?paid=1 are request-time data, so the order sits in <Suspense>
export default function OrderPage({ params }: PageProps<"/orders/[id]">) {
  return (
    <Suspense fallback={<div className="h-60 animate-pulse rounded-lg bg-subtle" />}>
      <OrderLoader params={params} />
    </Suspense>
  );
}

async function OrderLoader({ params }: Pick<PageProps<"/orders/[id]">, "params">) {
  const { id } = await params;
  return <OrderView id={id} />;
}
