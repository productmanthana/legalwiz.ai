import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { getGetMeQueryKey, useSignIn, useSignUp } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/shell";
import { errMsg } from "@/lib/format";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function AuthFrame({ children, kind }: { children: ReactNode; kind: "in" | "up" }) {
  return (
    <div className="min-h-[100dvh] grid lg:grid-cols-[1.05fr_1fr] bg-background grain">
      <div className="hidden lg:flex relative flex-col justify-between bg-sidebar text-sidebar-foreground p-10 overflow-hidden">
        <img src={`${basePath}/hero-ledger.jpg`} alt="" className="absolute inset-0 h-full w-full object-cover opacity-25 mix-blend-luminosity" />
        <div className="absolute inset-0 bg-gradient-to-t from-sidebar via-sidebar/70 to-sidebar/30" />
        <div className="relative"><Logo light /></div>
        <div className="relative max-w-md">
          <div className="text-[11px] uppercase tracking-[0.18em] text-sidebar-primary mb-3">{kind === "in" ? "Return to your records" : "Open a register"}</div>
          <p className="font-display text-[34px] leading-[1.12] text-white">Every rupee accounted for. Every conclusion left to the people whose job it is.</p>
          <p className="text-sm mt-4 text-sidebar-foreground/70">Shared cases are logged. Investigators see only what has been explicitly shared with them.</p>
        </div>
      </div>
      <div className="flex items-center justify-center px-4 py-10">
        <div className="w-[440px] max-w-full rounded-xl border bg-card p-8 shadow-[0_18px_40px_-10px_hsl(224_50%_20%/0.18)]">{children}</div>
      </div>
    </div>
  );
}

function AuthForm({ kind }: { kind: "in" | "up" }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const onDone = (me: unknown) => {
    queryClient.clear();
    queryClient.setQueryData(getGetMeQueryKey(), me);
    setLocation("/dashboard");
  };
  const onError = (e: unknown) => setError(errMsg(e));
  const signIn = useSignIn({ mutation: { onSuccess: onDone, onError } });
  const signUp = useSignUp({ mutation: { onSuccess: onDone, onError } });
  const pending = signIn.isPending || signUp.isPending;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (kind === "in") signIn.mutate({ data: { email, password } });
    else signUp.mutate({ data: { email, password } });
  };

  return (
    <AuthFrame kind={kind}>
      <form onSubmit={submit} className="space-y-4">
        <div className="text-center mb-2">
          <h1 className="font-display text-[26px] font-medium">{kind === "in" ? "Sign in to FINTRACE" : "Create your FINTRACE account"}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {kind === "in" ? "Your case registers are waiting" : "For subjects, advocates, chartered accountants and authorised officers"}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" data-testid="input-email" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" required minLength={kind === "up" ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={kind === "in" ? "current-password" : "new-password"} data-testid="input-password" />
          {kind === "up" && <p className="text-xs text-muted-foreground">At least 8 characters.</p>}
        </div>
        {error && <p className="text-sm text-destructive" data-testid="text-auth-error">{error}</p>}
        <Button type="submit" className="w-full" disabled={pending} data-testid="button-auth-submit">
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {kind === "in" ? "Sign in" : "Create account"}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          {kind === "in" ? "No account yet? " : "Already have an account? "}
          <Link href={kind === "in" ? "/sign-up" : "/sign-in"} className="font-semibold text-accent-foreground underline-offset-4 hover:underline">
            {kind === "in" ? "Create one" : "Sign in"}
          </Link>
        </p>
      </form>
    </AuthFrame>
  );
}

export function SignInPage() {
  return <AuthForm kind="in" />;
}

export function SignUpPage() {
  return <AuthForm kind="up" />;
}
