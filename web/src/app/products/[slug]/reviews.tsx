"use client";

import { MessageSquareText, Star } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth-provider";
import { EmptyState } from "@/components/empty-state";
import { inputStyles } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/card";
import { Stars } from "@/components/ui/stars";
import { useToast } from "@/components/ui/toast";
import { ApiRequestError, api } from "@/lib/client-api";
import { cn } from "@/lib/cn";
import type { Pagination, Review, ReviewPage } from "@/lib/types";

const SORTS = [
  { value: "newest", label: "Newest" },
  { value: "highest", label: "Highest rated" },
  { value: "lowest", label: "Lowest rated" },
];

// Reviews load in the browser, not with the cached page: they change often, and a new review
// should show up straight away for the person who wrote it
export function Reviews({ productId, slug }: { productId: string; slug: string }) {
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState<{ key: string; summary: ReviewPage["summary"]; reviews: Review[]; pagination: Pagination } | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState(false);
  const key = `${sort} ${version}`;

  useEffect(() => {
    let cancelled = false;
    api<{ data: ReviewPage; pagination: Pagination }>(`/products/${productId}/reviews?sort=${sort}&limit=5`).then(
      (res) => { if (!cancelled) setPage({ key, ...res.data, pagination: res.pagination }); },
      () => { if (!cancelled) setError(true); },
    );
    return () => {
      cancelled = true;
    };
  }, [productId, sort, key]);

  const loadMore = async () => {
    if (!page) return;
    const next = (page.pagination.page ?? 1) + 1;
    const res = await api<{ data: ReviewPage; pagination: Pagination }>(`/products/${productId}/reviews?sort=${sort}&limit=5&page=${next}`);
    setPage({ ...page, reviews: [...page.reviews, ...res.data.reviews], pagination: res.pagination });
  };

  return (
    <section id="reviews" className="flex scroll-mt-24 flex-col gap-6">
      <h2 className="text-2xl font-semibold tracking-tight">Customer reviews</h2>

      {error && !page && <p role="alert" className="text-danger">Couldn&apos;t load the reviews right now.</p>}
      {!page && !error && <Skeleton className="h-48" />}

      {page && (
        <div className="grid gap-8 lg:grid-cols-[18rem_1fr]">
          <div className="flex flex-col gap-6">
            <Summary summary={page.summary} />
            <ReviewForm productId={productId} slug={slug} onSaved={() => setVersion((v) => v + 1)} />
          </div>

          <div className="flex flex-col gap-4">
            {page.summary.count === 0 ? (
              <EmptyState icon={MessageSquareText} title="No reviews yet" text="Bought this? Tell other shoppers what you think." />
            ) : (
              <>
                <label className="flex items-center gap-2 self-end text-sm">
                  <span className="text-muted">Sort by</span>
                  <select value={sort} onChange={(e) => setSort(e.target.value)} className={`${inputStyles} w-auto`}>
                    {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </label>
                <ul className={cn("flex flex-col divide-y divide-line transition-opacity", page.key !== key && "opacity-50")}>
                  {page.reviews.map((review) => (
                    <li key={review.id} className="flex flex-col gap-2 py-5 first:pt-0">
                      <div className="flex items-center gap-3">
                        <span className="flex size-9 items-center justify-center rounded-full bg-subtle text-sm font-semibold" aria-hidden>
                          {review.reviewer.charAt(0)}
                        </span>
                        <div>
                          <p className="text-sm font-medium">{review.reviewer}</p>
                          <p className="text-xs text-muted">{new Date(review.createdAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}</p>
                        </div>
                        <Stars rating={review.rating} className="ml-auto" />
                      </div>
                      {review.comment && <p className="leading-relaxed text-muted">{review.comment}</p>}
                    </li>
                  ))}
                </ul>
                {(page.pagination.totalPages ?? 1) > (page.pagination.page ?? 1) && (
                  <Button variant="secondary" onClick={loadMore} className="self-center">Show more reviews</Button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// The average, and how many people gave each number of stars
function Summary({ summary }: { summary: ReviewPage["summary"] }) {
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-3">
        <span className="text-4xl font-semibold">{summary.count > 0 ? summary.average.toFixed(1) : "–"}</span>
        <div>
          <Stars rating={summary.average} size="md" />
          <p className="text-sm text-muted">{summary.count} review{summary.count === 1 ? "" : "s"}</p>
        </div>
      </div>
      <ul className="flex flex-col gap-1.5">
        {(["5", "4", "3", "2", "1"] as const).map((stars) => {
          const count = summary.breakdown[stars];
          const share = summary.count > 0 ? (count / summary.count) * 100 : 0;
          return (
            <li key={stars} className="flex items-center gap-2 text-sm">
              <span className="w-8 text-muted tabular-nums">{stars} ★</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-subtle">
                <span className="block h-full rounded-full bg-star" style={{ width: `${share}%` }} />
              </span>
              <span className="w-6 text-right text-muted tabular-nums">{count}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// Write (or change) your review. The API only accepts reviews from people whose order of this
// product was delivered, and one review per person: its answers decide what this form says.
function ReviewForm({ productId, slug, onSaved }: { productId: string; slug: string; onSaved: () => void }) {
  const { status } = useAuth();
  const toast = useToast();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [editing, setEditing] = useState(false);       // they already have a review: update it
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (status !== "signed-in") {
    return (
      <p className="text-sm text-muted">
        <Link href={`/login?next=/products/${slug}%23reviews`} className="font-medium text-brand-text underline">Log in</Link> to review this product.
      </p>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (rating === 0) {
      setMessage("Please choose a star rating");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await api(`/products/${productId}/reviews${editing ? "/me" : ""}`, { method: editing ? "PATCH" : "POST", body: { rating, comment } });
      toast.show(editing ? "Your review was updated" : "Thanks for your review!");
      setRating(0);
      setComment("");
      setEditing(false);
      onSaved();
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) {
        // Already reviewed: the same form now updates that review
        setEditing(true);
        setMessage("You've already reviewed this product. Press the button again to replace your review with this one.");
      } else {
        setMessage(err instanceof ApiRequestError ? err.message : "Something went wrong. Please try again");
      }
    } finally {
      setBusy(false);
    }
  };

  const shown = hover || rating;
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <h3 className="font-medium">{editing ? "Update your review" : "Write a review"}</h3>
      {/* Stars as radio buttons: one choice of five, works with the keyboard's arrow keys */}
      <fieldset className="flex gap-1" onMouseLeave={() => setHover(0)}>
        <legend className="sr-only">Your rating</legend>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="cursor-pointer" onMouseEnter={() => setHover(n)}>
            <input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} className="peer sr-only" />
            <span className="sr-only">{n} star{n === 1 ? "" : "s"}</span>
            <Star className={cn("size-7 rounded transition peer-focus-visible:outline-2 peer-focus-visible:outline-brand", n <= shown ? "text-star" : "text-line-strong")} fill="currentColor" strokeWidth={0} aria-hidden />
          </label>
        ))}
      </fieldset>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={2000}
        rows={3}
        placeholder="What did you like or dislike? (optional)"
        aria-label="Your review"
        className={`${inputStyles} h-auto py-2`}
      />
      {message && <p role="status" className="text-sm text-muted">{message}</p>}
      <Button type="submit" variant="secondary" loading={busy} className="self-start">{editing ? "Update review" : "Post review"}</Button>
    </form>
  );
}
