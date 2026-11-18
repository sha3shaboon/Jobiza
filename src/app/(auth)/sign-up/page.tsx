import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";
import { withProviders } from "@/components/providers-data";

export const metadata: Metadata = { title: "Create account" };

async function Form() {
  return withProviders((providers) => <AuthForm mode="sign-up" providers={providers} />);
}

export default function Page() {
  return (
    <Suspense fallback={<div className="card h-96 animate-pulse" />}>
      <Form />
    </Suspense>
  );
}
