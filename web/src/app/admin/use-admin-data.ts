"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiRequestError, api } from "@/lib/client-api";

// A readable message for a failed request. The API's own message is the most useful one
// ("Can't change an order from shipped to paid", "Admin access needs two-factor login...").
export const errorText = (err: unknown): string =>
  err instanceof ApiRequestError
    ? (err.fieldErrors.map((e) => e.message).join(". ") || err.message)
    : "Couldn't reach the server. Please try again in a moment";

type State<T> = { key: string | null; data: T | null; error: string | null };

// Loads `path` from the API, and again whenever it changes:
//   const { data, error, loading, reload } = useAdminData<Res>(`/admin/orders?status=${status}`);
// While a new path loads, `data` still holds the previous answer, so the page keeps its shape
// (no flash of a skeleton) and can show it faded instead.
export function useAdminData<T>(path: string | null) {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<State<T>>({ key: null, data: null, error: null });

  // Which request the page wants right now. `loading` is simply "the last answer we got was
  // for a different request": no extra state to keep in sync.
  const key = path === null ? null : `${version} ${path}`;

  useEffect(() => {
    if (path === null || key === null) return;
    // Ignore the answer if the path changed (or the page closed) before it arrived:
    // otherwise a slow old request could overwrite a newer one
    let cancelled = false;
    api<T>(path).then(
      (res) => { if (!cancelled) setState({ key, data: res, error: null }); },
      (err) => { if (!cancelled) setState((s) => ({ key, data: s.data, error: errorText(err) })); }
    );
    return () => {
      cancelled = true;
    };
  }, [path, key]);

  const loading = key !== null && state.key !== key;
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  // For updating the shown data after a change, without asking the API again
  const setData = useCallback((update: (data: T | null) => T | null) => setState((s) => ({ ...s, data: update(s.data) })), []);

  return { data: state.data, error: loading ? null : state.error, loading, reload, setData };
}
