"use client";

import { useEffect, useState } from "react";
import { AddressForm } from "@/components/address-form";
import { api } from "@/lib/client-api";
import type { Address } from "@/lib/types";
import { ActionMessage, useAction } from "@/components/use-action";

export function AddressesSection() {
  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [adding, setAdding] = useState(false);
  const action = useAction();

  // The API lists the default address first
  const reload = () => api<{ data: Address[] }>("/addresses").then((res) => setAddresses(res.data));

  useEffect(() => {
    let cancelled = false;
    api<{ data: Address[] }>("/addresses").then((res) => { if (!cancelled) setAddresses(res.data); }, () => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!addresses) {
    return <div className="h-24 animate-pulse rounded bg-subtle" />;
  }

  return (
    <div className="flex flex-col gap-3">
      {addresses.length === 0 && !adding && <p className="text-sm text-muted">No saved addresses yet.</p>}
      <ul className="flex flex-col gap-2">
        {addresses.map((a) => (
          <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-line p-3 text-sm">
            <span>
              <span className="font-medium">{a.fullName}</span>
              {a.label && <span className="text-muted"> · {a.label}</span>}
              {a.isDefault && <span className="ml-2 rounded bg-subtle px-1.5 py-0.5 text-xs">Default</span>}
              <br />
              {a.line1}{a.line2 && `, ${a.line2}`}, {a.city}, {a.state} {a.postalCode} · {a.phone}
            </span>
            <span className="flex gap-3">
              {!a.isDefault && (
                <button
                  type="button"
                  disabled={action.busy}
                  onClick={() => action.run(async () => {
                    await api(`/addresses/${a.id}`, { method: "PATCH", body: { isDefault: true } });
                    await reload();
                  })}
                  className="underline disabled:opacity-50"
                >
                  Make default
                </button>
              )}
              <button
                type="button"
                disabled={action.busy}
                onClick={() => window.confirm("Delete this address?") && action.run(async () => {
                  await api(`/addresses/${a.id}`, { method: "DELETE" });
                  await reload();
                })}
                className="text-danger underline disabled:opacity-50"
              >
                Delete
              </button>
            </span>
          </li>
        ))}
      </ul>
      <ActionMessage message={action.message} />
      {adding ? (
        <AddressForm onSaved={() => { setAdding(false); void reload(); }} onCancel={() => setAdding(false)} />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="self-start text-sm underline">+ Add an address</button>
      )}
    </div>
  );
}
