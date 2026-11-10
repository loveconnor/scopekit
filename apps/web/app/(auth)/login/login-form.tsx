"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { useState } from "react";

export function LoginForm({ github, emailConfigured }: { github: boolean; emailConfigured: boolean }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState("sending");
    const { error } = await authClient.signIn.magicLink({ email, callbackURL: "/overview" });
    setState(error ? "error" : "sent");
  }

  if (state === "sent") {
    return (
      <div className="mt-8 rounded-lg border border-line bg-surface p-5" role="status">
        <p className="text-[13px] leading-5 font-medium text-ink">Check for a sign-in link</p>
        <p className="mt-1 text-[13px] leading-5 text-ink-2">
          If <span className="font-mono text-[12px]">{email}</span> is on the allowlist, a link valid for 10 minutes is on its way
          {emailConfigured ? "." : ". No mail provider is configured, so the link is printed in the web server log."}
        </p>
        <button
          type="button"
          onClick={() => setState("idle")}
          className="mt-3 cursor-pointer rounded-sm text-[13px] text-ink-2 underline decoration-line underline-offset-4 hover:text-ink"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label htmlFor="email" className="text-[13px] leading-5 text-ink-2">
          Email
        </label>
        <Input
          id="email"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
        />
        <Button type="submit" className="mt-1 w-full" disabled={state === "sending"}>
          {state === "sending" ? "Sending link" : "Email me a sign-in link"}
        </Button>
        {state === "error" ? (
          <p role="alert" className="text-[13px] leading-5 text-negative">
            The link could not be sent. Try again in a moment
          </p>
        ) : null}
      </form>
      {github ? (
        <>
          <div className="my-6 border-t border-line" />
          <Button variant="outline" className="w-full" onClick={() => authClient.signIn.social({ provider: "github", callbackURL: "/overview" })}>
            Continue with GitHub
          </Button>
        </>
      ) : null}
    </div>
  );
}
