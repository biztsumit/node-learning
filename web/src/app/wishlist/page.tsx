import { WishlistView } from "./wishlist-view";

export const metadata = { title: "Your wishlist" };

export default function WishlistPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Your wishlist</h1>
      <WishlistView />
    </div>
  );
}
