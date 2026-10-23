"use client";

import { Heart, ImageOff } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { EmptyState } from "@/components/empty-state";
import { ProductGrid, ProductGridSkeleton } from "@/components/product-card";
import { Badge } from "@/components/ui/badge";
import { buttonStyles } from "@/components/ui/button";
import { WishlistButton } from "@/components/wishlist-button";
import { useWishlist } from "@/components/wishlist-provider";
import { rupees } from "@/lib/format";

export function WishlistView() {
  const { status } = useAuth();
  const { items } = useWishlist();

  if (status === "guest") {
    return (
      <EmptyState icon={Heart} title="Save the things you love" text="Log in to keep a wishlist that follows you on every device.">
        <Link href="/login?next=/wishlist" className={buttonStyles()}>Log in</Link>
      </EmptyState>
    );
  }
  if (!items) {
    return <ProductGridSkeleton count={4} />;
  }
  if (items.length === 0) {
    return (
      <EmptyState icon={Heart} title="Your wishlist is empty" text="Tap the ♥ on any product to save it here for later.">
        <Link href="/products" className={buttonStyles()}>Browse products</Link>
      </EmptyState>
    );
  }

  return (
    <ProductGrid>
      {items.map((item) => (
        <div key={item.productId} className="group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-surface">
          <Link href={`/products/${item.slug}`} className="flex flex-1 flex-col">
            <div className="relative aspect-square bg-subtle">
              {item.thumbnailUrl ? (
                <Image src={item.thumbnailUrl} alt={item.name} fill sizes="(min-width: 1024px) 25vw, 50vw" className={`object-cover ${item.inStock ? "" : "opacity-60 grayscale"}`} />
              ) : (
                <div className="flex h-full items-center justify-center text-faint"><ImageOff className="size-8" aria-hidden /></div>
              )}
              {!item.inStock && <Badge className="absolute top-2 left-2">Out of stock</Badge>}
            </div>
            <div className="flex flex-1 flex-col gap-1 p-4">
              <h2 className="line-clamp-2 text-sm font-medium sm:text-base">{item.name}</h2>
              <p className="mt-auto font-semibold">{rupees(item.price)}</p>
            </div>
          </Link>
          <WishlistButton productId={item.productId} name={item.name} className="absolute top-2 right-2" />
        </div>
      ))}
    </ProductGrid>
  );
}
