import { ArrowRight, Sparkles } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { PaymentSuccessBanner } from "@/components/payment-success-banner";
import { ProductCard, ProductGrid } from "@/components/product-card";
import { buttonStyles } from "@/components/ui/button";
import { getCategories, getProducts } from "@/lib/catalog";
import { categoryIcon } from "@/lib/category-icon";
import { site } from "@/lib/site";
import type { Product } from "@/lib/types";

// The home page: nothing here depends on who's visiting, so the whole page is prerendered
// (the catalog functions are cached), and served instantly
export default async function HomePage() {
  // Three independent requests: started together, not one after another
  const [{ products: newest }, { products: topRated }, categories] = await Promise.all([
    getProducts({ sort: "newest", limit: 8 }),
    getProducts({ sort: "rating_desc", limit: 4 }),
    getCategories(),
  ]);
  const showcase = newest.filter((p) => p.imageUrl).slice(0, 3);
  const rated = topRated.filter((p) => p.rating.count > 0);

  return (
    <div className="flex flex-col gap-14">
      {/* Reads ?paid= from the URL (request-time), so it sits in <Suspense>: the rest of the
          page stays prerendered */}
      <Suspense>
        <PaymentSuccessBanner />
      </Suspense>

      <Hero showcase={showcase} />

      {categories.length > 0 && (
        <Section title="Shop by category" id="categories">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {categories.map((category) => {
              const Icon = categoryIcon(category.name);
              return (
                <Link
                  key={category.id}
                  href={`/products?category=${category.id}`}
                  className="group flex flex-col items-center gap-3 rounded-2xl border border-line bg-surface p-5 text-center transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-card"
                >
                  <span className="flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand-text transition group-hover:bg-brand group-hover:text-brand-fg">
                    <Icon className="size-6" aria-hidden />
                  </span>
                  <span className="text-sm font-medium">{category.name}</span>
                </Link>
              );
            })}
          </div>
        </Section>
      )}

      <Section title="New arrivals" link={{ href: "/products?sort=newest", label: "View all" }}>
        <ProductGrid>
          {newest.map((product, i) => <ProductCard key={product.id} product={product} priority={i < 4} />)}
        </ProductGrid>
      </Section>

      {rated.length > 0 && (
        <Section title="Top rated" link={{ href: "/products?sort=rating_desc", label: "View all" }}>
          <ProductGrid>
            {rated.map((product) => <ProductCard key={product.id} product={product} />)}
          </ProductGrid>
        </Section>
      )}
    </div>
  );
}

function Hero({ showcase }: { showcase: Product[] }) {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-line bg-gradient-to-br from-brand-soft via-surface to-surface">
      <div className="grid items-center gap-10 p-8 sm:p-12 md:grid-cols-2">
        <div className="flex flex-col items-start gap-5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/20 bg-surface px-3 py-1 text-xs font-medium text-brand-text">
            <Sparkles className="size-3.5" aria-hidden /> New arrivals every week
          </span>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">{site.tagline}</h1>
          <p className="max-w-md text-lg text-muted">Clothing, footwear and home goods. Free returns within 30 days.</p>
          <div className="flex flex-wrap gap-3">
            <Link href="/products" className={buttonStyles({ size: "lg" })}>
              Shop now <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link href="#categories" className={buttonStyles({ size: "lg", variant: "secondary" })}>Browse categories</Link>
          </div>
        </div>

        {/* A small collage of real products: the shop's own photos sell better than stock art */}
        {showcase.length === 3 && (
          <div className="hidden h-96 grid-cols-2 grid-rows-2 gap-4 md:grid lg:h-[26rem]" aria-hidden>
            {showcase.map((product, i) => (
              <div key={product.id} className={`relative overflow-hidden rounded-2xl shadow-pop ${i === 0 ? "row-span-2" : ""}`}>
                <Image src={product.imageUrl!} alt="" fill priority sizes="(min-width: 768px) 25vw, 0px" className="object-cover" />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Section({ title, id, link, children }: { title: string; id?: string; link?: { href: string; label: string }; children: ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-24 flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        {link && (
          <Link href={link.href} className="flex items-center gap-1 text-sm font-medium text-brand-text hover:underline">
            {link.label} <ArrowRight className="size-4" aria-hidden />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}
