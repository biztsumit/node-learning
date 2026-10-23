"use client";

import { Minus, Plus, ShoppingBag } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { useCartCount } from "@/components/cart-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WishlistButton } from "@/components/wishlist-button";
import { ApiRequestError, api } from "@/lib/client-api";
import { cn } from "@/lib/cn";
import { rupees } from "@/lib/format";
import type { ProductWithVariants, Variant } from "@/lib/types";

// Common colour names → a swatch colour. Anything else is shown as a text chip instead.
const SWATCHES: Record<string, string> = {
  black: "#111111", white: "#ffffff", grey: "#8a8a8a", gray: "#8a8a8a", navy: "#1f2a5a", blue: "#2f6fd6",
  red: "#d63a3a", green: "#2e8b57", yellow: "#f2c230", orange: "#f08a24", pink: "#f28cb1", purple: "#7b4bc4",
  brown: "#7a4e2d", beige: "#e3d3b5", maroon: "#7a1f2b", olive: "#6b7a2e", cream: "#f5ecd7",
};
const isColour = (optionName: string) => /^colou?r$/i.test(optionName);

type Options = Record<string, string>;
const matches = (variant: Variant, wanted: Options) => Object.entries(wanted).every(([name, value]) => variant.options[name] === value);

export function AddToCart({ product }: { product: ProductWithVariants }) {
  const { status } = useAuth();
  const router = useRouter();
  const cartCount = useCartCount();
  const { variants } = product;

  // Every variant has the same option names ("size", "colour"): the rows of choices
  const optionNames = Object.keys(variants[0]?.options ?? {});
  // The values for one option, in the order the variants list them, without repeats
  const valuesOf = (name: string) => [...new Set(variants.map((v) => v.options[name]).filter((v): v is string => Boolean(v)))];

  // Start with the first variant that's in stock already chosen: one less tap to buy
  const [selected, setSelected] = useState<Options>(() => ({ ...(variants.find((v) => v.stock > 0) ?? variants[0])?.options }));
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const chosen = variants.find((v) => matches(v, selected));

  const choose = (name: string, value: string) => {
    setError(null);
    setQuantity(1);
    const wanted = { ...selected, [name]: value };
    if (variants.some((v) => matches(v, wanted))) {
      setSelected(wanted);
      return;
    }
    // No variant has this combination (e.g. "Red" only comes in M): jump to one that has the
    // value just tapped, preferring one in stock
    const fallback = variants.find((v) => v.options[name] === value && v.stock > 0) ?? variants.find((v) => v.options[name] === value);
    if (fallback) setSelected({ ...fallback.options });
  };

  // Can this value be bought, given the OTHER choices already made?
  const buyable = (name: string, value: string) =>
    variants.some((v) => v.stock > 0 && matches(v, { ...selected, [name]: value }));

  const add = async () => {
    if (status !== "signed-in") {
      router.push(`/login?next=${encodeURIComponent(`/products/${product.slug}`)}`);
      return;
    }
    if (!chosen) {
      setError("Please choose an option first");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/cart/items", { method: "POST", body: { productId: product.id, variantId: chosen.id, quantity } });
      // The cart slides in showing what was just added (the confirmation, and the way to
      // checkout), and the header's cart count goes up at the same moment
      void cartCount.refresh();
      cartCount.openDrawer();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Something went wrong. Please try again");
    } finally {
      setBusy(false);
    }
  };

  const price = chosen?.price ?? product.price;
  const stock = chosen?.stock ?? 0;
  const soldOut = chosen ? stock === 0 : product.stock === 0;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-3xl font-semibold tracking-tight">
        {!chosen && product.variantCount > 1 && <span className="text-lg font-normal text-muted">from </span>}
        {rupees(price)}
      </p>

      {optionNames.map((name) => (
        <fieldset key={name} className="flex flex-col gap-2.5">
          <legend className="mb-2.5 text-sm">
            <span className="font-medium capitalize">{name}</span>
            {selected[name] && <span className="text-muted">: {selected[name]}</span>}
          </legend>
          <div className="flex flex-wrap gap-2">
            {valuesOf(name).map((value) => {
              const active = selected[name] === value;
              const swatch = isColour(name) ? SWATCHES[value.toLowerCase()] : undefined;
              const available = buyable(name, value);
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  aria-label={`${name} ${value}${available ? "" : " (sold out)"}`}
                  onClick={() => choose(name, value)}
                  className={cn(
                    "relative transition",
                    swatch
                      ? "size-10 rounded-full ring-offset-2 ring-offset-surface"
                      : "h-10 min-w-12 rounded-lg border px-4 text-sm font-medium",
                    swatch && (active ? "ring-2 ring-brand" : "ring-1 ring-line-strong hover:ring-fg/40"),
                    !swatch && (active ? "border-brand bg-brand text-brand-fg" : "border-line-strong bg-surface hover:border-fg/40"),
                    // Sold out: still choosable (to see it's unavailable), but visibly struck through
                    !available && "opacity-45 [background-image:linear-gradient(to_top_right,transparent_calc(50%-1px),currentColor,transparent_calc(50%+1px))]",
                  )}
                  style={swatch ? { backgroundColor: swatch } : undefined}
                >
                  {!swatch && value}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}

      {/* Stock in words: honest urgency only when it's true */}
      <div aria-live="polite">
        {chosen && (stock === 0
          ? <Badge tone="danger">Out of stock</Badge>
          : stock <= 5
            ? <Badge tone="warning">Only {stock} left, order soon</Badge>
            : <Badge tone="success">In stock</Badge>)}
      </div>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      {/* On phones this row sticks to the bottom of the screen, so "Add to cart" is always one
          tap away while reading the description or reviews */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-line bg-surface/95 p-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
        <div className="flex h-12 items-center rounded-lg border border-line-strong bg-surface" role="group" aria-label="Quantity">
          <button type="button" aria-label="One fewer" disabled={quantity <= 1} onClick={() => setQuantity((q) => q - 1)} className="flex size-11 items-center justify-center text-muted hover:text-fg disabled:opacity-40">
            <Minus className="size-4" aria-hidden />
          </button>
          <span className="w-8 text-center font-medium tabular-nums" aria-live="polite">{quantity}</span>
          <button type="button" aria-label="One more" disabled={soldOut || quantity >= stock} onClick={() => setQuantity((q) => q + 1)} className="flex size-11 items-center justify-center text-muted hover:text-fg disabled:opacity-40">
            <Plus className="size-4" aria-hidden />
          </button>
        </div>
        {/* Disabled for the moment after a page load while we check whether you're logged in:
            a click then would wrongly treat a logged-in shopper as a guest */}
        <Button size="lg" onClick={add} loading={busy} disabled={soldOut || status === "loading"} className="flex-1 md:flex-none md:px-10">
          {!busy && <ShoppingBag className="size-5" aria-hidden />}
          {soldOut ? "Sold out" : busy ? "Adding…" : "Add to cart"}
        </Button>
        <WishlistButton productId={product.id} name={product.name} variant="outline" />
      </div>
    </div>
  );
}
