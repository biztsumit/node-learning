"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { AccountCard } from "@/components/account-shell";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { ActionMessage, useAction } from "@/components/use-action";
import { api, setAccessToken } from "@/lib/client-api";
import { PasswordSection } from "../password-section";
import { TwoFactorSection } from "../two-factor-section";

export function SecurityView() {
  const { logout } = useAuth();
  const router = useRouter();
  const everywhere = useAction();

  // "I lost my phone": ends every login, including this one
  const logOutEverywhere = () => everywhere.run(async () => {
    await api("/auth/logout-all", { method: "POST" });
    setAccessToken(null);
    await logout();
    router.push("/login");
  });

  return (
    <div className="flex flex-col gap-6">
      <AccountCard title="Password" description="Use at least 6 characters. A longer phrase is easier to remember and harder to guess.">
        <PasswordSection />
      </AccountCard>
      <AccountCard title="Two-factor login">
        <TwoFactorSection />
      </AccountCard>
      <AccountCard title="Devices" description="Lost a phone or used a shared computer? End every login on every device, including this one.">
        <Button variant="secondary" onClick={logOutEverywhere} loading={everywhere.busy} className="self-start">
          <LogOut className="size-4" aria-hidden /> Log out everywhere
        </Button>
        <ActionMessage message={everywhere.message} />
      </AccountCard>
    </div>
  );
}
