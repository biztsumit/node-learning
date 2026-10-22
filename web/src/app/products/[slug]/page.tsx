import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getProductBySlug, getProducts } from "@/lib/catalog";
import { rupees } from "@/lib/format";
import { AddToCart } from "./add-to-cart";

// Prerender the newest products at build time. Any other product is rendered on its first
// visit (the page shell shows at once), then cached for the next visitor.
export async function generateStaticParams() {
  const { products } = await getProducts({ sort: "newest", limit: 20 });
  return products.map((product) => ({ slug: product.slug }));
}

export default function ProductPage({ params }: PageProps<"/products/[slug]">) {
  return (
    <div className="flex flex-col gap-6">
      <Link href="/products" className="text-sm text-zinc-500 hover:underline">← All products</Link>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-zinc-200" />}>
        <ProductDetails params={params} />
      </Suspense>
    </div>
  );
}

async function ProductDetails({ params }: Pick<PageProps<"/products/[slug]">, "params">) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) {
    notFound();
  }

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <div className="relative aspect-square overflow-hidden rounded-lg bg-zinc-100">
        {product.imageUrl ? (
          <Image src={product.imageUrl} alt={product.name} fill priority sizes="(min-width: 768px) 50vw, 100vw" className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-zinc-400">No image</div>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {product.category && <p className="text-sm text-zinc-500">{product.category.name}</p>}
        <h1 className="text-2xl font-semibold tracking-tight">{product.name}</h1>
        <p className="text-xl">
          {product.variantCount > 1 && <span className="text-base text-zinc-500">from </span>}
          {rupees(product.price)}
        </p>
        {product.rating.count > 0 && (
          <p className="text-sm text-zinc-600">★ {product.rating.average.toFixed(1)} ({product.rating.count} reviews)</p>
        )}
        {product.description && <p className="leading-relaxed text-zinc-700">{product.description}</p>}
        <AddToCart productId={product.id} slug={product.slug} variants={product.variants} />
      </div>
    </div>
  );
}
