import { Star } from "lucide-react";
import { cn } from "@/lib/cn";

// ★★★★☆ for a rating like 4.3: each star is filled by the part of the rating it covers
// (the 5th star of 4.3 gets 0%, the 4th 100%, a 4.5 would fill half of the 5th).
// The picture is decorative; the label says the number, for screen readers.
export function Stars({ rating, size = "sm", className }: { rating: number; size?: "sm" | "md" | "lg"; className?: string }) {
  const px = { sm: "size-3.5", md: "size-4.5", lg: "size-6" }[size];
  return (
    <span role="img" aria-label={`Rated ${rating.toFixed(1)} out of 5`} className={cn("inline-flex items-center gap-0.5", className)}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, rating - i));
        return (
          <span key={i} className={cn("relative", px)}>
            <Star className={cn("absolute inset-0 text-line-strong", px)} fill="currentColor" strokeWidth={0} aria-hidden />
            {fill > 0 && (
              <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                <Star className={cn("text-star", px)} fill="currentColor" strokeWidth={0} aria-hidden />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}
