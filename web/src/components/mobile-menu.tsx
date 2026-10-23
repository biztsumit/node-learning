"use client";

import { ChevronRight, Menu } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { Category } from "@/lib/types";
import { Drawer } from "./ui/drawer";

// The ☰ button on phones and tablets, opening a drawer with every category
export function MobileMenu({ categories }: { categories: Category[] }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  const links = [{ href: "/products", label: "All products" }, ...categories.map((c) => ({ href: `/products?category=${c.id}`, label: c.name }))];

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" className="-ml-2 rounded-lg p-2 hover:bg-subtle md:hidden">
        <Menu className="size-5" aria-hidden />
      </button>
      <Drawer open={open} onClose={close} title="Shop by category">
        <nav aria-label="Categories">
          <ul className="divide-y divide-line">
            {links.map((link) => (
              <li key={link.href}>
                {/* Closing on click: the drawer would otherwise stay open over the new page */}
                <Link href={link.href} onClick={close} className="flex items-center justify-between px-4 py-3.5 hover:bg-subtle">
                  {link.label}
                  <ChevronRight className="size-4 text-faint" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Drawer>
    </>
  );
}
