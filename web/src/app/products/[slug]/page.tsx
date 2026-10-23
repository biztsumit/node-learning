import { ImageOff, RotateCcw, ShieldCheck, Truck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ProductCard, ProductGrid } from "@/components/product-card";
import { Skeleton } from "@/components/ui/card";
import { Stars } from "@/components/ui/stars";
import { getProductBySlug, getProducts } from "@/lib/catalog";
import { AddToCart } from "./add-to-cart";
import { Reviews } from "./reviews";

// Prerender the newest products at build time. Any other product is rendered on its first
// visit (the page shell shows at once), then cached for the next visitor.
export async function generateStaticParams() {
  const { products } = await getProducts({ sort: "newest", limit: 20 });
  return products.map((product) => ({ slug: product.slug }));
}

export default function ProductPage({ params }: PageProps<"/products/[slug]">) {
  return (
    // Room at the bottom on phones for the sticky "Add to cart" bar
    <div className="pb-20 md:pb-0">
      <Suspense fallback={<ProductSkeleton />}>
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

  // "You may also like": others from the same category (cached like every catalog read)
  const { products: related } = product.category
    ? await getProducts({ category: product.category.id, limit: 5 })
    : { products: [] };
  const others = related.filter((p) => p.id !== product.id).slice(0, 4);

  return (
    <div className="flex flex-col gap-16">
      <div className="flex flex-col gap-6">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
          <Link href="/" className="hover:text-fg">Home</Link>
          <span aria-hidden>/</span>
          {product.category ? (
            <Link href={`/products?category=${product.category.id}`} className="hover:text-fg">{product.category.name}</Link>
          ) : (
            <Link href="/products" className="hover:text-fg">Products</Link>
          )}
          <span aria-hidden>/</span>
          <span aria-current="page" className="line-clamp-1 text-fg">{product.name}</span>
        </nav>

        <div className="grid gap-8 md:grid-cols-2 lg:gap-12">
          <div className="relative aspect-square overflow-hidden rounded-3xl border border-line bg-subtle md:sticky md:top-24 md:self-start">
            {product.imageUrl ? (
              <Image src={product.imageUrl} alt={product.name} fill priority sizes="(min-width: 768px) 50vw, 100vw" className="object-cover" />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-faint">
                <ImageOff className="size-12" aria-hidden />
                <span className="text-sm">No photo yet</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              {product.category && <p className="text-sm font-medium tracking-wide text-brand-text uppercase">{product.category.name}</p>}
              <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{product.name}</h1>
              {product.rating.count > 0 && (
                <a href="#reviews" className="flex items-center gap-2 text-sm text-muted hover:text-fg">
                  <Stars rating={product.rating.average} size="md" />
                  {product.rating.average.toFixed(1)} · {product.rating.count} review{product.rating.count === 1 ? "" : "s"}
                </a>
              )}
            </div>

            <AddToCart product={product} />

            {product.description && (
              <div className="flex flex-col gap-2 border-t border-line pt-6">
                <h2 className="font-medium">About this product</h2>
                <p className="leading-relaxed whitespace-pre-line text-muted">{product.description}</p>
              </div>
            )}

            <ul className="grid gap-3 rounded-2xl bg-subtle p-4 text-sm sm:grid-cols-3 md:grid-cols-1 lg:grid-cols-3">
              {[
                { icon: Truck, text: "Delivery across India" },
                { icon: RotateCcw, text: "Free 30-day returns" },
                { icon: ShieldCheck, text: "Secure payment" },
              ].map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-2 text-muted">
                  <Icon className="size-4 shrink-0 text-brand-text" aria-hidden /> {text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <Reviews productId={product.id} slug={product.slug} />

      {others.length > 0 && (
        <section className="flex flex-col gap-5">
          <h2 className="text-2xl font-semibold tracking-tight">You may also like</h2>
          <ProductGrid>
            {others.map((p) => <ProductCard key={p.id} product={p} />)}
          </ProductGrid>
        </section>
      )}
    </div>
  );
}

function ProductSkeleton() {
  return (
    <div className="grid gap-8 md:grid-cols-2 lg:gap-12" aria-busy>
      <Skeleton className="aspect-square rounded-3xl" />
      <div className="flex flex-col gap-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-24" />
        <Skeleton className="h-12" />
      </div>
    </div>
  );
}
