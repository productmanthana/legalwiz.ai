import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, ShieldCheck, Eye, Check } from "lucide-react";
import { useGetMe, useUpdateMe, getGetMeQueryKey, type UserProfileUpdateRole } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, useInvalidate } from "@/components/common";
import { Logo } from "@/components/shell";
import { useToast } from "@/hooks/use-toast";
import { errMsg } from "@/lib/format";
import { cn } from "@/lib/utils";

const ROLES: Record<string, { value: UserProfileUpdateRole; label: string }[]> = {
  client: [{ value: "individual", label: "Individual (subject of enquiry)" }, { value: "advocate", label: "Advocate" }, { value: "chartered_accountant", label: "Chartered Accountant" }],
  investigation: [{ value: "investigation_officer", label: "Investigation Officer" }],
};

export default function Onboarding() {
  const { data: me } = useGetMe();
  const update = useUpdateMe();
  const inv = useInvalidate();
  const [, nav] = useLocation();
  const { toast } = useToast();
  const [ws, setWs] = useState<"client" | "investigation">("client");
  const [role, setRole] = useState<UserProfileUpdateRole>("individual");
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");

  useEffect(() => { if (me) { setName(me.displayName ?? ""); setOrg(me.organisation ?? ""); } }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickWs = (w: "client" | "investigation") => { setWs(w); setRole(ROLES[w][0].value); };

  const submit = () => {
    update.mutate({ data: { workspace: ws, role, displayName: name.trim() || undefined, organisation: org.trim() || null } }, {
      onSuccess: async () => { await inv(getGetMeQueryKey()); nav("/dashboard"); },
      onError: (e) => toast({ title: "Could not save profile", description: errMsg(e), variant: "destructive" }),
    });
  };

  return (
    <div className="min-h-[100dvh] bg-background grain">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <Logo />
        <div className="mt-12 rise">
          <div className="text-[11px] uppercase tracking-[0.14em] text-[hsl(var(--teal))] font-semibold">Set up your register</div>
          <h1 className="text-4xl font-medium mt-2">Which side of the table are you on?</h1>
          <p className="text-sm text-muted-foreground mt-2">This sets your workspace. You can change it later in settings; case access is still governed by explicit sharing.</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4 mt-8 stagger">
          {([
            { k: "client", icon: ShieldCheck, t: "Client workspace", d: "I am the person under enquiry, or their advocate or chartered accountant. I prepare records and responses." },
            { k: "investigation", icon: Eye, t: "Investigation workspace", d: "I am an authorised officer reviewing cases that have been shared with me, raising queries and recording assessments." },
          ] as const).map((o) => (
            <button key={o.k} onClick={() => pickWs(o.k)} data-testid={`button-workspace-${o.k}`}
              className={cn("text-left rounded-lg border bg-card p-5 relative transition-all", ws === o.k ? "border-primary shadow-md ring-1 ring-primary" : "hover:border-primary/40")}>
              {ws === o.k && <span className="absolute top-3 right-3 h-5 w-5 rounded-full bg-primary text-primary-foreground grid place-items-center"><Check className="h-3 w-3" /></span>}
              <o.icon className="h-5 w-5 text-[hsl(var(--teal))]" />
              <div className="font-display text-xl mt-3">{o.t}</div>
              <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{o.d}</p>
            </button>
          ))}
        </div>
        <div className="mt-8 rounded-lg border bg-card p-5 grid sm:grid-cols-2 gap-4 rise">
          <Field label="Role">
            <div className="flex flex-wrap gap-2">
              {ROLES[ws].map((r) => (
                <button key={r.value} onClick={() => setRole(r.value)} data-testid={`button-role-${r.value}`}
                  className={cn("rounded-md border px-3 py-1.5 text-sm", role === r.value ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted")}>{r.label}</button>
              ))}
            </div>
          </Field>
          <div />
          <Field label="Display name"><Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-display-name" /></Field>
          <Field label="Organisation" hint={ws === "investigation" ? "e.g. Karnataka Lokayukta, Bengaluru Division" : "Chambers, firm or leave blank"}><Input value={org} onChange={(e) => setOrg(e.target.value)} data-testid="input-organisation" /></Field>
        </div>
        <div className="mt-6 flex justify-end">
          <Button size="lg" onClick={submit} disabled={update.isPending} data-testid="button-continue">{update.isPending && <Loader2 className="animate-spin" />}Continue to dashboard</Button>
        </div>
      </div>
    </div>
  );
}
