import { useState } from "react";
import { Link } from "wouter";
import { Calculator, AlertTriangle, ScanSearch, Loader2 } from "lucide-react";
import {
  useGetDaCalculation, useListBlindSpots, useReviewBlindSpot, getListBlindSpotsQueryKey,
  type Case, type BlindSpot, type BlindSpotReviewReviewStatus,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CaseLayout, access, useCaseId } from "@/components/case-layout";
import { Panel, LoadingRows, ErrorState, EmptyState, Tag, StatusBadge, useInvalidate, Notice, Money, nativeSelect, DemoBadge } from "@/components/common";
import { fdate, human, inr, errMsg } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function BlindSpotCard({ b, canReview }: { b: BlindSpot; canReview: boolean }) {
  const caseId = useCaseId();
  const rv = useReviewBlindSpot();
  const inv = useInvalidate();
  const { toast } = useToast();
  const [st, setSt] = useState<BlindSpotReviewReviewStatus>(b.reviewStatus);
  const [note, setNote] = useState(b.reviewNote ?? "");
  const dirty = st !== b.reviewStatus || note !== (b.reviewNote ?? "");
  return (
    <div className={cn("rounded-lg border bg-card p-4 shadow-xs border-l-[3px]", b.severity === "high" ? "border-l-destructive" : b.severity === "medium" ? "border-l-[hsl(var(--brass))]" : "border-l-border")} data-testid={`card-blindspot-${b.code}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-sm">{b.title}</span><StatusBadge status={b.severity} label={`${human(b.severity)} severity`} /><StatusBadge status={b.reviewStatus} />
        <span className="num text-[10.5px] text-muted-foreground ml-auto">{b.code}</span>
      </div>
      <p className="text-sm text-muted-foreground mt-2"><span className="text-foreground font-medium">Why it matters: </span>{b.whyItMatters}</p>
      <p className="text-sm mt-1.5"><span className="font-medium">Suggested clarification: </span>{b.suggestedClarification}</p>
      {!!b.relatedTransactionIds.length && (
        <div className="mt-2 text-xs flex flex-wrap items-center gap-1">Related transactions:
          {b.relatedTransactionIds.slice(0, 12).map((id) => <Link key={id} href={`/cases/${caseId}/transactions`} className="num rounded border px-1.5 hover:border-primary">#{id}</Link>)}
          {b.relatedTransactionIds.length > 12 && <span className="text-muted-foreground">+{b.relatedTransactionIds.length - 12} more</span>}
        </div>
      )}
      {canReview ? (
        <div className="mt-3 flex flex-wrap items-start gap-2">
          <select className={cn(nativeSelect, "h-8 text-xs")} value={st} onChange={(e) => setSt(e.target.value as BlindSpotReviewReviewStatus)} data-testid={`select-blindspot-${b.code}`}>
            {["open", "reviewing", "resolved", "not_applicable"].map((x) => <option key={x} value={x}>{human(x)}</option>)}
          </select>
          <Textarea rows={1} className="flex-1 min-w-[200px] min-h-8 text-xs" placeholder="Review note" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button size="sm" disabled={!dirty || rv.isPending} data-testid={`button-review-blindspot-${b.code}`}
            onClick={() => rv.mutate({ caseId, code: b.code, data: { reviewStatus: st, reviewNote: note || null } }, { onSuccess: () => { inv(getListBlindSpotsQueryKey(caseId)); toast({ title: "Review recorded" }); }, onError: (e) => toast({ title: "Failed", description: errMsg(e), variant: "destructive" }) })}>
            {rv.isPending && <Loader2 className="animate-spin" />}Record</Button>
        </div>
      ) : b.reviewNote && <div className="mt-2 text-xs italic text-muted-foreground">Review note: {b.reviewNote}</div>}
    </div>
  );
}

function Body({ c }: { c: Case }) {
  const caseId = useCaseId();
  const a = access(c);
  const [fam, setFam] = useState(true);
  const da = useGetDaCalculation(caseId, { includeFamily: fam });
  const bs = useListBlindSpots(caseId);
  const d = da.data;
  const comp = (code: string) => d?.components.find((x) => x.code === code);

  return (
    <div className="space-y-5">
      {c.caseType !== "lokayukta_da" && <Notice tone="brass">This case is not typed as a Karnataka Lokayukta DA investigation. The statement below is shown for reference only.</Notice>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="font-display text-xl">Disproportionate assets statement</h2><p className="text-xs text-muted-foreground">A working computation with every figure traced to its records. It is not a finding.</p></div>
        <label className="flex items-center gap-2 text-sm rounded-md border bg-card px-3 py-1.5"><Switch checked={fam} onCheckedChange={setFam} data-testid="switch-include-family" />Include family members</label>
      </div>
      {da.isLoading ? <LoadingRows rows={10} /> : da.isError ? <ErrorState error={da.error} onRetry={() => da.refetch()} /> : d && (
        !d.checkPeriodConfigured ? (
          <Panel><EmptyState icon={<Calculator className="h-6 w-6" />} title="No check period configured" body="Add a financial period of type check_period on the case overview. The DA statement is computed against it."
            action={<Link href={`/cases/${caseId}`} className="text-sm underline text-primary">Go to overview</Link>} /></Panel>
        ) : (
          <div className="grid xl:grid-cols-[1.5fr_1fr] gap-5">
            <div className="rounded-lg border bg-card shadow-sm overflow-hidden rise">
              <div className="px-5 py-4 border-b bg-sidebar text-sidebar-foreground flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[10.5px] uppercase tracking-[0.16em] text-sidebar-primary">Statement · check period</div>
                  <div className="font-display text-xl text-white num">{fdate(d.checkPeriodStart)} – {fdate(d.checkPeriodEnd)}</div>
                </div>
                <div className="flex gap-2 items-center">{c.isDemo && <DemoBadge />}<Tag tone="muted" className="!bg-white/10 !text-white/80 !border-white/15">Template {d.templateVersion}</Tag></div>
              </div>
              {(["A", "B", "C", "D"] as const).map((code) => {
                const x = comp(code);
                if (!x) return null;
                return (
                  <div key={code} className="border-b">
                    <div className="flex items-center gap-3 px-5 py-3 bg-muted/40">
                      <span className="h-7 w-7 rounded-md bg-primary text-primary-foreground grid place-items-center font-display text-base">{code}</span>
                      <span className="font-semibold text-sm flex-1">{x.label}</span>
                      <Money v={x.amount} className="text-base font-semibold" />
                    </div>
                    <table className="w-full text-[12.5px] dense-table">
                      <tbody>{x.lines.map((l, i) => (
                        <tr key={i}><td className="!pl-14 !whitespace-normal"><div>{l.label}</div><div className="text-[11px] text-muted-foreground">{l.basis}{l.sourceKind ? ` · ${human(l.sourceKind)} #${l.sourceId}` : ""}</div></td><td className="text-right align-top"><Money v={l.amount} /></td></tr>
                      ))}{!x.lines.length && <tr><td className="!pl-14 text-xs text-muted-foreground">No lines</td><td /></tr>}</tbody>
                    </table>
                  </div>
                );
              })}
              <div className="px-5 py-4 space-y-2 bg-accent/30">
                <div className="num text-xs text-muted-foreground">{d.formula}</div>
                {[
                  ["Assets acquired during period (B − A)", d.assetsAcquired],
                  ["Likely savings (C − D)", d.likelySavings],
                ].map(([k, v]) => <div key={k as string} className="flex justify-between text-sm"><span>{k}</span><Money v={v as number} /></div>)}
                <div className="flex justify-between text-sm font-semibold border-t pt-2"><span>Disproportion ((B − A) − (C − D))</span><Money v={d.disproportion} className={d.disproportion > 0 ? "text-destructive" : "text-[hsl(var(--success))]"} /></div>
                <div className="flex justify-between text-sm">
                  <span>As percentage of income (disproportion ÷ C × 100)</span>
                  <span className="num">{d.disproportionPercent == null ? "Not computable (C is zero)" : `${inr(d.disproportion)} ÷ ${inr(comp("C")?.amount)} × 100 = ${d.disproportionPercent.toFixed(2)}%`}</span>
                </div>
              </div>
              <div className="px-5 py-3 text-[11.5px] text-muted-foreground border-t">{d.disclaimer ?? "This computation organises figures from the record. It does not determine whether assets are disproportionate in law, which is for the competent authority and court."}</div>
            </div>
            <div className="space-y-4">
              <Panel title="Assumptions">{d.assumptions.length ? <ul className="text-sm space-y-1.5 list-disc pl-4">{d.assumptions.map((x, i) => <li key={i}>{x}</li>)}</ul> : <div className="text-xs text-muted-foreground">None stated</div>}</Panel>
              <Panel title={<span className="flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-[hsl(var(--brass))]" />Missing information</span>}>
                {d.missingInformation.length ? <ul className="text-sm space-y-1.5 list-disc pl-4">{d.missingInformation.map((x, i) => <li key={i}>{x}</li>)}</ul> : <div className="text-xs text-muted-foreground">Nothing flagged</div>}
              </Panel>
              <Notice>Figures flow from approved classifications, ledger entries, assets and liabilities. Change those records to change the statement — the calculation itself cannot be edited.</Notice>
            </div>
          </div>
        )
      )}
      <Panel title={<span className="flex items-center gap-1.5"><ScanSearch className="h-4 w-4 text-[hsl(var(--teal))]" />Blind-spot detection</span>} description="Patterns an investigator is likely to ask about. Listed for human examination; none of them is a conclusion." bodyClass="p-3">
        {bs.isLoading ? <LoadingRows /> : bs.isError ? <ErrorState error={bs.error} onRetry={() => bs.refetch()} /> : !bs.data?.length ? <EmptyState title="No blind spots detected" body="Re-check after importing more statements and recording assets." /> : (
          <div className="space-y-3 stagger">{bs.data.map((b) => <BlindSpotCard key={b.code} b={b} canReview={a.canEdit || a.isInvestigator} />)}</div>
        )}
      </Panel>
    </div>
  );
}

export default function Lokayukta() {
  return <CaseLayout>{(c) => <Body c={c} />}</CaseLayout>;
}
