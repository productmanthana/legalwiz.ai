import { Fragment, useState } from "react";
import { ChevronRight, Plus, Pencil, Trash2, BookOpen } from "lucide-react";
import {
  useGetIncomeExpenditureSchedule, useListLedgerEntries, useCreateLedgerEntry, useUpdateLedgerEntry, useDeleteLedgerEntry, useListFamilyMembers,
  getGetIncomeExpenditureScheduleQueryKey, getListLedgerEntriesQueryKey, getGetDaCalculationQueryKey,
  type Case, type LedgerEntry, type LedgerEntryInput, type ScheduleLine, type GetIncomeExpenditureScheduleGranularity,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { CaseLayout, access, useCaseId } from "@/components/case-layout";
import { Panel, LoadingRows, ErrorState, EmptyState, Tag, StatusBadge, useInvalidate, Notice, Money, ConfirmButton, Stat } from "@/components/common";
import { EntityFormDialog, type FieldDef } from "@/components/entity-form";
import { TXN_CATEGORIES, fdate, human, inrCompact, errMsg, opts } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { k: "income", t: "Income", d: "Earnings: salary, business, rent, agriculture, interest" },
  { k: "receipt", t: "Receipts (not income)", d: "Loans, transfers, sale proceeds, gifts, inheritance — money in that is not earned" },
  { k: "expenditure", t: "Expenditure", d: "Household, education, medical, insurance, tax, repayments" },
] as const;

function Line({ l }: { l: ScheduleLine }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="cursor-pointer" onClick={() => setOpen(!open)} data-testid={`row-line-${l.section}-${l.category}`}>
        <td><span className="flex items-center gap-1.5"><ChevronRight className={cn("h-3.5 w-3.5 transition-transform text-muted-foreground", open && "rotate-90")} />{human(l.category)}<span className="text-[10.5px] text-muted-foreground">({l.sources.length} sources)</span></span></td>
        <td className="text-right"><Money v={l.amount} /></td>
      </tr>
      {open && l.sources.map((s, i) => (
        <tr key={i} className="bg-muted/40 text-[11.5px]">
          <td className="!pl-9"><span className="flex items-center gap-2"><Tag>{human(s.kind)} #{s.id}</Tag><span className="num text-muted-foreground">{fdate(s.date)}</span><span className="truncate max-w-[360px]">{s.label}</span></span></td>
          <td className="text-right text-muted-foreground"><Money v={s.amount} /></td>
        </tr>
      ))}
    </>
  );
}

