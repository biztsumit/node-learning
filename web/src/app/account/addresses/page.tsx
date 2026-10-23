import { AccountCard, RequireLogin } from "@/components/account-shell";
import { AddressesSection } from "../addresses-section";

export const metadata = { title: "Your addresses" };

export default function AddressesPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Addresses</h1>
      <RequireLogin next="/account/addresses">
        <AccountCard title="Saved addresses" description="Choose one at checkout. The default is picked for you.">
          <AddressesSection />
        </AccountCard>
      </RequireLogin>
    </div>
  );
}
