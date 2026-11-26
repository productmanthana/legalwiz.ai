import { useEffect, useMemo, useState } from "react";
import { Search, Sparkles, Check, Loader2, Pencil, FileText, History, ListFilter, X } from "lucide-react";
import {
  useListTransactions, useListBankAccounts, useListFamilyMembers, useListDocuments, useSuggestClassifications, useApproveSuggestion, useUpdateTransaction, useGetTransaction, useGetCaseSummary,
  getListTransactionsQueryKey, getGetTransactionQueryKey, getGetCaseSummaryQueryKey, getGetDashboardSummaryQueryKey, getGetIncomeExpenditureScheduleQueryKey, getGetDaCalculationQueryKey,
  type Case, type Transaction, type ListTransactionsParams, type TransactionUpdate,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { CaseLayout, access, useCaseId } from "@/components/case-layout";
import { LoadingRows, ErrorState, EmptyState, Tag, StatusBadge, AiBadge, useInvalidate, Field, Notice, Money, nativeSelect, SavedTick, useSavedFlash, DemoBadge } from "@/components/common";
import { TXN_CATEGORIES, fdate, fdatetime, human, n, errMsg } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const blank = { accountId: "", category: "", reviewStatus: "", reconciliationStatus: "", financialYear: "", direction: "", minAmount: "", search: "" };

function useTxnInvalidate(caseId: number) {
  const inv = useInvalidate();
  return (id?: number) => inv(getListTransactionsQueryKey(caseId), getGetCaseSummaryQueryKey(caseId), getGetDashboardSummaryQueryKey(), getGetIncomeExpenditureScheduleQueryKey(caseId), getGetDaCalculationQueryKey(caseId), ...(id ? [getGetTransactionQueryKey(id)] : []));
}

function Drawer({ id, onClose, canEdit, isDemo }: { id: number | null; onClose: () => void; canEdit: boolean; isDemo: boolean }) {
  const caseId = useCaseId();
  const t = useGetTransaction(id ?? 0, { query: { enabled: !!id, queryKey: getGetTransactionQueryKey(id ?? 0) } });
  const fam = useListFamilyMembers(caseId);
  const docs = useListDocuments(caseId);
  const upd = useUpdateTransaction();
  const refresh = useTxnInvalidate(caseId);
  const { toast } = useToast();
  const [saved, flash] = useSavedFlash();
  const [f, setF] = useState({ explanation: "", tags: "", familyMemberId: "", reviewStatus: "pending", category: "", documentIds: [] as number[] });
  const [corr, setCorr] = useState<null | { description: string; debit: string; credit: string; txnDate: string; reason: string }>(null);
  const d = t.data;
  useEffect(() => {
    if (d) setF({ explanation: d.explanation ?? "", tags: d.tags.join(", "), familyMemberId: d.familyMemberId ? String(d.familyMemberId) : "", reviewStatus: d.reviewStatus, category: d.category ?? "", documentIds: d.documentIds });
    setCorr(null);
  }, [d?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (data: TransactionUpdate, after?: () => void) => d && upd.mutate({ transactionId: d.id, data }, {
    onSuccess: () => { flash(); refresh(d.id); after?.(); },
    onError: (e) => toast({ title: "Save failed", description: errMsg(e), variant: "destructive" }),
  });

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-display font-medium text-xl flex items-center gap-2">Transaction {isDemo && <DemoBadge />}</SheetTitle>
          <SheetDescription>{d ? `${d.bankName ?? ""} ${d.maskedAccountNumber ?? ""} · row ${d.sourceRow ?? "—"} · FY ${d.financialYear}` : "Loading"}</SheetDescription>
        </SheetHeader>
        {t.isLoading || !d ? <LoadingRows className="mt-6" /> : (
          <div className="mt-5 space-y-5 text-sm">
            <div className="rounded-lg border p-4 bg-muted/30">
              <div className="flex justify-between items-start gap-3">
                <div className="min-w-0"><div className="num text-xs text-muted-foreground">{fdate(d.txnDate)}{d.valueDate ? ` · value ${fdate(d.valueDate)}` : ""}</div><div className="mt-1 break-words">{d.description}</div>{d.referenceNumber && <div className="num text-[11px] text-muted-foreground mt-1">Ref {d.referenceNumber}</div>}</div>
                <div className="text-right shrink-0">
                  {d.credit > 0 && <div className="num text-lg text-[hsl(var(--teal))]">+<Money v={d.credit} /></div>}
                  {d.debit > 0 && <div className="num text-lg">−<Money v={d.debit} /></div>}
                  <div className="text-[11px] text-muted-foreground">Bal <Money v={d.balance} /></div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-3"><StatusBadge status={d.classificationStatus} /><StatusBadge status={d.reviewStatus} /><StatusBadge status={d.reconciliationStatus} />{d.isEdited && <Tag tone="brass">Corrected</Tag>}</div>
            </div>
            {d.isEdited && (
              <div className="rounded-md border border-dashed p-3">
                <div className="text-[10.5px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">Original imported values</div>
                <div className="grid grid-cols-2 gap-1 text-xs"><span>Date</span><span className="num">{fdate(d.original.txnDate)}</span><span>Description</span><span>{d.original.description}</span><span>Debit</span><Money v={d.original.debit} /><span>Credit</span><Money v={d.original.credit} /></div>
              </div>
            )}
            {d.classificationStatus === "suggested" && d.suggestedCategory && (
              <Notice tone="teal" icon={<Sparkles className="h-4 w-4 shrink-0 mt-px" />}>
                <div className="flex items-center gap-2 mb-1"><AiBadge label="Rule suggestion" /><b>{human(d.suggestedCategory)}</b></div>{d.suggestionReason}
              </Notice>
            )}
            <fieldset disabled={!canEdit} className="grid grid-cols-2 gap-3">
              <Field label="Category"><select className={nativeSelect} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} data-testid="select-drawer-category"><option value="">Unclassified</option>{TXN_CATEGORIES.map((c) => <option key={c} value={c}>{human(c)}</option>)}</select></Field>
              <Field label="Review status"><select className={nativeSelect} value={f.reviewStatus} onChange={(e) => setF({ ...f, reviewStatus: e.target.value })} data-testid="select-drawer-review"><option value="pending">Pending</option><option value="reviewed">Reviewed</option><option value="flagged">Flagged</option></select></Field>
              <Field label="Attributed to family member"><select className={nativeSelect} value={f.familyMemberId} onChange={(e) => setF({ ...f, familyMemberId: e.target.value })} data-testid="select-drawer-family"><option value="">— Subject —</option>{fam.data?.map((m) => <option key={m.id} value={m.id}>{m.name} ({human(m.relationship)})</option>)}</select></Field>
              <Field label="Tags" hint="Comma separated"><Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} data-testid="input-drawer-tags" /></Field>
              <Field label="Explanation" className="col-span-2"><Textarea rows={3} value={f.explanation} onChange={(e) => setF({ ...f, explanation: e.target.value })} placeholder="Source and nature of this entry, in plain words" data-testid="input-drawer-explanation" /></Field>
              <Field label="Linked documents" className="col-span-2">
                <div className="max-h-32 overflow-y-auto rounded border divide-y">
                  {!docs.data?.length ? <div className="p-2 text-xs text-muted-foreground">No documents in repository</div> : docs.data.filter((x) => !x.isArchived).map((doc) => (
                    <label key={doc.id} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                      <input type="checkbox" className="accent-[hsl(var(--teal))]" checked={f.documentIds.includes(doc.id)} onChange={(e) => setF({ ...f, documentIds: e.target.checked ? [...f.documentIds, doc.id] : f.documentIds.filter((i) => i !== doc.id) })} />
                      <FileText className="h-3.5 w-3.5 text-muted-foreground" />{doc.name}<span className="ml-auto text-muted-foreground">{human(doc.category)}</span>
                    </label>
                  ))}
                </div>
              </Field>
            </fieldset>
            {canEdit && (
              <div className="flex items-center justify-end gap-3">
                <SavedTick show={saved} />
                <Button onClick={() => save({ category: f.category || null, reviewStatus: f.reviewStatus as TransactionUpdate["reviewStatus"], familyMemberId: f.familyMemberId ? Number(f.familyMemberId) : null, explanation: f.explanation || null, tags: f.tags.split(",").map((x) => x.trim()).filter(Boolean), documentIds: f.documentIds })} disabled={upd.isPending} data-testid="button-save-transaction">
                  {upd.isPending && <Loader2 className="animate-spin" />}Save
                </Button>
              </div>
            )}
            {canEdit && (
              <div className="rounded-lg border">
                <div className="flex items-center justify-between px-3 py-2 border-b"><span className="text-xs font-semibold">Correct imported values</span>{!corr && <Button size="sm" variant="ghost" onClick={() => setCorr({ description: d.description, debit: String(d.debit), credit: String(d.credit), txnDate: d.txnDate.slice(0, 10), reason: "" })} data-testid="button-start-correction"><Pencil />Correct</Button>}</div>
                {corr ? (
                  <div className="p-3 grid grid-cols-2 gap-3">
                    <Field label="Date"><Input type="date" value={corr.txnDate} onChange={(e) => setCorr({ ...corr, txnDate: e.target.value })} /></Field>
                    <div />
                    <Field label="Debit"><Input className="num text-right" type="number" step="any" value={corr.debit} onChange={(e) => setCorr({ ...corr, debit: e.target.value })} /></Field>
                    <Field label="Credit"><Input className="num text-right" type="number" step="any" value={corr.credit} onChange={(e) => setCorr({ ...corr, credit: e.target.value })} /></Field>
                    <Field label="Description" className="col-span-2"><Input value={corr.description} onChange={(e) => setCorr({ ...corr, description: e.target.value })} /></Field>
                    <Field label="Reason for correction *" className="col-span-2" hint="Required. The original values remain on record."><Textarea rows={2} value={corr.reason} onChange={(e) => setCorr({ ...corr, reason: e.target.value })} data-testid="input-correction-reason" /></Field>
                    <div className="col-span-2 flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setCorr(null)}>Cancel</Button>
                      <Button size="sm" disabled={!corr.reason.trim() || upd.isPending} data-testid="button-save-correction"
                        onClick={() => save({ correctedTxnDate: corr.txnDate, correctedDebit: Number(corr.debit), correctedCredit: Number(corr.credit), correctedDescription: corr.description, correctionReason: corr.reason.trim() }, () => setCorr(null))}>Record correction</Button>
                    </div>
                  </div>
                ) : <div className="p-3 text-xs text-muted-foreground">Corrections require a stated reason and are logged with the original values.</div>}
              </div>
            )}
            <div>
              <div className="flex items-center gap-1.5 text-xs font-semibold mb-2"><History className="h-3.5 w-3.5" />History</div>
              {!d.history.length ? <div className="text-xs text-muted-foreground">No changes since import.</div> : (
                <ol className="border-l ml-1.5 space-y-2.5">
                  {d.history.map((h) => (
                    <li key={h.id} className="pl-3 relative text-xs">
                      <span className="absolute -left-[4px] top-1 h-2 w-2 rounded-full bg-[hsl(var(--teal))]" />
                      <div><b>{h.userName ?? "System"}</b> {h.summary ?? human(h.action)}</div>
                      {(h.previousValue || h.newValue) && <div className="num text-[11px] mt-0.5"><span className="line-through text-muted-foreground">{h.previousValue}</span> {h.newValue && <span>→ {h.newValue}</span>}</div>}
                      <div className="text-muted-foreground num text-[10.5px]">{fdatetime(h.createdAt)}</div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Body({ c }: { c: Case }) {
  const caseId = useCaseId();
  const a = access(c);
  const { toast } = useToast();
  const [flt, setFlt] = useState(blank);
  const [search, setSearch] = useState("");
  useEffect(() => { const t = setTimeout(() => setFlt((p) => ({ ...p, search })), 300); return () => clearTimeout(t); }, [search]);
  const params = useMemo<ListTransactionsParams>(() => ({
    accountId: flt.accountId ? Number(flt.accountId) : undefined, category: flt.category || undefined, reviewStatus: flt.reviewStatus || undefined,
    reconciliationStatus: flt.reconciliationStatus || undefined, financialYear: flt.financialYear || undefined, direction: (flt.direction || undefined) as ListTransactionsParams["direction"],
    minAmount: flt.minAmount ? Number(flt.minAmount) : undefined, search: flt.search || undefined,
  }), [flt]);
  const q = useListTransactions(caseId, params);
  const accts = useListBankAccounts(caseId);
  const summary = useGetCaseSummary(caseId);
  const suggest = useSuggestClassifications(); const approve = useApproveSuggestion(); const upd = useUpdateTransaction();
  const refresh = useTxnInvalidate(caseId);
  const [openId, setOpenId] = useState<number | null>(null);
  const [busyRow, setBusyRow] = useState<number | null>(null);
  const [flashRow, setFlashRow] = useState<number | null>(null);
  const active = Object.entries(flt).filter(([, v]) => v).length;
  const rows = q.data ?? [];
  const totals = rows.reduce((s, t) => ({ cr: s.cr + t.credit, dr: s.dr + t.debit }), { cr: 0, dr: 0 });

  const setCat = (t: Transaction, category: string) => {
    setBusyRow(t.id);
    upd.mutate({ transactionId: t.id, data: { category: category || null } }, {
      onSuccess: () => { refresh(); setFlashRow(t.id); setTimeout(() => setFlashRow(null), 1200); },
      onError: (e) => toast({ title: "Could not classify", description: errMsg(e), variant: "destructive" }), onSettled: () => setBusyRow(null),
    });
  };

  const sel = (k: keyof typeof blank, label: string, options: { v: string; l: string }[]) => (
    <select className={cn(nativeSelect, "h-8 text-xs", flt[k] && "border-[hsl(var(--teal))] bg-accent/40")} value={flt[k]} onChange={(e) => setFlt({ ...flt, [k]: e.target.value })} data-testid={`filter-${k}`}>
      <option value="">{label}</option>{options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-xl">Ledger</h2>
          <p className="text-xs text-muted-foreground">Every imported entry across all accounts. Categories are suggestions until a person approves them.</p>
        </div>
        {a.canEdit && (
          <Button variant="outline" disabled={suggest.isPending} data-testid="button-suggest"
            onClick={() => suggest.mutate({ caseId }, { onSuccess: (r) => { refresh(); toast({ title: `${n(r.count)} suggestions created`, description: r.message ?? "Rule-based. Review each before approving." }); }, onError: (e) => toast({ title: "Failed", description: errMsg(e), variant: "destructive" }) })}>
            {suggest.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}Suggest classifications
          </Button>
        )}
      </div>
      <div className="rounded-lg border bg-card p-2.5 flex flex-wrap items-center gap-2">
        <ListFilter className="h-4 w-4 text-muted-foreground ml-1" />
        <div className="relative"><Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" /><Input className="pl-7 h-8 w-56 text-xs" placeholder="Search description or ref" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search" /></div>
        {sel("accountId", "All accounts", (accts.data ?? []).map((x) => ({ v: String(x.id), l: `${x.bankName} ${x.maskedAccountNumber}` })))}
        {sel("category", "Any category", [{ v: "uncategorised", l: "Unclassified" }, ...TXN_CATEGORIES.map((x) => ({ v: x, l: human(x) }))])}
        {sel("reviewStatus", "Any review", ["pending", "reviewed", "flagged"].map((x) => ({ v: x, l: human(x) })))}
        {sel("reconciliationStatus", "Any reconciliation", ["unreconciled", "partially_reconciled", "reconciled", "manual_review"].map((x) => ({ v: x, l: human(x) })))}
        {sel("financialYear", "All FY", (summary.data?.financialYears ?? []).map((x) => ({ v: x, l: `FY ${x}` })))}
        {sel("direction", "Credit + debit", [{ v: "credit", l: "Credits only" }, { v: "debit", l: "Debits only" }])}
        <Input className="h-8 w-32 text-xs num" type="number" placeholder="Min ₹" value={flt.minAmount} onChange={(e) => setFlt({ ...flt, minAmount: e.target.value })} data-testid="filter-minAmount" />
        {active > 0 && <Button size="sm" variant="ghost" onClick={() => { setFlt(blank); setSearch(""); }} data-testid="button-clear-filters"><X />Clear {active}</Button>}
      </div>
      <div className="rounded-lg border bg-card overflow-hidden">
        {q.isLoading ? <div className="p-4"><LoadingRows rows={12} /></div> : q.isError ? <div className="p-4"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div> : !rows.length ? (
          <EmptyState title={active ? "No entries match" : "No transactions imported"} body={active ? "Loosen a filter to see more." : "Import a statement from the Accounts tab."} />
        ) : (
          <div className="overflow-auto max-h-[calc(100dvh-280px)]">
            <table className="w-full text-[12.5px] dense-table">
              <thead className="bg-muted sticky top-0 z-[1]"><tr>
                <th className="text-left">Date</th><th className="text-left">Account</th><th className="text-left w-full">Description</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right">Balance</th><th className="text-left">FY</th><th className="text-left">Category</th><th className="text-left">Status</th>
              </tr></thead>
              <tbody>
                {rows.map((t, i) => (
                  <tr key={t.id} className={cn("cursor-pointer", flashRow === t.id && "!bg-accent")} style={i < 30 ? { animation: `rise .35s ${i * 12}ms both` } : undefined} onClick={() => setOpenId(t.id)} data-testid={`row-txn-${t.id}`}>
                    <td className="num text-muted-foreground">{fdate(t.txnDate)}</td>
                    <td className="num text-[11px] text-muted-foreground">{t.maskedAccountNumber ?? t.bankAccountId}</td>
                    <td className="max-w-[380px] truncate" title={t.description}>
                      {t.description}{t.isEdited && <Tag tone="brass" className="ml-1.5">Corrected</Tag>}{t.documentIds.length > 0 && <FileText className="inline h-3 w-3 ml-1.5 text-[hsl(var(--teal))]" />}
                    </td>
                    <td className="text-right"><Money v={t.debit} dim /></td>
                    <td className="text-right text-[hsl(var(--teal))]"><Money v={t.credit} dim /></td>
                    <td className="text-right text-muted-foreground"><Money v={t.balance} dim /></td>
                    <td className="num text-[11px]">{t.financialYear}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {t.classificationStatus === "suggested" && t.suggestedCategory ? (
                        <div className="flex items-center gap-1.5" title={t.suggestionReason ?? undefined}>
                          <AiBadge label={human(t.suggestedCategory)} />
                          {a.canEdit && <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={busyRow === t.id} data-testid={`button-approve-${t.id}`}
                            onClick={() => { setBusyRow(t.id); approve.mutate({ transactionId: t.id }, { onSuccess: () => { refresh(); setFlashRow(t.id); setTimeout(() => setFlashRow(null), 1200); }, onError: (e) => toast({ title: "Approve failed", description: errMsg(e), variant: "destructive" }), onSettled: () => setBusyRow(null) }); }}>
                            {busyRow === t.id ? <Loader2 className="animate-spin" /> : <Check />}Approve</Button>}
                        </div>
                      ) : a.canEdit ? (
                        <select className={cn("h-7 rounded border bg-transparent px-1.5 text-[11.5px] max-w-[170px]", !t.category && "text-muted-foreground border-dashed")} value={t.category ?? ""} disabled={busyRow === t.id} onChange={(e) => setCat(t, e.target.value)} data-testid={`select-category-${t.id}`}>
                          <option value="">Unclassified</option>{TXN_CATEGORIES.map((x) => <option key={x} value={x}>{human(x)}</option>)}
                        </select>
                      ) : <span className="text-xs">{human(t.category)}</span>}
                    </td>
                    <td><div className="flex gap-1"><StatusBadge status={t.reviewStatus} />{t.reconciliationStatus !== "unreconciled" && <StatusBadge status={t.reconciliationStatus} />}</div></td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-muted sticky bottom-0"><tr className="font-semibold">
                <td colSpan={3} className="text-xs">{n(rows.length)} entries shown</td>
                <td className="text-right"><Money v={totals.dr} /></td><td className="text-right text-[hsl(var(--teal))]"><Money v={totals.cr} /></td><td colSpan={4} />
              </tr></tfoot>
            </table>
          </div>
        )}
      </div>
      <Drawer id={openId} onClose={() => setOpenId(null)} canEdit={a.canEdit} isDemo={c.isDemo} />
    </div>
  );
}

export default function Transactions() {
  return <CaseLayout>{(c) => <Body c={c} />}</CaseLayout>;
}
