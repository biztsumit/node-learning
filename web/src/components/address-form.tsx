"use client";

import { useState, type FormEvent } from "react";
import { ApiRequestError, api } from "@/lib/client-api";
import type { Address } from "@/lib/types";
import { FormField } from "./form-field";

// Adds an address to the user's address book (POST /addresses). The API checks everything
// (6-digit PIN codes for India...), and its message for each field is shown under that field.
export function AddressForm({ onSaved, onCancel }: { onSaved: (address: Address) => void; onCancel?: () => void }) {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const { data } = await api<{ data: Address }>("/addresses", {
        method: "POST",
        body: { ...form, line2: form.line2 || null, label: form.label || null },
      });
      onSaved(data);
    } catch (err) {
      if (err instanceof ApiRequestError && err.fieldErrors.length > 0) {
        setFieldErrors(Object.fromEntries(err.fieldErrors.map((e) => [e.field, e.message])));
      } else {
        setError(err instanceof ApiRequestError ? err.message : "Couldn't save the address");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <FormField label="Full name" name="fullName" autoComplete="name" required error={fieldErrors.fullName} />
      <FormField label="Phone" name="phone" type="tel" autoComplete="tel" required error={fieldErrors.phone} />
      <div className="sm:col-span-2">
        <FormField label="Address line 1" name="line1" autoComplete="address-line1" required error={fieldErrors.line1} />
      </div>
      <div className="sm:col-span-2">
        <FormField label="Address line 2 (optional)" name="line2" autoComplete="address-line2" error={fieldErrors.line2} />
      </div>
      <FormField label="City" name="city" autoComplete="address-level2" required error={fieldErrors.city} />
      <FormField label="State" name="state" autoComplete="address-level1" required error={fieldErrors.state} />
      <FormField label="PIN code" name="postalCode" autoComplete="postal-code" inputMode="numeric" required error={fieldErrors.postalCode} />
      <FormField label="Label (optional)" name="label" placeholder="Home, Work…" error={fieldErrors.label} />
      {error && <p role="alert" className="text-sm text-danger sm:col-span-2">{error}</p>}
      <div className="flex gap-3 sm:col-span-2">
        <button disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-fg hover:bg-brand-hover disabled:opacity-50">
          {busy ? "Saving…" : "Save address"}
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="text-sm text-muted hover:underline">Cancel</button>}
      </div>
    </form>
  );
}
