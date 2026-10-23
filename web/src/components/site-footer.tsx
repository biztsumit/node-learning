import { RotateCcw, ShieldCheck, ShoppingBag, Truck } from "lucide-react";
import Link from "next/link";
import { getCategories } from "@/lib/catalog";
import { site } from "@/lib/site";

// Reasons to trust the shop, right where people decide whether to buy
const PROMISES = [
  { icon: Truck, title: "Delivery across India", text: "Email updates as your order moves" },
  { icon: RotateCcw, title: "Free 30-day returns", text: "Changed your mind? Send it back" },
  { icon: ShieldCheck, title: "Secure payments", text: "UPI, cards and netbanking via Razorpay" },
];

export async function SiteFooter() {
  const categories = await getCategories();

  return (
    <footer className="mt-16 border-t border-line bg-surface">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:grid-cols-3">
        {PROMISES.map(({ icon: Icon, title, text }) => (
          <div key={title} className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-text">
              <Icon className="size-5" aria-hidden />
            </span>
            <div>
              <p className="font-medium">{title}</p>
              <p className="text-sm text-muted">{text}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-line">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-[2fr_1fr_1fr]">
          <div className="flex flex-col gap-3">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-brand-fg">
                <ShoppingBag className="size-4" aria-hidden />
              </span>
              {site.name}
            </Link>
            <p className="max-w-xs text-sm text-muted">{site.description}</p>
          </div>
          <FooterLinks title="Shop" links={[{ href: "/products", label: "All products" }, ...categories.slice(0, 5).map((c) => ({ href: `/products?category=${c.id}`, label: c.name }))]} />
          <FooterLinks title="Your account" links={[
            { href: "/account", label: "Account" },
            { href: "/orders", label: "Orders" },
            { href: "/cart", label: "Cart" },
          ]} />
        </div>
      </div>

      <p className="border-t border-line py-6 text-center text-xs text-faint">© {site.name}</p>
    </footer>
  );
}

function FooterLinks({ title, links }: { title: string; links: Array<{ href: string; label: string }> }) {
  return (
    <nav aria-label={title}>
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      <ul className="flex flex-col gap-2 text-sm text-muted">
        {links.map((link) => (
          <li key={link.href}><Link href={link.href} className="hover:text-fg">{link.label}</Link></li>
        ))}
      </ul>
    </nav>
  );
}
