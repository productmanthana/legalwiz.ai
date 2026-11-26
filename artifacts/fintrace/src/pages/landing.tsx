import { Link } from "wouter";
import { ArrowRight, FileSpreadsheet, GitCompareArrows, Calculator, MessagesSquare, ShieldCheck, Scale, Fingerprint, Eye } from "lucide-react";
import { Logo } from "@/components/shell";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const steps = [
  { icon: FileSpreadsheet, k: "01", t: "Import statements", d: "CSV and Excel bank statements are parsed row by row, de-duplicated and balance-checked against the declared opening and closing figures." },
  { icon: GitCompareArrows, k: "02", t: "Reconcile the movement", d: "Own-account transfers, cash withdrawal and redeposit, and loan cycles are proposed as matches so the same rupee is never counted twice." },
  { icon: Calculator, k: "03", t: "Show the working", d: "Income, receipts and expenditure are scheduled by financial year. The DA statement shows A, B, C and D line by line, not just a percentage." },
  { icon: MessagesSquare, k: "04", t: "Answer each query", d: "Every investigation query gets a versioned response, linked transactions and documents, and a full history of approvals." },
];

export default function Landing() {
  return (
    <div className="min-h-[100dvh] bg-background grain text-foreground">
      <header className="sticky top-0 z-30 bg-background/85 backdrop-blur border-b">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Logo />
          <div className="flex items-center gap-2 text-sm">
            <Link href="/sign-in" className="px-3 py-1.5 rounded-md hover:bg-muted" data-testid="link-signin">Sign in</Link>
            <Link href="/sign-up" className="px-3.5 py-1.5 rounded-md bg-primary text-primary-foreground" data-testid="link-signup">Create account</Link>
          </div>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-6 pt-16 pb-20 grid lg:grid-cols-[1.1fr_1fr] gap-12 items-center">
        <div className="rise">
          <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-[hsl(var(--teal))] font-semibold bg-card">
            Karnataka Lokayukta DA / Income Tax scrutiny
          </div>
          <h1 className="mt-5 text-[44px] md:text-[60px] leading-[1.02] font-medium tracking-tight">
            Financial clarity.<br />Structured explanations.<br /><span className="italic text-[hsl(var(--teal))]">Investigation intelligence.</span>
          </h1>
          <p className="mt-6 text-[17px] text-muted-foreground max-w-xl leading-relaxed">
            FINTRACE turns years of bank statements, property deeds and loan papers into a reconciled, sourced record — the kind an advocate can put on the screen in a hearing and walk through line by line.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/sign-up" className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold" data-testid="button-hero-signup">Open a case register <ArrowRight className="h-4 w-4" /></Link>
            <Link href="/sign-in" className="inline-flex items-center gap-2 rounded-md border bg-card px-5 py-2.5 text-sm" data-testid="button-hero-signin">I already have an account</Link>
          </div>
          <p className="mt-6 text-xs text-muted-foreground max-w-md border-l-2 border-[hsl(var(--brass))] pl-3">
            The system never decides guilt, innocence or legal validity. It organises evidence and shows its working; people draw the conclusions.
          </p>
        </div>
        <div className="relative rise" style={{ animationDelay: "120ms" }}>
          <div className="absolute -inset-3 rounded-2xl border border-dashed rotate-[1.5deg]" />
          <div className="relative rounded-xl overflow-hidden border shadow-xl">
            <img src={`${basePath}/hero-ledger.jpg`} alt="Ledgers and passbooks arranged for review" className="w-full h-[420px] object-cover" />
            <div className="absolute bottom-0 inset-x-0 bg-card/95 backdrop-blur border-t p-4">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">DA statement, check period 01 Apr 2012 – 31 Mar 2020</div>
              <div className="mt-2 grid grid-cols-4 gap-2 num text-xs">
                {[["A", "₹18,42,600"], ["B", "₹1,26,08,950"], ["C", "₹97,31,482"], ["D", "₹31,77,140"]].map(([k, v]) => (
                  <div key={k} className="rounded border px-2 py-1.5"><div className="text-muted-foreground">{k}</div><div className="text-foreground">{v}</div></div>
                ))}
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground num">(B − A) − (C − D) = ₹42,12,082 &nbsp;·&nbsp; 43.28% of C &nbsp;·&nbsp; <span className="text-[hsl(var(--brass))]">illustrative</span></div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y bg-card">
        <div className="max-w-6xl mx-auto px-6 py-16">
          <div className="text-[11px] uppercase tracking-[0.14em] text-[hsl(var(--teal))] font-semibold">The method</div>
          <h2 className="text-3xl md:text-4xl font-medium mt-2 max-w-2xl">From raw passbook to a schedule an officer can verify.</h2>
          <div className="mt-10 grid md:grid-cols-2 gap-px bg-border rounded-lg overflow-hidden border">
            {steps.map((s) => (
              <div key={s.k} className="bg-card p-6 flex gap-4">
                <div className="num text-xs text-muted-foreground pt-1">{s.k}</div>
                <div>
                  <div className="flex items-center gap-2"><s.icon className="h-4 w-4 text-[hsl(var(--teal))]" /><div className="font-semibold">{s.t}</div></div>
                  <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{s.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="grid md:grid-cols-[1fr_1.3fr] gap-10">
          <div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-[hsl(var(--teal))] font-semibold">Two workspaces, one record</div>
            <h2 className="text-3xl md:text-4xl font-medium mt-2">Each side sees what it should — and only that.</h2>
            <p className="text-sm text-muted-foreground mt-4 leading-relaxed">A case belongs to whoever opened it. Sharing is explicit, by email, with a stated role, and every share is written to the audit trail.</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="rounded-lg border bg-card p-5 shadow-xs">
              <ShieldCheck className="h-5 w-5 text-[hsl(var(--teal))]" />
              <div className="font-display text-xl mt-3">Client workspace</div>
              <div className="text-xs text-muted-foreground mt-0.5">Individuals, advocates, chartered accountants</div>
              <ul className="mt-4 space-y-2 text-sm">
                <li>Import and classify transactions</li><li>Record assets, loans and family income</li><li>Draft, approve and submit responses</li><li>Export schedules and DA statements</li>
              </ul>
            </div>
            <div className="rounded-lg border bg-sidebar text-sidebar-foreground p-5 shadow-xs">
              <Eye className="h-5 w-5 text-sidebar-primary" />
              <div className="font-display text-xl mt-3 text-white">Investigation workspace</div>
              <div className="text-xs text-sidebar-foreground/60 mt-0.5">Authorised investigation officers</div>
              <ul className="mt-4 space-y-2 text-sm">
                <li>Review shared cases read-only</li><li>Raise queries and follow-ups</li><li>Record assessments with reasons</li><li>Examine discrepancies and blind spots</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-sidebar text-sidebar-foreground">
        <div className="max-w-6xl mx-auto px-6 py-16 grid md:grid-cols-3 gap-8">
          {[
            { i: Fingerprint, t: "Originals preserved", d: "Corrections need a reason. Imported values stay visible beside every edit. Documents carry a SHA-256 fingerprint." },
            { i: Scale, t: "Law, labelled honestly", d: "Every judgment and provision carries a Verified, Unverified or Disputed badge. Unverified is never presented as authority." },
            { i: MessagesSquare, t: "AI as a drafting aid", d: "Assistant output is marked AI suggestion until a person approves it. Nothing is submitted on its own." },
          ].map((x) => (
            <div key={x.t}>
              <x.i className="h-5 w-5 text-sidebar-primary" />
              <div className="font-display text-xl text-white mt-3">{x.t}</div>
              <p className="text-sm mt-2 text-sidebar-foreground/70 leading-relaxed">{x.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-20 text-center">
        <h2 className="text-4xl font-medium">Begin with one account and one year.</h2>
        <p className="text-muted-foreground mt-3">Or load a clearly marked demo case and look around first.</p>
        <div className="mt-7 flex justify-center gap-3">
          <Link href="/sign-up" className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold" data-testid="button-cta-signup">Create account <ArrowRight className="h-4 w-4" /></Link>
          <Link href="/sign-in" className="rounded-md border bg-card px-5 py-2.5 text-sm" data-testid="button-cta-signin">Sign in</Link>
        </div>
      </section>

      <footer className="border-t">
        <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col md:flex-row gap-2 justify-between text-xs text-muted-foreground">
          <Logo />
          <span>Reports generated here are working papers, not official government forms. FINTRACE does not provide legal advice.</span>
        </div>
      </footer>
    </div>
  );
}
