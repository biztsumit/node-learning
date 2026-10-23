import { RequireLogin } from "@/components/account-shell";
import { SecurityView } from "./security-view";

export const metadata = { title: "Security" };

export default function SecurityPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Security</h1>
      <RequireLogin next="/account/security">
        <SecurityView />
      </RequireLogin>
    </div>
  );
}
