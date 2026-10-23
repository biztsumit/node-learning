import { Heart, Package, ShieldCheck } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";
import { getProducts } from "@/lib/catalog";
import { site } from "@/lib/site";

const PERKS = [
  { icon: Package, text: "Track every order from payment to your door" },
  { icon: Heart, text: "Save favourites to your wishlist, on every device" },
  { icon: ShieldCheck, text: "Optional two-factor login keeps your account safe" },
];

// Log in / sign up: the form on one side, a brand panel with real products on the other.
// The panel is decoration and reassurance, so on phones (where space is precious) only the
// form is shown.
export async function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const { products } = await getProducts({ sort: "newest", limit: 8 });
  const photos = products.filter((p) => p.imageUrl).slice(0, 4);

  return (
    <div className="mx-auto grid max-w-5xl overflow-hidden rounded-3xl border border-line bg-surface shadow-card lg:grid-cols-2">
      <div className="flex flex-col justify-center gap-6 p-6 sm:p-10">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
          <p className="text-muted">{subtitle}</p>
        </div>
        {children}
      </div>

      <div className="relative hidden flex-col justify-between gap-8 overflow-hidden bg-brand p-10 text-brand-fg lg:flex">
        {/* Soft light circles for depth, purely decorative */}
        <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-32 -left-16 size-80 rounded-full bg-black/10 blur-2xl" aria-hidden />

        <div className="relative flex flex-col gap-3">
          <p className="text-2xl font-semibold tracking-tight">{site.tagline}</p>
          <ul className="flex flex-col gap-3 text-sm text-brand-fg/85">
            {PERKS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/15"><Icon className="size-4" aria-hidden /></span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        {photos.length === 4 && (
          <div className="relative grid grid-cols-2 gap-3" aria-hidden>
            {photos.map((p, i) => (
              <div key={p.id} className={`relative aspect-square overflow-hidden rounded-2xl ring-1 ring-white/20 ${i % 2 ? "translate-y-4" : ""}`}>
                <Image src={p.imageUrl!} alt="" fill sizes="240px" className="object-cover" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
