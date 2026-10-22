import Image from "next/image";
import Link from "next/link";
import { rupees } from "@/lib/format";
import type { Product } from "@/lib/types";

export function ProductCard({ product }: { product: Product }) {
  const image = product.thumbnailUrl ?? product.imageUrl;
  return (
    <Link href={`/products/${product.slug}`} className="group flex flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="relative aspect-square bg-zinc-100">
        {image ? (
          <Image src={image} alt={product.name} fill sizes="(min-width: 768px) 25vw, 50vw" className="object-cover transition group-hover:scale-105" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-400">No image</div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 text-sm font-medium">{product.name}</h3>
        <p className="mt-auto text-sm">
          {product.variantCount > 1 && <span className="text-zinc-500">from </span>}
          <span className="font-semibold">{rupees(product.price)}</span>
        </p>
        {product.stock === 0 && <p className="text-xs text-red-600">Out of stock</p>}
      </div>
    </Link>
  );
}
