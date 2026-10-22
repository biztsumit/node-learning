"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { ApiRequestError, api } from "@/lib/client-api";
import { rupees } from "@/lib/format";
import type { Variant } from "@/lib/types";

// Choose a variant (size, colour...) and add it to the cart
export function AddToCart({ productId, slug, variants }: { productId: string; slug: string; variants: Variant[] }) {
  const { status } = useAuth();
  const router = useRouter();
  const [variantId, setVariantId] = useState(variants.length === 1 ? variants[0]?.id : undefined);
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const chosen = variants.find((v) => v.id === variantId);
  const hasOptions = variants.length > 1 || Object.keys(variants[0]?.options ?? {}).length > 0;

  const add = async () => {
    if (status !== "signed-in") {
      router.push(`/login?next=${encodeURIComponent(`/products/${slug}`)}`);
      return;
    }
    if (!chosen) {
      setMessage({ ok: false, text: "Please choose an option first" });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await api("/cart/items", { method: "POST", body: { productId, variantId: chosen.id, quantity } });
      setMessage({ ok: true, text: "Added to your cart" });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiRequestError ? err.message : "Something went wrong" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {hasOptions && (
        <fieldset className="flex flex-wrap gap-2">
          <legend className="mb-2 text-sm text-zinc-500">Choose an option</legend>
          {variants.map((v) => (
            <button
              key={v.id}
              type="button"
              disabled={v.stock === 0}
              onClick={() => setVariantId(v.id)}
              aria-pressed={v.id === variantId}
              className={`rounded-md border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40 ${
                v.id === variantId ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 hover:border-zinc-500"
              }`}
            >
              {v.label || "Standard"} · {rupees(v.price)}
            </button>
          ))}
        </fieldset>
      )}

      {chosen && (
        <p className="text-sm text-zinc-500">{chosen.stock > 0 ? `${chosen.stock} in stock` : "Out of stock"}</p>
      )}

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          Qty
          <input
            type="number"
            min={1}
            max={Math.max(1, chosen?.stock ?? 99)}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
            className="w-16 rounded-md border border-zinc-300 px-2 py-1.5"
          />
        </label>
        <button
          type="button"
          onClick={add}
          disabled={busy || chosen?.stock === 0}
          className="rounded-md bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add to cart"}
        </button>
      </div>

      {message && <p role="status" className={`text-sm ${message.ok ? "text-green-700" : "text-red-600"}`}>{message.text}</p>}
    </div>
  );
}
