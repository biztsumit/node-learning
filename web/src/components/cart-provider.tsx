"use client";

// How many items are in the cart, for the header's cart icon, on every page.
//
// The cart itself lives in the API (it's per user, so it follows you across devices). This
// only keeps the COUNT, and pages tell it when they change the cart:
//   const cart = useCartCount();
//   cart.sync(updatedCart)    // after any change that returned the cart
//   cart.refresh()            // after a change that didn't (adding an item, placing an order)
//   cart.openDrawer()         // slide the cart in from the side (after adding something)
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/client-api";
import type { Cart } from "@/lib/types";
import { useAuth } from "./auth-provider";

type CartCount = {
  count: number;
  refresh: () => Promise<void>;
  sync: (cart: Pick<Cart, "totalQuantity">) => void;
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
};

const CartContext = createContext<CartCount | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  // Remember WHOSE count it is: after logging out (or in as someone else), an old count
  // is simply ignored instead of needing to be reset
  const [state, setState] = useState<{ userId: string; count: number } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const res = await api<{ data: Cart }>("/cart");
      setState({ userId: user.id, count: res.data.totalQuantity });
    } catch {
      // The badge is a nice-to-have: if the cart can't be read, just don't show a number
    }
  }, [user]);

  useEffect(() => {
    if (status !== "signed-in") return;
    let cancelled = false;
    api<{ data: Cart }>("/cart").then(
      (res) => { if (!cancelled) setState({ userId: user.id, count: res.data.totalQuantity }); },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [status, user]);

  const sync = useCallback((cart: Pick<Cart, "totalQuantity">) => {
    if (user) setState({ userId: user.id, count: cart.totalQuantity });
  }, [user]);

  const count = state && user && state.userId === user.id ? state.count : 0;
  const value = useMemo(
    () => ({ count, refresh, sync, drawerOpen, openDrawer, closeDrawer }),
    [count, refresh, sync, drawerOpen, openDrawer, closeDrawer],
  );

  return <CartContext value={value}>{children}</CartContext>;
}

export function useCartCount() {
  const value = use(CartContext);
  if (!value) throw new Error("useCartCount must be used inside <CartProvider>");
  return value;
}
