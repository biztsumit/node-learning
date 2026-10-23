"use client";

// Which products the signed-in shopper has saved (♥), for every heart on every page.
//
// OPTIMISTIC UPDATES: a tap on a heart fills it AT ONCE, before the API has answered, because
// waiting half a second for a heart to change feels broken. If the API then says no, the heart
// goes back and a toast explains.
import { useRouter } from "next/navigation";
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/client-api";
import type { WishlistItem } from "@/lib/types";
import { useAuth } from "./auth-provider";
import { useToast } from "./ui/toast";

type Wishlist = {
  items: WishlistItem[] | null;             // null while loading (or for guests)
  isSaved: (productId: string) => boolean;
  toggle: (productId: string, name: string) => Promise<void>;
};

const WishlistContext = createContext<Wishlist | null>(null);

export function WishlistProvider({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const toast = useToast();
  const router = useRouter();
  // Like the cart count: remember whose list it is, so another user never sees it
  const [state, setState] = useState<{ userId: string; items: WishlistItem[]; saved: Set<string> } | null>(null);

  const remember = useCallback((userId: string, items: WishlistItem[]) =>
    setState({ userId, items, saved: new Set(items.map((i) => i.productId)) }), []);

  useEffect(() => {
    if (status !== "signed-in") return;
    let cancelled = false;
    api<{ data: WishlistItem[] }>("/wishlist").then(
      (res) => { if (!cancelled) remember(user.id, res.data); },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [status, user, remember]);

  const mine = state && user && state.userId === user.id ? state : null;

  const toggle = useCallback(async (productId: string, name: string) => {
    if (!user) {
      // Saving needs an account: log in, then come back to the same page
      router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    const wasSaved = mine?.saved.has(productId) ?? false;

    // 1. Show the change straight away
    setState((s) => {
      const saved = new Set(s?.userId === user.id ? s.saved : []);
      if (wasSaved) saved.delete(productId); else saved.add(productId);
      return { userId: user.id, items: s?.userId === user.id ? s.items : [], saved };
    });

    // 2. Tell the API; it answers with the whole updated list
    try {
      const res = await api<{ data: WishlistItem[] }>(`/wishlist/${productId}`, { method: wasSaved ? "DELETE" : "PUT" });
      remember(user.id, res.data);
      toast.show(wasSaved ? `Removed ${name} from your wishlist` : `Saved ${name} to your wishlist`);
    } catch {
      // 3. It failed: put the heart back the way it was
      setState((s) => {
        if (!s) return s;
        const saved = new Set(s.saved);
        if (wasSaved) saved.add(productId); else saved.delete(productId);
        return { ...s, saved };
      });
      toast.show("Couldn't update your wishlist. Please try again", "error");
    }
  }, [user, mine, router, remember, toast]);

  const value = useMemo<Wishlist>(() => ({
    items: mine?.items ?? null,
    isSaved: (productId) => mine?.saved.has(productId) ?? false,
    toggle,
  }), [mine, toggle]);

  return <WishlistContext value={value}>{children}</WishlistContext>;
}

export function useWishlist() {
  const value = use(WishlistContext);
  if (!value) throw new Error("useWishlist must be used inside <WishlistProvider>");
  return value;
}
