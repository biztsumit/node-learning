import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata = { title: "Log in" };

// The form reads ?next= from the URL (request-time data), so it sits in <Suspense>
export default function LoginPage() {
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
