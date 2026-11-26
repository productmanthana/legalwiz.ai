import { useState } from "react";
import { Plus, Pencil, Trash2, Landmark } from "lucide-react";
import {
  useGetIncomeTaxComparison, useListTaxDeclarations, useCreateTaxDeclaration, useUpdateTaxDeclaration, useDeleteTaxDeclaration, useListDocuments,
  getGetIncomeTaxComparisonQueryKey, getListTaxDeclarationsQueryKey,
  type Case, type TaxDeclaration, type TaxDeclarationInput, type TaxYearComparison,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { CaseLayout, access, useCaseId } from "@/components/case-layout";
import { Panel, LoadingRows, ErrorState, EmptyState, Tag, useInvalidate, Notice, Money, ConfirmButton, Stat } from "@/components/common";
import { EntityFormDialog, type FieldDef } from "@/components/entity-form";
import { human, inrCompact, errMsg, opts } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";

const SOURCES = ["itr", "ais", "tis", "form_26as", "form_16"] as const;
const SOURCE_LABEL: Record<string, string> = { itr: "ITR", ais: "AIS", tis: "TIS", form_26as: "Form 26AS", form_16: "Form 16" };
const HEADS = ["salary", "house_property", "business_profession", "capital_gains", "other_sources", "exempt_income"];
const STATUS_TONE = { consistent: "success", difference: "danger", itr_missing: "brass", no_data: "muted" } as const;

function YearPanel({ y }: { y: TaxYearComparison }) {
  const heads = y.heads.filter((h) => h.status !== "no_data");
  return (
    <Panel title={<span className="font-display text-base">FY {y.financialYear} · AY {y.assessmentYear}</span>}
      actions={<span className="text-xs num text-muted-foreground">Credits {inrCompact(y.totalCredits)} · Declared {y.declaredIncome === null ? "—" : inrCompact(y.declaredIncome)}</span>} bodyClass="p-0">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border border-b text-[11.5px]">
        {[["Income credits", y.incomeCredits], ["Receipts (not income)", y.receiptCredits], ["Unclassified credits", y.unclassifiedCredits], ["Excluded transfers", y.excludedTransfers]].map(([l, v]) => (
          <div key={l as string} className="bg-card px-3 py-2"><div className="text-muted-foreground">{l}</div><Money v={v as number} /></div>
        ))}
      </div>
      {!heads.length ? <div className="p-4 text-xs text-muted-foreground">No income heads with data for this year.</div> : (
        <div className="overflow-x-auto"><table className="w-full text-[12.5px] dense-table" data-testid={`table-tax-${y.financialYear}`}>
          <thead className="bg-muted/50"><tr>
            <th className="text-left">Head</th><th className="text-right">Bank credits</th>
            {SOURCES.map((s) => <th key={s} className="text-right">{SOURCE_LABEL[s]}</th>)}
            <th className="text-right">Bank − ITR</th><th className="text-right">AIS/26AS − ITR</th><th className="text-left">Status</th>
          </tr></thead>
          <tbody>{heads.map((h) => (
            <tr key={h.head} data-testid={`row-tax-${y.financialYear}-${h.head}`}>
              <td>{human(h.head)}{!!h.transactionIds.length && <span className="text-[10.5px] text-muted-foreground"> ({h.transactionIds.length} txns)</span>}</td>
              <td className="text-right"><Money v={h.bankCredits} /></td>
              {SOURCES.map((s) => <td key={s} className="text-right">{h.reported[s] === null ? <span className="text-muted-foreground">—</span> : <Money v={h.reported[s]} />}</td>)}
              <td className="text-right">{h.bankVsItr === null ? "—" : <Money v={h.bankVsItr} />}</td>
              <td className="text-right">{h.aisVsItr === null ? "—" : <Money v={h.aisVsItr} />}</td>
              <td><Tag tone={STATUS_TONE[h.status]}>{human(h.status)}</Tag></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {!!y.observations.length && <ul className="border-t px-4 py-3 text-[12px] space-y-1 list-disc pl-8 text-muted-foreground">{y.observations.map((o, i) => <li key={i}>{o}</li>)}</ul>}
    </Panel>
  );
}

function Body({ c }: { c: Case }) {
  const caseId = useCaseId();
  const a = access(c);
  const inv = useInvalidate();
  const { toast } = useToast();
  const cmp = useGetIncomeTaxComparison(caseId);
  const decl = useListTaxDeclarations(caseId);
  const docs = useListDocuments(caseId, {});
  const cr = useCreateTaxDeclaration(); const up = useUpdateTaxDeclaration(); const del = useDeleteTaxDeclaration();
  const [form, setForm] = useState<{ open: boolean; edit?: TaxDeclaration }>({ open: false });
  const refresh = () => inv(getListTaxDeclarationsQueryKey(caseId), getGetIncomeTaxComparisonQueryKey(caseId));
  const fail = (e: unknown) => toast({ title: "Failed", description: errMsg(e), variant: "destructive" });

  const fields: FieldDef[] = [
    { name: "financialYear", label: "Financial year", required: true, placeholder: "2019-20", hint: "Assessment year is derived (FY + 1)" },
    { name: "source", label: "Tax record", type: "select", options: SOURCES.map((s) => ({ value: s, label: SOURCE_LABEL[s]! })) },
    { name: "head", label: "Income head", type: "select", options: opts(HEADS) },
    { name: "amount", label: "Amount (₹)", type: "number", required: true },
    { name: "documentId", label: "Source document", type: "select", nullableSelect: true, full: true, options: (docs.data ?? []).map((d) => ({ value: String(d.id), label: `${d.name} (${human(d.category)})` })) },
    { name: "description", label: "Description", full: true, placeholder: "e.g. Schedule S gross salary, employer TAN" },
    { name: "notes", label: "Notes", type: "textarea", full: true },
  ];

  const years = cmp.data?.years ?? [];
  const diffCount = years.reduce((n, y) => n + y.heads.filter((h) => h.status === "difference").length, 0);
  return (
    <div className="space-y-5">
      <div><h2 className="font-display text-xl">Income Tax scrutiny</h2><p className="text-xs text-muted-foreground">Year-wise bank credits against declared income, and AIS / Form 26AS against the ITR, head by head.</p></div>
      {cmp.data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 stagger">
          <Stat label="Years covered" value={years.length} />
          <Stat label="Tax records entered" value={decl.data?.length ?? 0} />
          <Stat label="Heads with differences" value={diffCount} tone={diffCount ? "danger" : "teal"} hint={`Above ₹${cmp.data.threshold}`} />
          <Stat label="Years without ITR" value={years.filter((y) => y.declaredIncome === null).length} tone="brass" />
        </div>
      )}
      {cmp.isLoading ? <LoadingRows rows={6} /> : cmp.isError ? <ErrorState error={cmp.error} onRetry={() => cmp.refetch()} /> : !years.length ? (
        <Panel><EmptyState icon={<Landmark className="h-6 w-6" />} title="Nothing to compare yet" body="Import bank statements and record figures from ITR, AIS or Form 26AS to build the comparison." /></Panel>
      ) : (
        <div className="space-y-4">
          {years.map((y) => <YearPanel key={y.financialYear} y={y} />)}
          <Notice>{cmp.data!.notes.map((x, i) => <div key={i}>{x}</div>)}<div className="mt-1 font-medium">{cmp.data!.disclaimer}</div></Notice>
        </div>
      )}
      <Panel title="Tax records" description="Figures entered from ITR, AIS, TIS, Form 26AS and Form 16. Link the uploaded document so every figure can be traced." bodyClass="p-0"
        actions={a.canEdit && <Button size="sm" onClick={() => setForm({ open: true })} data-testid="button-add-tax-record"><Plus />Add figure</Button>}>
        {decl.isLoading ? <div className="p-4"><LoadingRows rows={3} /></div> : decl.isError ? <div className="p-4"><ErrorState error={decl.error} /></div> : !decl.data?.length ? (
          <EmptyState icon={<Landmark className="h-6 w-6" />} title="No tax records entered" />
        ) : (
          <div className="overflow-x-auto"><table className="w-full text-[12.5px] dense-table">
            <thead className="bg-muted/50"><tr><th className="text-left">FY</th><th className="text-left">AY</th><th className="text-left">Record</th><th className="text-left">Head</th><th className="text-left">Description</th><th className="text-left">Document</th><th className="text-right">Amount</th><th /></tr></thead>
            <tbody>{decl.data.map((d) => (
              <tr key={d.id} data-testid={`row-tax-record-${d.id}`}>
                <td className="num">{d.financialYear}</td><td className="num">{d.assessmentYear}</td>
                <td><Tag tone="navy">{SOURCE_LABEL[d.source]}</Tag></td><td>{human(d.head)}</td>
                <td className="max-w-[260px] truncate">{d.description ?? "—"}</td>
                <td className="max-w-[180px] truncate">{d.documentId ? docs.data?.find((x) => x.id === d.documentId)?.name ?? `#${d.documentId}` : <span className="text-muted-foreground">Not linked</span>}</td>
                <td className="text-right"><Money v={d.amount} /></td>
                <td className="text-right">{a.canEdit && <div className="flex justify-end">
                  <Button size="icon" variant="ghost" onClick={() => setForm({ open: true, edit: d })} data-testid={`button-edit-tax-record-${d.id}`}><Pencil /></Button>
                  <ConfirmButton title="Delete tax record?" description="It will be removed from the comparison." onConfirm={() => del.mutate({ declarationId: d.id }, { onSuccess: refresh, onError: fail })} trigger={<Button size="icon" variant="ghost" data-testid={`button-delete-tax-record-${d.id}`}><Trash2 /></Button>} />
                </div>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      <EntityFormDialog open={form.open} onOpenChange={(o) => setForm({ open: o, edit: form.edit })} title={form.edit ? "Edit tax record" : "Add tax record figure"} fields={fields}
        initial={form.edit ? (form.edit as unknown as Record<string, unknown>) : { source: "itr", head: "salary" }} pending={cr.isPending || up.isPending}
        onSubmit={(v) => {
          const data = v as unknown as TaxDeclarationInput;
          const cb = { onSuccess: () => { setForm({ open: false }); refresh(); }, onError: fail };
          form.edit ? up.mutate({ declarationId: form.edit.id, data }, cb) : cr.mutate({ caseId, data }, cb);
        }} />
    </div>
  );
}

export default function IncomeTax() {
  return <CaseLayout>{(c) => <Body c={c} />}</CaseLayout>;
}
