import { AccountCard, RequireLogin } from "@/components/account-shell";
import { ProfileSection } from "./profile-section";

export const metadata = { title: "Your account" };

export default function AccountPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Profile</h1>
      <RequireLogin next="/account">
        <AccountCard title="Your details" description="Your name is shown on your orders; your email is where we send updates.">
          <ProfileSection />
        </AccountCard>
      </RequireLogin>
    </div>
  );
}
