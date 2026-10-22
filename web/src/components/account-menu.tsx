"use client";

import Link from "next/link";
import { useAuth } from "./auth-provider";

// Right side of the header: who's logged in (decided in the browser, see AuthProvider)
export function AccountMenu() {
  const { status, user, logout } = useAuth();

  if (status === "loading") {
    return <span className="h-5 w-24 animate-pulse rounded bg-zinc-200" aria-hidden />;
  }

  if (!user) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <Link href="/login" className="hover:underline">Log in</Link>
        <Link href="/register" className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white hover:bg-zinc-700">
          Sign up
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 text-sm">
      <Link href="/cart" className="hover:underline">Cart</Link>
      <span className="hidden text-zinc-500 sm:inline">Hi, {user.name.split(" ")[0]}</span>
      <button type="button" onClick={() => logout()} className="hover:underline">
        Log out
      </button>
    </div>
  );
}
