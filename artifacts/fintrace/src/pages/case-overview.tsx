import { useState } from "react";
import { useLocation } from "wouter";
import { Pencil, Plus, Trash2, UserPlus, Users, CalendarRange, AlertTriangle } from "lucide-react";
import {
  useGetCaseSummary, useUpdateCase, useDeleteCase, useListPeriods, useCreatePeriod, useDeletePeriod, useListCaseShares, useCreateCaseShare, useRevokeCaseShare,
  getGetCaseSummaryQueryKey, getGetCaseQueryKey, getListCasesQueryKey, getListPeriodsQueryKey, getListCaseSharesQueryKey, getGetDashboardSummaryQueryKey, getGetDaCalculationQueryKey,
  type Case, type CaseUpdate, type InvestigationPeriodInput, type CaseShareInput,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { CaseLayout, access, useCaseId } from "@/components/case-layout";
import { Panel, Stat, LoadingRows, ErrorState, EmptyState, ConfirmButton, Tag, useInvalidate, Notice, SavedTick, useSavedFlash } from "@/components/common";
import { EntityFormDialog, type FieldDef } from "@/components/entity-form";
import { CASE_FIELDS } from "@/lib/fields";
import { CASE_TYPES, fdate, human, inrCompact, n, errMsg, opts } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";

const PERIOD_FIELDS: FieldDef[] = [
  { name: "label", label: "Label", required: true, full: true, placeholder: "Check period" },
  { name: "periodType", label: "Type", type: "select", options: opts(["check_period", "assessment_year", "financial_year", "custom"]), hint: "For Lokayukta DA, the check period drives the A/B/C/D calculation." },
  { name: "startDate", label: "Start", type: "date", required: true },
  { name: "endDate", label: "End", type: "date", required: true },
];
const SHARE_FIELDS: FieldDef[] = [
  { name: "email", label: "Email", type: "email", required: true, full: true },
  { name: "accessRole", label: "Role", type: "select", options: [{ value: "reviewer", label: "Reviewer — read only" }, { value: "editor", label: "Editor — can edit financial data" }, { value: "investigator", label: "Investigator — read only, can raise queries" }], full: true },
  { name: "note", label: "Reason for sharing (logged)", type: "textarea" },
];

function Body({ c }: { c: Case }) {
  const caseId = useCaseId();
  const a = access(c);
  const inv = useInvalidate();
  const { toast } = useToast();
  const [, nav] = useLocation();
  const [saved, flash] = useSavedFlash();
  const summary = useGetCaseSummary(caseId);
  const periods = useListPeriods(caseId);
  const shares = useListCaseShares(caseId, { query: { enabled: a.isOwner, queryKey: getListCaseSharesQueryKey(caseId) } });
  const upd = useUpdateCase(); const del = useDeleteCase();
  const cp = useCreatePeriod(); const dp = useDeletePeriod();
  const cs = useCreateCaseShare(); const rs = useRevokeCaseShare();
  const [edit, setEdit] = useState(false); const [pOpen, setPOpen] = useState(false); const [sOpen, setSOpen] = useState(false);
  const fail = (t: string) => (e: unknown) => toast({ title: t, description: errMsg(e), variant: "destructive" });
  const s = summary.data;
  const maxCat = Math.max(1, ...(s?.categoryBreakdown ?? []).map((x) => Math.max(x.credits, x.debits)));

  const details: [string, string | null | undefined][] = [
    ["Reference", c.referenceNumber], ["Case type", CASE_TYPES[c.caseType]], ["Subject", c.subjectName], ["Investigating authority", c.investigatingAuthority],
    ["Jurisdiction", c.jurisdiction], ["Legislation", c.legislation], ["Period", c.periodStart || c.periodEnd ? `${fdate(c.periodStart)} – ${fdate(c.periodEnd)}` : null],
    ["Notice date", fdate(c.noticeDate)], ["Submission deadline", fdate(c.submissionDeadline)], ["Advocate", c.assignedAdvocate], ["Chartered accountant", c.assignedCa],
    ["Officer", c.officerDetails], ["Notice details", c.noticeDetails],
  ];

  return (
    <div className="space-y-5">
      {summary.isLoading ? <LoadingRows rows={2} /> : summary.isError ? <ErrorState error={summary.error} onRetry={() => summary.refetch()} /> : s && (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 stagger">
          <Stat label="Accounts" value={n(s.bankAccounts)} hint={`${n(s.statements)} statements`} />
          <Stat label="Transactions" value={n(s.transactions)} />
          <Stat label="Total credits" value={inrCompact(s.totalCredits)} tone="teal" />
          <Stat label="Total debits" value={inrCompact(s.totalDebits)} />
          <Stat label="Unclassified" value={n(s.unclassified)} hint={`${n(s.suggested)} suggested`} tone={s.unclassified ? "brass" : undefined} />
          <Stat label="Unreconciled" value={n(s.unreconciled)} tone={s.unreconciled ? "brass" : undefined} />
          <Stat label="Assets / liabilities" value={inrCompact(s.assetsValue)} hint={`Liabilities ${inrCompact(s.liabilitiesValue)}`} />
          <Stat label="Open queries" value={n(s.openQueries)} hint={`${n(s.documents)} docs · ${n(s.familyMembers)} family`} />
        </div>
      )}
      <div className="grid xl:grid-cols-[1.4fr_1fr] gap-5">
        <Panel title="Case details" actions={<><SavedTick show={saved} />{a.canEdit && <Button size="sm" variant="outline" onClick={() => setEdit(true)} data-testid="button-edit-case"><Pencil />Edit</Button>}</>}>
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
            {details.map(([k, v]) => (
              <div key={k} className={k === "Notice details" || k === "Officer" ? "sm:col-span-2" : ""}>
                <dt className="text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground font-semibold">{k}</dt>
                <dd className="text-sm mt-0.5 whitespace-pre-wrap">{v && v !== "—" ? v : <span className="text-muted-foreground/60">Not recorded</span>}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel title="Category breakdown" description="Approved and suggested categories across all accounts">
          {!s?.categoryBreakdown?.length ? <EmptyState title="Nothing classified yet" body="Classify transactions to see where money came from and went." /> : (
            <div className="space-y-2.5">
              {s.categoryBreakdown.map((x) => (
                <div key={x.category}>
                  <div className="flex justify-between text-xs"><span>{human(x.category)} <span className="text-muted-foreground">({x.count})</span></span><span className="num text-muted-foreground">{inrCompact(x.credits)} / {inrCompact(x.debits)}</span></div>
                  <div className="flex gap-0.5 mt-1 h-1.5">
                    <div className="bg-[hsl(var(--chart-2))] rounded-l" style={{ width: `${(x.credits / maxCat) * 50}%` }} />
                    <div className="bg-[hsl(var(--chart-1))] rounded-r" style={{ width: `${(x.debits / maxCat) * 50}%` }} />
                  </div>
                </div>
              ))}
              <div className="flex gap-3 text-[11px] text-muted-foreground pt-1"><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-[hsl(var(--chart-2))]" />Credits</span><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-[hsl(var(--chart-1))]" />Debits</span></div>
            </div>
          )}
        </Panel>
      </div>
      <div className="grid xl:grid-cols-2 gap-5">
        <Panel title="Financial periods" description={c.caseType === "lokayukta_da" ? "The check_period period drives the DA calculation." : "Periods used to group schedules."}
          actions={a.canEdit && <Button size="sm" variant="outline" onClick={() => setPOpen(true)} data-testid="button-add-period"><Plus />Add period</Button>}>
          {periods.isLoading ? <LoadingRows rows={3} /> : periods.isError ? <ErrorState error={periods.error} onRetry={() => periods.refetch()} /> : !periods.data?.length ? (
            <EmptyState icon={<CalendarRange className="h-6 w-6" />} title="No periods defined" body={c.caseType === "lokayukta_da" ? "Add a check period to enable the DA statement." : undefined} />
          ) : (
            <div className="divide-y">
              {periods.data.map((p) => (
                <div key={p.id} className="flex items-center gap-3 py-2" data-testid={`row-period-${p.id}`}>
                  <div className="flex-1"><div className="text-sm font-medium">{p.label}</div><div className="text-xs num text-muted-foreground">{fdate(p.startDate)} – {fdate(p.endDate)}</div></div>
                  <Tag tone={p.periodType === "check_period" ? "teal" : "muted"}>{human(p.periodType)}</Tag>
                  {a.canEdit && <ConfirmButton title="Delete period?" description="Calculations using this period will change." onConfirm={() => dp.mutate({ periodId: p.id }, { onSuccess: () => inv(getListPeriodsQueryKey(caseId), getGetDaCalculationQueryKey(caseId)), onError: fail("Delete failed") })}
                    trigger={<Button size="icon" variant="ghost" data-testid={`button-delete-period-${p.id}`}><Trash2 /></Button>} />}
                </div>
              ))}
            </div>
          )}
        </Panel>
        {a.isOwner ? (
          <Panel title="Sharing" description="Explicit and logged. Each share is written to the audit trail."
            actions={<Button size="sm" variant="outline" onClick={() => setSOpen(true)} data-testid="button-share"><UserPlus />Share</Button>}>
            {shares.isLoading ? <LoadingRows rows={3} /> : shares.isError ? <ErrorState error={shares.error} /> : !shares.data?.length ? (
              <EmptyState icon={<Users className="h-6 w-6" />} title="Only you can see this case" />
            ) : (
              <div className="divide-y">
                {shares.data.map((sh) => (
                  <div key={sh.id} className="flex items-center gap-3 py-2" data-testid={`row-share-${sh.id}`}>
                    <div className="flex-1 min-w-0"><div className="text-sm truncate">{sh.email}</div><div className="text-[11px] text-muted-foreground">Shared {fdate(sh.createdAt)}{sh.note ? ` · ${sh.note}` : ""}</div></div>
                    <Tag tone={sh.accessRole === "investigator" ? "brass" : sh.accessRole === "editor" ? "teal" : "muted"}>{human(sh.accessRole)}</Tag>
                    <ConfirmButton title="Revoke access?" description={`${sh.email} will immediately lose access to this case.`} confirmLabel="Revoke"
                      onConfirm={() => rs.mutate({ shareId: sh.id }, { onSuccess: () => inv(getListCaseSharesQueryKey(caseId)), onError: fail("Revoke failed") })}
                      trigger={<Button size="sm" variant="ghost" data-testid={`button-revoke-${sh.id}`}>Revoke</Button>} />
                  </div>
                ))}
              </div>
            )}
          </Panel>
        ) : (
          <Panel title="Your access"><Notice>You have <b>{human(c.accessRole)}</b> access to this case. {a.isInvestigator ? "Financial data is read-only; you can raise queries, follow-ups and assessments." : a.readOnly ? "This case is read-only for you." : "You can edit financial data."} Sharing is managed by the case owner.</Notice></Panel>
        )}
      </div>
      {a.isOwner && (
        <Panel title="Danger zone" className="border-destructive/25">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Deleting removes the case and every record in it for all collaborators.</p>
            <ConfirmButton title="Delete this case permanently?" description={`"${c.title}" and all accounts, transactions, documents and queries will be removed.`} confirmLabel="Delete case"
              onConfirm={() => del.mutate({ caseId }, { onSuccess: () => { inv(getListCasesQueryKey(), getGetDashboardSummaryQueryKey()); nav("/cases"); }, onError: fail("Delete failed") })}
              trigger={<Button variant="destructive" data-testid="button-delete-case"><Trash2 />Delete case</Button>} />
          </div>
        </Panel>
      )}

      <EntityFormDialog open={edit} onOpenChange={setEdit} title="Edit case details" fields={CASE_FIELDS} initial={c as unknown as Record<string, unknown>} wide pending={upd.isPending}
        onSubmit={(v) => upd.mutate({ caseId, data: v as unknown as CaseUpdate }, { onSuccess: () => { setEdit(false); flash(); inv(getGetCaseQueryKey(caseId), getListCasesQueryKey()); }, onError: fail("Save failed") })} />
      <EntityFormDialog open={pOpen} onOpenChange={setPOpen} title="Add financial period" fields={PERIOD_FIELDS} initial={{ periodType: c.caseType === "lokayukta_da" ? "check_period" : "financial_year" }} pending={cp.isPending}
        onSubmit={(v) => cp.mutate({ caseId, data: v as unknown as InvestigationPeriodInput }, { onSuccess: () => { setPOpen(false); inv(getListPeriodsQueryKey(caseId), getGetDaCalculationQueryKey(caseId)); }, onError: fail("Could not add period") })} />
      <EntityFormDialog open={sOpen} onOpenChange={setSOpen} title="Share this case" fields={SHARE_FIELDS} initial={{ accessRole: "reviewer" }} pending={cs.isPending} submitLabel="Share and log"
        footerNote={<Notice tone="brass" icon={<AlertTriangle className="h-4 w-4 shrink-0 mt-px" />}>Investigators will see this case — all accounts, transactions, documents and responses. Share with an investigator only when you intend the investigating authority to review it. This action is logged.</Notice>}
        onSubmit={(v) => cs.mutate({ caseId, data: v as unknown as CaseShareInput }, { onSuccess: () => { setSOpen(false); inv(getListCaseSharesQueryKey(caseId)); toast({ title: "Shared", description: `Access granted and logged.` }); }, onError: fail("Share failed") })} />
    </div>
  );
}

export default function CaseOverview() {
  return <CaseLayout>{(c) => <Body c={c} />}</CaseLayout>;
}
