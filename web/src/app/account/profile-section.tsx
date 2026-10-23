"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth-provider";
import { FormField } from "@/components/form-field";
import { api } from "@/lib/client-api";
import { ActionMessage, useAction } from "@/components/use-action";

type Me = { name: string; email: string; email_verified: boolean };

export function ProfileSection() {
  const { refreshUser } = useAuth();
  const [me, setMe] = useState<Me | null>(null);
  const save = useAction();
  const resend = useAction();

  useEffect(() => {
    let cancelled = false;
    api<{ data: Me }>("/auth/me").then((res) => { if (!cancelled) setMe(res.data); }, () => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name"));
    void save.run(async () => {
      await api("/auth/me", { method: "PATCH", body: { name } });
      await refreshUser();      // the header shows the new name too
    }, "Saved");
  };

  if (!me) {
    return <div className="h-24 animate-pulse rounded bg-subtle" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <div className="min-w-60 flex-1">
          <FormField label="Name" name="name" defaultValue={me.name} autoComplete="name" required />
        </div>
        <button disabled={save.busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-fg hover:bg-brand-hover disabled:opacity-50">
          {save.busy ? "Saving…" : "Save"}
        </button>
      </form>
      <ActionMessage message={save.message} />

      <div className="text-sm">
        <p><span className="text-muted">Email:</span> {me.email}{" "}
          {me.email_verified
            ? <span className="text-success">(verified)</span>
            : <span className="text-warning">(not verified yet)</span>}
        </p>
        {!me.email_verified && (
          <button
            type="button"
            disabled={resend.busy}
            onClick={() => resend.run(() => api("/auth/resend-verification", { method: "POST" }), "Sent: check your inbox for the link")}
            className="mt-2 underline disabled:opacity-50"
          >
            Send the verification link again
          </button>
        )}
        <ActionMessage message={resend.message} />
      </div>
    </div>
  );
}
