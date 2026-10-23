"use client";

import type { FormEvent } from "react";
import { FormField } from "@/components/form-field";
import { api, setAccessToken } from "@/lib/client-api";
import { ActionMessage, useAction } from "@/components/use-action";

// Changing the password logs out every OTHER device. This one stays logged in: the API
// answers with a fresh access token (and sets a fresh refresh cookie).
export function PasswordSection() {
  const action = useAction();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void action.run(async () => {
      const res = await api<{ data: { token: string } }>("/auth/change-password", {
        method: "POST",
        body: { currentPassword: data.get("currentPassword"), newPassword: data.get("newPassword") },
      });
      setAccessToken(res.data.token);
      form.reset();
    }, "Password changed. Other devices have been logged out");
  };

  return (
    <form onSubmit={submit} className="grid max-w-md gap-3">
      <FormField label="Current password" name="currentPassword" type="password" autoComplete="current-password" required />
      <FormField label="New password" name="newPassword" type="password" autoComplete="new-password" minLength={6} required />
      <button disabled={action.busy} className="justify-self-start rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-fg hover:bg-brand-hover disabled:opacity-50">
        {action.busy ? "Changing…" : "Change password"}
      </button>
      <ActionMessage message={action.message} />
    </form>
  );
}
