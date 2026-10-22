import { Suspense } from "react";
import { RegisterForm } from "./register-form";

export const metadata = { title: "Create an account" };

export default function RegisterPage() {
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>
      <Suspense>
        <RegisterForm />
      </Suspense>
    </div>
  );
}
