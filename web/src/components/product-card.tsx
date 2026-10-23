import { ImageOff } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { rupees } from "@/lib/format";
import type { Product } from "@/lib/types";
import { Badge } from "./ui/badge";
import { Stars } from "./ui/stars";
import { WishlistButton } from "./wishlist-button";

// "Only 3 left" creates honest urgency; it's only shown when it's actually true
const LOW_STOCK = 5;

// A Server Component (prerendered with the page); only the heart inside it runs in the browser
export function ProductCard({ product, priority = false }: { product: Product; priority?: boolean }) {
  const image = product.thumbnailUrl ?? product.imageUrl;
  const soldOut = product.stock === 0;

  return (
    // The heart is a button, and a button may not sit INSIDE a link (two things to click in one).
    // So the card is a box holding the link, with the heart placed over the photo next to it.
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-surface transition duration-200 hover:-translate-y-0.5 hover:shadow-pop">
      <Link href={`/products/${product.slug}`} className="flex flex-1 flex-col">
        <div className="relative aspect-square overflow-hidden bg-subtle">
          {image ? (
            <Image
              src={image}
              alt={product.name}
              fill
              priority={priority}
              sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
              className={`object-cover transition duration-500 group-hover:scale-105 ${soldOut ? "opacity-60 grayscale" : ""}`}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-faint">
              <ImageOff className="size-8" aria-hidden />
              <span className="text-xs">No photo yet</span>
            </div>
          )}
          <div className="absolute top-2 left-2 flex flex-col gap-1">
            {soldOut && <Badge>Out of stock</Badge>}
            {!soldOut && product.stock <= LOW_STOCK && <Badge tone="warning">Only {product.stock} left</Badge>}
          </div>
        </div>
  
        <div className="flex flex-1 flex-col gap-1 p-3 sm:p-4">
          {product.category && <p className="text-xs text-muted">{product.category.name}</p>}
          <h3 className="line-clamp-2 text-sm font-medium sm:text-base">{product.name}</h3>
          {product.rating.count > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <Stars rating={product.rating.average} />
              <span>({product.rating.count})</span>
            </p>
          )}
          <p className="mt-auto pt-1">
            {product.variantCount > 1 && <span className="text-sm text-muted">from </span>}
            <span className="font-semibold">{rupees(product.price)}</span>
          </p>
        </div>
      </Link>
      <WishlistButton productId={product.id} name={product.name} className="absolute top-2 right-2" />
      </div>
  );
}

// The grid every product list uses, so they all line up the same way
// narrow: next to a sidebar (the catalog), so one column fewer on big screens
export function ProductGrid({ narrow = false, children }: { narrow?: boolean; children: ReactNode }) {
  return <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 ${narrow ? "" : "lg:grid-cols-4"}`}>{children}</div>;
}

export function ProductGridSkeleton({ count = 8, narrow = false }: { count?: number; narrow?: boolean }) {
  return (
    <ProductGrid narrow={narrow}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} aria-hidden className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="aspect-square animate-pulse bg-subtle" />
          <div className="flex flex-col gap-2 p-4">
            <div className="h-3 w-1/3 animate-pulse rounded bg-subtle" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-subtle" />
            <div className="h-4 w-1/4 animate-pulse rounded bg-subtle" />
          </div>
        </div>
      ))}
    </ProductGrid>
  );
}
