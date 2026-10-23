"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth-provider";
import { FormField } from "@/components/form-field";
import { PasswordField } from "@/components/password-field";
import { Button } from "@/components/ui/button";
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
        <div className="flex items-start gap-3 rounded-xl bg-brand-soft p-4 text-sm">
          <ShieldCheck className="size-5 shrink-0 text-brand-text" aria-hidden />
          <p>Password correct. Now enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
        </div>
        <FormField label="Code" name="code" autoComplete="one-time-code" inputMode="numeric" required autoFocus />
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <Button type="submit" size="lg" loading={busy}>{busy ? "Checking…" : "Verify"}</Button>
      </form>
    );
  }

  return (
    <form onSubmit={submitPassword} className="flex flex-col gap-4">
      <FormField label="Email" name="email" type="email" autoComplete="email" required />
      <PasswordField label="Password" name="password" autoComplete="current-password" required />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" size="lg" loading={busy}>{busy ? "Logging in…" : "Log in"}</Button>
      <p className="text-center text-sm text-muted">
        New here? <Link href={`/register?next=${encodeURIComponent(next)}`} className="font-medium text-brand-text hover:underline">Create an account</Link>
      </p>
    </form>
  );
}
