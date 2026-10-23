"use client";

import { Eye, EyeOff } from "lucide-react";
import { useId, useState, type InputHTMLAttributes } from "react";
import { inputStyles } from "./form-field";

// A password input with a 👁 button: on a phone keyboard, being able to check what you typed
// prevents a lot of failed logins. It switches the input between type="password" and "text".
export function PasswordField({ label, error, hint, ...input }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }) {
  const [visible, setVisible] = useState(false);
  // The label points at the input by id (rather than wrapping it), so the 👁 button's own name
  // doesn't become part of the field's name for screen readers
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <label htmlFor={id} className="font-medium">{label}</label>
      <span className="relative">
        <input {...input} id={id} type={visible ? "text" : "password"} aria-invalid={error ? true : undefined} className={`${inputStyles} pr-11`} />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label="Show password"
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted hover:text-fg"
        >
          {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      </span>
      {error ? <span className="text-danger">{error}</span> : hint && <span className="text-muted">{hint}</span>}
    </div>
  );
}
