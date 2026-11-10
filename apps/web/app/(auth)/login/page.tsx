import { Logo } from "@/components/scopekit/logo";
import { env } from "@/lib/env";
import { getOptionalUser } from "@/lib/session";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

async function RedirectIfSignedIn() {
  if (await getOptionalUser()) redirect("/overview");
  return null;
}

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <Suspense fallback={null}>
        <RedirectIfSignedIn />
      </Suspense>
      <div className="w-full max-w-[360px]">
        <Logo />
        <h1 className="mt-10 text-[24px] leading-8 font-medium text-ink">Sign in</h1>
        <p className="mt-1 text-[13px] leading-5 text-ink-2">Private workspace. Only allowlisted accounts can sign in</p>
        <LoginForm github={Boolean(env.github)} emailConfigured={Boolean(env.resendKey && env.emailFrom)} />
      </div>
    </main>
  );
}
