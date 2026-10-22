import type { InputHTMLAttributes } from "react";

// A labelled input, with the API's message for this field (if any) underneath
export function FormField({ label, error, ...input }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <input
        {...input}
        aria-invalid={error ? true : undefined}
        className="rounded-md border border-zinc-300 px-3 py-2 outline-none focus:border-zinc-500 aria-[invalid=true]:border-red-500"
      />
      {error && <span className="text-red-600">{error}</span>}
    </label>
  );
}
