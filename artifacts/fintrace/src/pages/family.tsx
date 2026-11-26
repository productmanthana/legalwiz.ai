import { useState } from "react";
import { Plus, Pencil, Trash2, Users } from "lucide-react";
import {
  useListFamilyMembers, useCreateFamilyMember, useUpdateFamilyMember, useDeleteFamilyMember,
  getListFamilyMembersQueryKey, getGetCaseSummaryQueryKey, getGetDaCalculationQueryKey,
  type Case, type FamilyMember, type FamilyMemberInput,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { CaseLayout, access, useCaseId } from "@/components/case-layout";
import { LoadingRows, ErrorState, EmptyState, Tag, useInvalidate, ConfirmButton, Panel } from "@/components/common";
import { EntityFormDialog, type FieldDef } from "@/components/entity-form";
import { fdate, human, errMsg, opts, inr, inrCompact, initials, n } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";

const FIELDS: FieldDef[] = [
  { name: "name", label: "Name", required: true }, { name: "relationship", label: "Relationship", type: "select", options: opts(["spouse", "son", "daughter", "father", "mother", "other"]) },
  { name: "dateOfBirth", label: "Date of birth", type: "date" }, { name: "pan", label: "PAN (masked)", placeholder: "XXXXX1234X" },
  { name: "occupation", label: "Occupation" }, { name: "employer", label: "Employer" },
  { name: "hasIndependentIncome", label: "Has independent income", type: "checkbox" }, { name: "annualIncomeDeclared", label: "Annual income declared (₹)", type: "number" },
  { name: "businessInterests", label: "Business interests", full: true }, { name: "notes", label: "Notes", type: "textarea" },
];

function Body({ c }: { c: Case }) {
  const caseId = useCaseId();
  const a = access(c);
  const inv = useInvalidate();
  const { toast } = useToast();
  const q = useListFamilyMembers(caseId);
  const cr = useCreateFamilyMember(); const up = useUpdateFamilyMember(); const del = useDeleteFamilyMember();
  const [f, setF] = useState<{ open: boolean; edit?: FamilyMember }>({ open: false });
  const refresh = () => inv(getListFamilyMembersQueryKey(caseId), getGetCaseSummaryQueryKey(caseId), getGetDaCalculationQueryKey(caseId));
  const fail = (e: unknown) => toast({ title: "Failed", description: errMsg(e), variant: "destructive" });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="font-display text-xl">Family members</h2><p className="text-xs text-muted-foreground">Independent income of family members is a frequent point of contention. Record it with its evidence.</p></div>
        {a.canEdit && <Button onClick={() => setF({ open: true })} data-testid="button-add-member"><Plus />Add member</Button>}
      </div>
      {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.length ? (
        <Panel><EmptyState icon={<Users className="h-6 w-6" />} title="No family members recorded" body="Add spouse, children and parents whose accounts or assets may be examined." /></Panel>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 stagger">
          {q.data.map((m) => (
            <div key={m.id} className="rounded-lg border bg-card shadow-xs p-4" data-testid={`card-member-${m.id}`}>
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-full bg-accent text-accent-foreground grid place-items-center font-semibold text-sm">{initials(m.name)}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-display text-lg leading-tight">{m.name}</div>
                  <div className="text-xs text-muted-foreground">{human(m.relationship)}{m.occupation ? ` · ${m.occupation}` : ""}{m.employer ? `, ${m.employer}` : ""}</div>
                </div>
                {a.canEdit && <div className="flex">
                  <Button size="icon" variant="ghost" onClick={() => setF({ open: true, edit: m })} data-testid={`button-edit-member-${m.id}`}><Pencil /></Button>
                  <ConfirmButton title="Remove family member?" description={`${m.name} will be removed. Linked accounts and assets remain.`} onConfirm={() => del.mutate({ memberId: m.id }, { onSuccess: refresh, onError: fail })} trigger={<Button size="icon" variant="ghost" data-testid={`button-delete-member-${m.id}`}><Trash2 /></Button>} />
                </div>}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-3">
                <Tag tone={m.hasIndependentIncome ? "teal" : "muted"}>{m.hasIndependentIncome ? "Independent income" : "No independent income"}</Tag>
                {m.pan && <Tag className="num">PAN {m.pan}</Tag>}{m.dateOfBirth && <Tag>DOB {fdate(m.dateOfBirth)}</Tag>}
              </div>
              <div className="grid grid-cols-4 gap-2 mt-4 pt-3 border-t text-center">
                <div><div className="num text-sm">{n(m.bankAccountCount ?? 0)}</div><div className="text-[10px] text-muted-foreground uppercase tracking-wider">Accounts</div></div>
                <div><div className="num text-sm">{n(m.assetCount ?? 0)}</div><div className="text-[10px] text-muted-foreground uppercase tracking-wider">Assets</div></div>
                <div><div className="num text-sm">{inrCompact(m.assetsValue ?? 0)}</div><div className="text-[10px] text-muted-foreground uppercase tracking-wider">Asset value</div></div>
                <div><div className="num text-sm">{inrCompact(m.incomeRecorded ?? 0)}</div><div className="text-[10px] text-muted-foreground uppercase tracking-wider">Income</div></div>
              </div>
              {m.annualIncomeDeclared != null && <div className="text-xs text-muted-foreground mt-2">Declared annual income <span className="num text-foreground">{inr(m.annualIncomeDeclared, true)}</span></div>}
              {m.businessInterests && <div className="text-xs text-muted-foreground mt-1">Business: {m.businessInterests}</div>}
            </div>
          ))}
        </div>
      )}
      <EntityFormDialog open={f.open} onOpenChange={(o) => setF({ open: o, edit: f.edit })} title={f.edit ? "Edit family member" : "Add family member"} fields={FIELDS}
        initial={f.edit ? (f.edit as unknown as Record<string, unknown>) : { relationship: "spouse" }} pending={cr.isPending || up.isPending}
        onSubmit={(v) => { const data = v as unknown as FamilyMemberInput; const cb = { onSuccess: () => { setF({ open: false }); refresh(); }, onError: fail }; f.edit ? up.mutate({ memberId: f.edit.id, data }, cb) : cr.mutate({ caseId, data }, cb); }} />
    </div>
  );
}

export default function Family() {
  return <CaseLayout>{(c) => <Body c={c} />}</CaseLayout>;
}
