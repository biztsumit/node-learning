"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth-provider";
import { FormField } from "@/components/form-field";
import { PasswordField } from "@/components/password-field";
import { Button } from "@/components/ui/button";
import { ApiRequestError } from "@/lib/client-api";

const safeNext = (next: string | null): string => (next?.startsWith("/") && !next.startsWith("//") ? next : "/");

export function RegisterForm() {
  const { register } = useAuth();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [error, setError] = useState<string | null>(null);
  // The API's per-field messages ("password must be at least 6 characters")
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await register(String(form.get("name")), String(form.get("email")), String(form.get("password")));
      router.push(next);
    } catch (err) {
      if (err instanceof ApiRequestError && err.fieldErrors.length > 0) {
        setFieldErrors(Object.fromEntries(err.fieldErrors.map((e) => [e.field, e.message])));
      } else {
        setError(err instanceof ApiRequestError ? err.message : "Something went wrong. Please try again");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <FormField label="Name" name="name" autoComplete="name" required error={fieldErrors.name} />
      <FormField label="Email" name="email" type="email" autoComplete="email" required error={fieldErrors.email} />
      <PasswordField label="Password" name="password" autoComplete="new-password" minLength={6} required hint="At least 6 characters" error={fieldErrors.password} />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" size="lg" loading={busy}>{busy ? "Creating your account…" : "Create account"}</Button>
      <p className="text-center text-sm text-muted">
        Already have an account? <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-medium text-brand-text hover:underline">Log in</Link>
      </p>
    </form>
  );
}
