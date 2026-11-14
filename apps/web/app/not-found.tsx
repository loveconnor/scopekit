import { Button } from "@/components/ui/button";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center px-4 text-center">
      <p className="font-mono text-[11px] leading-4 text-ink-3">404</p>
      <h1 className="mt-2 text-[20px] leading-7 font-medium text-ink">This page does not exist</h1>
      <p className="mt-1 max-w-[44ch] text-[13px] leading-5 text-ink-2">
        The link may be old, or the website it pointed to was removed
      </p>
      <Button variant="outline" size="sm" className="mt-5" render={<Link href="/overview" />}>
        Back to overview
      </Button>
    </div>
  );
}
