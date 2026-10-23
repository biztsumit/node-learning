import { Suspense } from "react";
import { EditProduct } from "./edit-product";

export const metadata = { title: "Edit product" };

// params (the product id) is request-time data, so the editor sits in <Suspense>
export default function EditProductPage({ params }: PageProps<"/admin/products/[id]">) {
  return (
    <Suspense fallback={<div className="h-60 animate-pulse rounded-lg bg-subtle" />}>
      <ProductLoader params={params} />
    </Suspense>
  );
}

async function ProductLoader({ params }: Pick<PageProps<"/admin/products/[id]">, "params">) {
  const { id } = await params;
  return <EditProduct id={id} />;
}
