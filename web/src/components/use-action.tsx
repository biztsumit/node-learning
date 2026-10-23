"use client";

import { useState } from "react";
import { ApiRequestError } from "@/lib/client-api";

// The state every account form needs: busy while saving, then a success or error message.
//   const action = useAction();
//   await action.run(() => api(...), "Saved");
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (work: () => Promise<unknown>, success?: string): Promise<boolean> => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
      if (success) setMessage({ ok: true, text: success });
      return true;
    } catch (err) {
      const text = err instanceof ApiRequestError
        ? (err.fieldErrors.map((e) => e.message).join(". ") || err.message)
        : "Something went wrong. Please try again";
      setMessage({ ok: false, text });
      return false;
    } finally {
      setBusy(false);
    }
  };

  // For problems found before calling the API (e.g. a field typed in the wrong format)
  const fail = (text: string) => setMessage({ ok: false, text });

  return { busy, message, run, fail, clear: () => setMessage(null) };
}

export function ActionMessage({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null;
  return <p role="status" className={`text-sm ${message.ok ? "text-success" : "text-danger"}`}>{message.text}</p>;
}
