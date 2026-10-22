import Link from "next/link";
import { ProductCard } from "@/components/product-card";
import { getProducts } from "@/lib/catalog";

// The home page: nothing here depends on who's visiting, so the whole page is prerendered
// (getProducts is cached), and served instantly
export default async function HomePage() {
  const { products } = await getProducts({ sort: "newest", limit: 8 });

  return (
    <div className="flex flex-col gap-10">
      <section className="rounded-xl bg-zinc-900 px-8 py-12 text-white">
        <h1 className="text-3xl font-semibold tracking-tight">Everyday things, done well</h1>
        <p className="mt-2 max-w-md text-zinc-300">Clothing, footwear and home goods. Free returns within 30 days.</p>
        <Link href="/products" className="mt-6 inline-block rounded-md bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
          Browse the shop
        </Link>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">New arrivals</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </section>
    </div>
  );
}
