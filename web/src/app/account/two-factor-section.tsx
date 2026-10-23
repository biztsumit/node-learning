"use client";

import QRCode from "qrcode";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { FormField } from "@/components/form-field";
import { api } from "@/lib/client-api";
import { ActionMessage, useAction } from "@/components/use-action";

type Status = { enabled: boolean; recoveryCodesLeft: number };
type Setup = { secret: string; otpauthUrl: string; qrDataUrl: string };

// Two-factor login, step by step:
//   off → "Turn on" → scan the QR code → type a code to prove it works → save the recovery codes → on
export function TwoFactorSection() {
  const [status, setStatus] = useState<Status | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const action = useAction();

  const loadStatus = useCallback(() => api<{ data: Status }>("/auth/2fa").then((res) => res.data), []);

  useEffect(() => {
    let cancelled = false;
    loadStatus().then((data) => { if (!cancelled) setStatus(data); }, () => undefined);
    return () => {
      cancelled = true;
    };
  }, [loadStatus]);

  // The API creates the secret; the QR code is drawn HERE, in the browser. The secret is
  // never sent to an outside QR-code website.
  const begin = () => action.run(async () => {
    const { data } = await api<{ data: Omit<Setup, "qrDataUrl"> }>("/auth/2fa/setup", { method: "POST" });
    setSetup({ ...data, qrDataUrl: await QRCode.toDataURL(data.otpauthUrl, { width: 200, margin: 1 }) });
  });

  const confirm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code")).replace(/\s/g, "");
    void action.run(async () => {
      const { data } = await api<{ data: { recoveryCodes: string[] } }>("/auth/2fa/enable", { method: "POST", body: { code } });
      setRecoveryCodes(data.recoveryCodes);
      setSetup(null);
      setStatus(await loadStatus());
    });
  };

  const disable = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void action.run(async () => {
      await api("/auth/2fa/disable", { method: "POST", body: { password: form.get("password"), code: form.get("code") } });
      setStatus(await loadStatus());
    }, "Two-factor login is off");
  };

  if (!status) {
    return <div className="h-24 animate-pulse rounded bg-subtle" />;
  }

  // Just turned on: the recovery codes, shown this one time only
  if (recoveryCodes) {
    const text = recoveryCodes.join("\n");
    return (
      <div className="flex flex-col gap-3 text-sm">
        <p className="font-medium text-success">Two-factor login is on.</p>
        <p>Save these recovery codes somewhere safe (a password manager, or printed). Each one works once, if you lose your phone. <strong>They won&apos;t be shown again.</strong></p>
        <pre className="grid grid-cols-2 gap-1 rounded-lg bg-subtle p-4 font-mono">{text}</pre>
        <div className="flex gap-3">
          <button type="button" onClick={() => navigator.clipboard.writeText(text)} className="underline">Copy</button>
          <a href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`} download="shop-recovery-codes.txt" className="underline">Download</a>
          <button type="button" onClick={() => setRecoveryCodes(null)} className="ml-auto rounded-lg bg-brand px-3 py-1.5 font-medium text-brand-fg">I&apos;ve saved them</button>
        </div>
      </div>
    );
  }

  if (status.enabled) {
    return (
      <div className="flex flex-col gap-4 text-sm">
        <p>
          <span className="font-medium text-success">On.</span> You&apos;ll be asked for a code from your authenticator app when you log in.
          {" "}{status.recoveryCodesLeft} recovery code{status.recoveryCodesLeft === 1 ? "" : "s"} left.
        </p>
        <details>
          <summary className="cursor-pointer underline">Turn off two-factor login</summary>
          <form onSubmit={disable} className="mt-3 grid max-w-md gap-3">
            <FormField label="Password" name="password" type="password" autoComplete="current-password" required />
            <FormField label="Code from your app (or a recovery code)" name="code" autoComplete="one-time-code" required />
            <button disabled={action.busy} className="justify-self-start rounded-lg border border-danger/40 px-4 py-2 font-medium text-danger hover:bg-danger-soft disabled:opacity-50">
              Turn off
            </button>
          </form>
        </details>
        <ActionMessage message={action.message} />
      </div>
    );
  }

  if (setup) {
    return (
      <div className="flex flex-col gap-4 text-sm">
        <ol className="list-decimal space-y-1 pl-5">
          <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…)</li>
          <li>Scan this QR code, or type the key below</li>
          <li>Enter the 6-digit code the app shows</li>
        </ol>
        {/* A data: URL made in the browser, so next/image's optimiser isn't needed */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={setup.qrDataUrl} alt="QR code for your authenticator app" width={200} height={200} className="rounded border border-line" />
        <p>Key: <code className="select-all break-all rounded bg-subtle px-1.5 py-0.5 font-mono">{setup.secret}</code></p>
        <form onSubmit={confirm} className="flex flex-wrap items-end gap-3">
          <FormField label="Code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required />
          <button disabled={action.busy} className="rounded-lg bg-brand px-4 py-2 font-medium text-brand-fg hover:bg-brand-hover disabled:opacity-50">
            {action.busy ? "Checking…" : "Turn on"}
          </button>
        </form>
        <ActionMessage message={action.message} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>Protect your account with a code from your phone, as well as your password. Someone who learns your password still can&apos;t log in.</p>
      <button type="button" onClick={begin} disabled={action.busy} className="self-start rounded-lg bg-brand px-4 py-2 font-medium text-brand-fg hover:bg-brand-hover disabled:opacity-50">
        {action.busy ? "Starting…" : "Set up two-factor login"}
      </button>
      <ActionMessage message={action.message} />
    </div>
  );
}
