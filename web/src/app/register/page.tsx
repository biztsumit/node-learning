import { Suspense } from "react";
import { AuthLayout } from "@/components/auth-layout";
import { RegisterForm } from "./register-form";

export const metadata = { title: "Create an account" };

export default function RegisterPage() {
  return (
    <AuthLayout title="Create your account" subtitle="It takes a minute. Then checkout is faster every time.">
      <Suspense>
        <RegisterForm />
      </Suspense>
    </AuthLayout>
  );
}
