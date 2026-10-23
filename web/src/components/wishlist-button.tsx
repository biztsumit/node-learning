"use client";

import { Heart } from "lucide-react";
import { cn } from "@/lib/cn";
import { useAuth } from "./auth-provider";
import { useWishlist } from "./wishlist-provider";

// The ♥ toggle. aria-pressed tells screen readers whether it's on ("Save to wishlist, pressed").
export function WishlistButton({ productId, name, variant = "floating", className }: {
  productId: string;
  name: string;
  variant?: "floating" | "outline";     // floating: on a product photo; outline: next to a button
  className?: string;
}) {
  const { status } = useAuth();
  const { isSaved, toggle } = useWishlist();
  const saved = isSaved(productId);

  return (
    <button
      type="button"
      aria-pressed={saved}
      // Not until we know whether someone is logged in (see AddToCart)
      disabled={status === "loading"}
      aria-label={`Save ${name} to wishlist`}
      onClick={() => void toggle(productId, name)}
      className={cn(
        "flex items-center justify-center rounded-full transition active:scale-90",
        variant === "floating"
          ? "size-9 bg-surface/90 shadow-card backdrop-blur hover:bg-surface"
          : "size-12 border border-line-strong bg-surface hover:bg-subtle",
        className,
      )}
    >
      <Heart className={cn("size-5 transition-colors", saved ? "fill-danger text-danger" : "text-muted")} aria-hidden />
    </button>
  );
}
