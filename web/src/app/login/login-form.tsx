"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth-provider";
import { FormField } from "@/components/form-field";
import { ApiRequestError } from "@/lib/client-api";

// Only go back to a page on THIS site: "?next=https://evil.example" must not redirect away
// (an "open redirect", a favourite trick in phishing links)
const safeNext = (next: string | null): string => (next?.startsWith("/") && !next.startsWith("//") ? next : "/");

export function LoginForm() {
  const { login, completeTwoFactor } = useAuth();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));

  // Step 2 of a two-factor login: set once the password was right
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Something went wrong. Please try again");
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    return run(async () => {
      const result = await login(String(form.get("email")), String(form.get("password")));
      if (result.done) {
        router.push(next);
      } else {
        setChallengeToken(result.challengeToken);
      }
    });
  };

  const submitCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code"));
    return run(async () => {
      await completeTwoFactor(challengeToken ?? "", code);
      router.push(next);
    });
  };

  if (challengeToken) {
    return (
      <form onSubmit={submitCode} className="flex flex-col gap-4">
        <p className="text-sm text-zinc-600">Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
        <FormField label="Code" name="code" autoComplete="one-time-code" inputMode="numeric" required autoFocus />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button disabled={busy} className="rounded-md bg-zinc-900 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50">
          {busy ? "Checking…" : "Verify"}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={submitPassword} className="flex flex-col gap-4">
      <FormField label="Email" name="email" type="email" autoComplete="email" required />
      <FormField label="Password" name="password" type="password" autoComplete="current-password" required />
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button disabled={busy} className="rounded-md bg-zinc-900 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50">
        {busy ? "Logging in…" : "Log in"}
      </button>
      <p className="text-sm text-zinc-600">
        New here? <Link href={`/register?next=${encodeURIComponent(next)}`} className="underline">Create an account</Link>
      </p>
    </form>
  );
}
