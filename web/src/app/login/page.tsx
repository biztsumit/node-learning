import { Suspense } from "react";
import { AuthLayout } from "@/components/auth-layout";
import { LoginForm } from "./login-form";

export const metadata = { title: "Log in" };

// The form reads ?next= from the URL (request-time data), so it sits in <Suspense>
export default function LoginPage() {
  return (
    <AuthLayout title="Welcome back" subtitle="Log in to see your cart, orders and wishlist.">
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthLayout>
  );
}