function Body({ c }: { c: Case }) {
  const caseId = useCaseId();
  const a = access(c);
  const inv = useInvalidate();
  const { toast } = useToast();
  const [gran, setGran] = useState<GetIncomeExpenditureScheduleGranularity>("annual");
  const sch = useGetIncomeExpenditureSchedule(caseId, { granularity: gran });
  const led = useListLedgerEntries(caseId);
  const fam = useListFamilyMembers(caseId);
  const cr = useCreateLedgerEntry(); const up = useUpdateLedgerEntry(); const del = useDeleteLedgerEntry();
  const [form, setForm] = useState<{ open: boolean; edit?: LedgerEntry }>({ open: false });
  const refresh = () => inv(getListLedgerEntriesQueryKey(caseId), getGetIncomeExpenditureScheduleQueryKey(caseId), getGetDaCalculationQueryKey(caseId));
  const fail = (e: unknown) => toast({ title: "Failed", description: errMsg(e), variant: "destructive" });

  const fields: FieldDef[] = [
    { name: "entryType", label: "Section", type: "select", options: [{ value: "income", label: "Income" }, { value: "receipt", label: "Receipt (not income)" }, { value: "expenditure", label: "Expenditure" }] },
    { name: "category", label: "Category", type: "select", options: opts([...TXN_CATEGORIES, "interest_income", "pension", "cash_in_hand"]) },
    { name: "amount", label: "Amount (₹)", type: "number", required: true },
    { name: "entryDate", label: "Date", type: "date", required: true },
    { name: "description", label: "Description", full: true },
    { name: "familyMemberId", label: "Family member", type: "select", nullableSelect: true, options: (fam.data ?? []).map((f) => ({ value: String(f.id), label: f.name })) },
    { name: "verificationStatus", label: "Evidence status", type: "select", options: opts(["user_provided", "documented", "verified"]) },
    { name: "sourceReference", label: "Source reference", full: true, placeholder: "e.g. Form 16 FY 2016-17, employer TAN" },
  ];

  const t = sch.data?.totals;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="font-display text-xl">Income & expenditure schedule</h2><p className="text-xs text-muted-foreground">Expand any figure to see the transactions and entries behind it.</p></div>
        <div className="inline-flex rounded-md border p-0.5 bg-card">
          {(["annual", "quarterly", "monthly"] as const).map((g) => (
            <button key={g} onClick={() => setGran(g)} className={cn("px-3 py-1 text-xs rounded", gran === g ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")} data-testid={`button-granularity-${g}`}>{human(g)}</button>
          ))}
        </div>
      </div>
      {t && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 stagger">
          <Stat label="Total income" value={inrCompact(t.income)} tone="teal" />
          <Stat label="Total receipts" value={inrCompact(t.receipts)} hint="Not income" />
          <Stat label="Total expenditure" value={inrCompact(t.expenditure)} />
          <Stat label="Excluded transfers" value={inrCompact(t.excludedTransfers)} hint="Own-account movement" />
        </div>
      )}
      {sch.isLoading ? <LoadingRows rows={8} /> : sch.isError ? <ErrorState error={sch.error} onRetry={() => sch.refetch()} /> : !sch.data?.periods.length ? (
        <Panel><EmptyState title="Nothing to schedule yet" body="Classify transactions or add manual entries to build the schedule." /></Panel>
      ) : (
        <div className="space-y-4">
          {sch.data.periods.map((p) => (
            <Panel key={p.period} title={<span className="font-display text-base">{gran === "annual" ? `FY ${p.period}` : p.period}</span>}
              actions={<span className="text-xs num text-muted-foreground">Inc {inrCompact(p.totalIncome)} · Rec {inrCompact(p.totalReceipts)} · Exp {inrCompact(p.totalExpenditure)}</span>} bodyClass="p-0">
              <div className="grid lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x">
                {SECTIONS.map((s) => {
                  const lines = p.lines.filter((l) => l.section === s.k);
                  const total = s.k === "income" ? p.totalIncome : s.k === "receipt" ? p.totalReceipts : p.totalExpenditure;
                  return (
                    <div key={s.k}>
                      <div className={cn("px-3 py-2 border-b", s.k === "receipt" && "bg-[hsl(var(--brass-soft))]/50")}>
                        <div className="text-xs font-semibold">{s.t}</div><div className="text-[10.5px] text-muted-foreground">{s.d}</div>
                      </div>
                      <table className="w-full text-[12.5px] dense-table">
                        <tbody>
                          {!lines.length ? <tr><td className="text-xs text-muted-foreground" colSpan={2}>None recorded</td></tr> : lines.map((l) => <Fragment key={l.category}><Line l={l} /></Fragment>)}
                        </tbody>
                        <tfoot><tr className="border-t font-semibold"><td className="text-xs">Total</td><td className="text-right"><Money v={total} /></td></tr></tfoot>
                      </table>
                    </div>
                  );
                })}
              </div>
            </Panel>
          ))}
          {!!sch.data.notes.length && <Notice>{sch.data.notes.map((x, i) => <div key={i}>{x}</div>)}</Notice>}
        </div>
      )}
      <Panel title="Manual ledger entries" description="Income and expenditure not visible in bank statements — cash salary, agricultural income, household spending estimates." bodyClass="p-0"
        actions={a.canEdit && <Button size="sm" onClick={() => setForm({ open: true })} data-testid="button-add-entry"><Plus />Add entry</Button>}>
        {led.isLoading ? <div className="p-4"><LoadingRows rows={3} /></div> : led.isError ? <div className="p-4"><ErrorState error={led.error} /></div> : !led.data?.length ? (
          <EmptyState icon={<BookOpen className="h-6 w-6" />} title="No manual entries" />
        ) : (
          <div className="overflow-x-auto"><table className="w-full text-[12.5px] dense-table">
            <thead className="bg-muted/50"><tr><th className="text-left">Date</th><th className="text-left">FY</th><th className="text-left">Section</th><th className="text-left">Category</th><th className="text-left">Description</th><th className="text-left">Evidence</th><th className="text-right">Amount</th><th /></tr></thead>
            <tbody>{led.data.map((e) => (
              <tr key={e.id} data-testid={`row-entry-${e.id}`}>
                <td className="num">{fdate(e.entryDate)}</td><td className="num">{e.financialYear}</td>
                <td><Tag tone={e.entryType === "income" ? "teal" : e.entryType === "receipt" ? "brass" : "navy"}>{human(e.entryType)}</Tag></td>
                <td>{human(e.category)}</td><td className="max-w-[260px] truncate">{e.description ?? "—"}{e.sourceReference && <span className="text-muted-foreground"> · {e.sourceReference}</span>}</td>
                <td><StatusBadge status={e.verificationStatus} /></td>
                <td className="text-right"><Money v={e.amount} /></td>
                <td className="text-right">{a.canEdit && <div className="flex justify-end">
                  <Button size="icon" variant="ghost" onClick={() => setForm({ open: true, edit: e })} data-testid={`button-edit-entry-${e.id}`}><Pencil /></Button>
                  <ConfirmButton title="Delete entry?" description="It will be removed from the schedule." onConfirm={() => del.mutate({ entryId: e.id }, { onSuccess: refresh, onError: fail })} trigger={<Button size="icon" variant="ghost" data-testid={`button-delete-entry-${e.id}`}><Trash2 /></Button>} />
                </div>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      <EntityFormDialog open={form.open} onOpenChange={(o) => setForm({ open: o, edit: form.edit })} title={form.edit ? "Edit entry" : "Add ledger entry"} fields={fields}
        initial={form.edit ? (form.edit as unknown as Record<string, unknown>) : { entryType: "income", category: "salary", verificationStatus: "user_provided" }} pending={cr.isPending || up.isPending}
        onSubmit={(v) => {
          const data = v as unknown as LedgerEntryInput;
          const cb = { onSuccess: () => { setForm({ open: false }); refresh(); }, onError: fail };
          form.edit ? up.mutate({ entryId: form.edit.id, data }, cb) : cr.mutate({ caseId, data }, cb);
        }} />
    </div>
  );
}

export default function IncomeExpenditure() {
  return <CaseLayout>{(c) => <Body c={c} />}</CaseLayout>;
}
