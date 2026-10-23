"use client"; // Error boundaries must be Client Components

import { CloudOff, RotateCw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button, buttonStyles } from "@/components/ui/button";

// Shown in place of a page that failed to render, e.g. when the API can't be reached.
// The header and layout around it stay, so the visitor isn't left on a blank or raw error page.
export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    // Keep the real reason in the browser console, for whoever is debugging
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-5 py-14 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-warning-soft text-warning">
        <CloudOff className="size-8" aria-hidden />
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">The shop can&apos;t load this page right now</h1>
        <p className="text-muted">It&apos;s probably a short hiccup on our side. Please try again in a moment.</p>
      </div>
      <div className="flex gap-3">
        {/* retry(): fetches the page's data again and re-renders it */}
        <Button onClick={() => retry()}><RotateCw className="size-4" aria-hidden /> Try again</Button>
        <Link href="/" className={buttonStyles({ variant: "secondary" })}>Home</Link>
      </div>
    </div>
  );
}
