import { useState } from "react";
import { GitCompareArrows, Loader2, Plus, Check, X, SplitSquareHorizontal, ArrowRight, Search } from "lucide-react";
import {
  useGetReconciliationSummary, useRunReconciliation, useListMatches, useReviewMatch, useCreateManualMatch, useListTransactions,
  getGetReconciliationSummaryQueryKey, getListMatchesQueryKey, getListTransactionsQueryKey, getGetCaseSummaryQueryKey, getGetIncomeExpenditureScheduleQueryKey, getGetDaCalculationQueryKey, getGetDashboardSummaryQueryKey,
  type Case, type TransactionMatch, type Transaction, type ManualMatchInputMatchType, type MatchReviewStatus,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { CaseLayout, access, useCaseId } from "@/components/case-layout";
import { Panel, Stat, LoadingRows, ErrorState, EmptyState, Tag, StatusBadge, useInvalidate, Notice, Money, nativeSelect, Field } from "@/components/common";
import { MATCH_TYPES, fdate, human, inr, n, errMsg } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function useRefresh(caseId: number) {
  const inv = useInvalidate();
  return () => inv(getGetReconciliationSummaryQueryKey(caseId), getListMatchesQueryKey(caseId), getListTransactionsQueryKey(caseId), getGetCaseSummaryQueryKey(caseId), getGetIncomeExpenditureScheduleQueryKey(caseId), getGetDaCalculationQueryKey(caseId), getGetDashboardSummaryQueryKey());
}

function TxnLine({ t }: { t: Transaction }) {
  return (
    <div className="flex items-center gap-2 text-xs py-1">
      <span className="num text-muted-foreground w-[78px] shrink-0">{fdate(t.txnDate)}</span>
      <span className="num text-[10.5px] text-muted-foreground shrink-0">{t.maskedAccountNumber}</span>
      <span className="truncate flex-1" title={t.description}>{t.description}</span>
      <span className={cn("num shrink-0", t.credit ? "text-[hsl(var(--teal))]" : "")}>{t.credit ? `+${inr(t.credit)}` : `−${inr(t.debit)}`}</span>
    </div>
  );
}

function MatchCard({ m, canReview }: { m: TransactionMatch; canReview: boolean }) {
  const caseId = useCaseId();
  const review = useReviewMatch();
  const refresh = useRefresh(caseId);
  const { toast } = useToast();
  const [note, setNote] = useState(m.reviewNote ?? "");
  const [showNote, setShowNote] = useState(false);
  const act = (status: MatchReviewStatus) => review.mutate({ matchId: m.id, data: { status, reviewNote: note || null } }, {
    onSuccess: () => { refresh(); toast({ title: `Match ${human(status).toLowerCase()}` }); }, onError: (e) => toast({ title: "Review failed", description: errMsg(e), variant: "destructive" }),
  });
  return (
    <div className="rounded-lg border bg-card shadow-xs" data-testid={`card-match-${m.id}`}>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b">
        <span className="font-semibold text-sm">{human(m.matchType)}</span>
        <StatusBadge status={m.status} />
        <Tag tone={m.createdBy === "engine" ? "teal" : "navy"}>{m.createdBy === "engine" ? "Engine suggestion" : "Manual"}</Tag>
        <span className="ml-auto flex items-center gap-3 text-xs">
          <span><Money v={m.amount} className="font-semibold" /></span>
          {m.dateGapDays !== undefined && <span className="text-muted-foreground">{m.dateGapDays}d gap</span>}
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-14 rounded-full bg-muted overflow-hidden"><span className="block h-full bg-[hsl(var(--teal))]" style={{ width: `${m.confidence}%` }} /></span><span className="num">{m.confidence}%</span></span>
        </span>
      </div>
      <div className="grid md:grid-cols-[1fr_auto_1fr] gap-2 px-4 py-2 items-center">
        <div><div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Source</div>{m.sourceTransactions.map((t) => <TxnLine key={t.id} t={t} />)}</div>
        <ArrowRight className="h-4 w-4 text-muted-foreground hidden md:block" />
        <div><div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Corresponding</div>{m.targetTransactions.map((t) => <TxnLine key={t.id} t={t} />)}</div>
      </div>
      <div className="px-4 pb-3 flex flex-wrap items-center gap-1.5">
        {m.evidence.map((e, i) => <Tag key={i}>{e}</Tag>)}
        {m.reviewNote && !showNote && <span className="text-xs text-muted-foreground ml-2 italic">Note: {m.reviewNote}</span>}
      </div>
      {canReview && (
        <div className="px-4 pb-3 space-y-2">
          {showNote && <Textarea rows={2} placeholder="Review note (recorded with the decision)" value={note} onChange={(e) => setNote(e.target.value)} data-testid={`input-note-${m.id}`} />}
          <div className="flex flex-wrap gap-1.5 justify-end">
            <Button size="sm" variant="ghost" onClick={() => setShowNote(!showNote)}>{showNote ? "Hide note" : "Add note"}</Button>
            <Button size="sm" variant="outline" disabled={review.isPending} onClick={() => act("rejected")} data-testid={`button-reject-${m.id}`}><X />Reject</Button>
            <Button size="sm" variant="outline" disabled={review.isPending} onClick={() => act("partial")} data-testid={`button-partial-${m.id}`}><SplitSquareHorizontal />Partial</Button>
            <Button size="sm" disabled={review.isPending} onClick={() => act("approved")} data-testid={`button-approve-${m.id}`}><Check />Approve</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Picker({ label, selected, setSelected, caseId }: { label: string; selected: number[]; setSelected: (v: number[]) => void; caseId: number }) {
  const [s, setS] = useState("");
  const q = useListTransactions(caseId, { search: s || undefined });
  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between px-2 py-1.5 border-b"><span className="text-xs font-semibold">{label}</span><Tag tone={selected.length ? "teal" : "muted"}>{selected.length} selected</Tag></div>
      <div className="p-2 relative"><Search className="absolute left-4 top-4 h-3.5 w-3.5 text-muted-foreground" /><Input className="h-8 pl-7 text-xs" placeholder="Search" value={s} onChange={(e) => setS(e.target.value)} /></div>
      <div className="max-h-60 overflow-y-auto divide-y">
        {q.isLoading ? <LoadingRows rows={4} className="p-2" /> : (q.data ?? []).slice(0, 150).map((t) => (
          <label key={t.id} className={cn("flex items-center gap-2 px-2 cursor-pointer", selected.includes(t.id) && "bg-accent/50")}>
            <input type="checkbox" className="accent-[hsl(var(--teal))]" checked={selected.includes(t.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, t.id] : selected.filter((x) => x !== t.id))} />
            <div className="flex-1 min-w-0"><TxnLine t={t} /></div>
          </label>
        ))}
      </div>
    </div>
  );
}

function Body({ c }: { c: Case }) {
  const caseId = useCaseId();
  const a = access(c);
  const { toast } = useToast();
  const [status, setStatus] = useState("");
  const sum = useGetReconciliationSummary(caseId);
  const matches = useListMatches(caseId, { status: status || undefined });
  const run = useRunReconciliation(); const manual = useCreateManualMatch();
  const refresh = useRefresh(caseId);
  const [open, setOpen] = useState(false);
  const [src, setSrc] = useState<number[]>([]); const [tgt, setTgt] = useState<number[]>([]);
  const [mt, setMt] = useState<ManualMatchInputMatchType>("own_account_transfer"); const [note, setNote] = useState("");
  const s = sum.data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="font-display text-xl">Reconciliation</h2><p className="text-xs text-muted-foreground max-w-2xl">Matching links movements between accounts so the same money is not counted twice. A match describes how funds moved; it does not establish their legal character.</p></div>
        {a.canEdit && <div className="flex gap-2">
          <Button variant="outline" onClick={() => setOpen(true)} data-testid="button-manual-match"><Plus />Manual match</Button>
          <Button disabled={run.isPending} onClick={() => run.mutate({ caseId }, { onSuccess: (r) => { refresh(); toast({ title: `${n(r.count)} candidate matches`, description: r.message ?? "Review each before approving." }); }, onError: (e) => toast({ title: "Run failed", description: errMsg(e), variant: "destructive" }) })} data-testid="button-run-matching">
            {run.isPending ? <Loader2 className="animate-spin" /> : <GitCompareArrows />}Run matching engine</Button>
        </div>}
      </div>
      {sum.isLoading ? <LoadingRows rows={2} /> : sum.isError ? <ErrorState error={sum.error} onRetry={() => sum.refetch()} /> : s && (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 stagger">
          <Stat label="Reconciled" value={n(s.reconciled)} tone="teal" />
          <Stat label="Partially" value={n(s.partiallyReconciled)} />
          <Stat label="Unreconciled" value={n(s.unreconciled)} tone={s.unreconciled ? "brass" : undefined} />
          <Stat label="Manual review" value={n(s.manualReview)} tone={s.manualReview ? "danger" : undefined} />
          <Stat label="Suggested" value={n(s.suggestedMatches)} />
          <Stat label="Approved" value={n(s.approvedMatches)} />
          <Stat label="Rejected" value={n(s.rejectedMatches)} />
          <Stat label="Excluded transfers" value={inr(s.excludedTransferAmount, true)} hint="Kept out of income and expenditure to prevent double counting" tone="teal" />
        </div>
      )}
      <Panel title="Matches" actions={
        <select className={cn(nativeSelect, "h-8 text-xs")} value={status} onChange={(e) => setStatus(e.target.value)} data-testid="filter-match-status">
          <option value="">All statuses</option>{["suggested", "approved", "partial", "rejected"].map((x) => <option key={x} value={x}>{human(x)}</option>)}
        </select>} bodyClass="p-3 space-y-3">
        {matches.isLoading ? <LoadingRows /> : matches.isError ? <ErrorState error={matches.error} onRetry={() => matches.refetch()} /> : !matches.data?.length ? (
          <EmptyState icon={<GitCompareArrows className="h-6 w-6" />} title="No matches" body={a.canEdit ? "Run the matching engine to propose own-account transfers, cash cycles and loan pairs." : "No matches have been recorded for this case."} />
        ) : <div className="space-y-3 stagger">{matches.data.map((m) => <MatchCard key={m.id} m={m} canReview={a.canEdit} />)}</div>}
      </Panel>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[92dvh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display font-medium text-xl">Create manual match</DialogTitle><DialogDescription>Select the outgoing side and the corresponding side. Your note is stored with the match.</DialogDescription></DialogHeader>
          <div className="grid md:grid-cols-2 gap-3">
            <Picker label="Source transactions" selected={src} setSelected={setSrc} caseId={caseId} />
            <Picker label="Corresponding transactions" selected={tgt} setSelected={setTgt} caseId={caseId} />
            <Field label="Match type"><select className={nativeSelect} value={mt} onChange={(e) => setMt(e.target.value as ManualMatchInputMatchType)} data-testid="select-match-type">{MATCH_TYPES.map((x) => <option key={x} value={x}>{human(x)}</option>)}</select></Field>
            <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} data-testid="input-match-note" /></Field>
          </div>
          <Notice>Matching does not establish the legal character of a transaction. It records how funds appear to have moved.</Notice>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!src.length || !tgt.length || manual.isPending} data-testid="button-create-match"
              onClick={() => manual.mutate({ caseId, data: { matchType: mt, sourceTransactionIds: src, targetTransactionIds: tgt, reviewNote: note || null } }, { onSuccess: () => { setOpen(false); setSrc([]); setTgt([]); setNote(""); refresh(); }, onError: (e) => toast({ title: "Could not create", description: errMsg(e), variant: "destructive" }) })}>
              {manual.isPending && <Loader2 className="animate-spin" />}Create match</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Reconciliation() {
  return <CaseLayout>{(c) => <Body c={c} />}</CaseLayout>;
}
