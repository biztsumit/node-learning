import type { InputHTMLAttributes } from "react";

// The look of every text input, shared so forms match (also used for selects and textareas)
export const inputStyles =
  "h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm outline-none transition placeholder:text-faint focus:border-brand focus:ring-3 focus:ring-brand/15 aria-[invalid=true]:border-danger";

// A labelled input, with the API's message for this field (if any) underneath
export function FormField({ label, error, ...input }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <input {...input} aria-invalid={error ? true : undefined} className={inputStyles} />
      {error && <span className="text-danger">{error}</span>}
    </label>
  );
}
