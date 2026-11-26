import { Link } from "wouter";
import { Logo } from "@/components/shell";

export default function NotFound() {
  return (
    <div className="min-h-[100dvh] bg-background grain flex flex-col">
      <div className="px-6 py-5"><Link href="/" data-testid="link-home"><Logo /></Link></div>
      <div className="flex-1 grid place-items-center px-6">
        <div className="max-w-lg w-full rise">
          <div className="num text-xs text-muted-foreground mb-2">ENTRY 404 / NO RECORD</div>
          <div className="border-y py-6 ledger-rule">
            <h1 className="text-5xl font-medium">This page is not on the register.</h1>
            <p className="text-sm text-muted-foreground mt-3">The address may have been mistyped, or the record was archived. Nothing has been changed.</p>
          </div>
          <div className="mt-6 flex gap-3 text-sm">
            <Link href="/dashboard" className="rounded-md bg-primary text-primary-foreground px-4 py-2" data-testid="link-dashboard">Go to dashboard</Link>
            <Link href="/" className="rounded-md border px-4 py-2" data-testid="link-landing">Home</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
