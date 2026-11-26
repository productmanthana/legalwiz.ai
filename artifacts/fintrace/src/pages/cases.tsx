import { useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Plus, Search, FolderOpen, Database, ChevronRight } from "lucide-react";
import { useListCases, useCreateCase, useSeedDemoCase, useGetMe, getListCasesQueryKey, getGetDashboardSummaryQueryKey, type CaseInput } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, EmptyState, ErrorState, LoadingRows, StatusBadge, DemoBadge, Tag, useInvalidate, nativeSelect, Notice } from "@/components/common";
import { EntityFormDialog } from "@/components/entity-form";
import { CASE_FIELDS } from "@/lib/fields";
import { CASE_TYPES, CASE_STATUSES, fdate, human, errMsg } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";

export default function Cases() {
  const { data: me } = useGetMe();
  const inv = me?.workspace === "investigation";
  const focus = new URLSearchParams(useSearch()).get("focus");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [caseType, setCaseType] = useState("");
  const params = { search: search || undefined, status: status || undefined, caseType: caseType || undefined };
  const q = useListCases(params);
  const create = useCreateCase();
  const seed = useSeedDemoCase();
  const invalidate = useInvalidate();
  const [open, setOpen] = useState(false);
  const [, nav] = useLocation();
  const { toast } = useToast();
  const suffix = focus === "queries" ? "/queries" : focus === "responses" ? "/queries" : "";

  return (
    <div>
      <PageHeader eyebrow="Register" title={inv ? "Assigned investigations" : "My cases"}
        description={inv ? "Cases explicitly shared with you. Financial data is read-only; you may raise queries and record assessments." : "Every case you own or that has been shared with you."}
        actions={!inv && <>
          <Button variant="outline" disabled={seed.isPending} onClick={() => seed.mutate(undefined, { onSuccess: (c) => { invalidate(getListCasesQueryKey(), getGetDashboardSummaryQueryKey()); nav(`/cases/${c.id}`); }, onError: (e) => toast({ title: "Failed", description: errMsg(e), variant: "destructive" }) })} data-testid="button-load-demo"><Database />Load demo</Button>
          <Button onClick={() => setOpen(true)} data-testid="button-create-case"><Plus />Create case</Button>
        </>} />
      {focus && <div className="mb-4"><Notice tone="teal">{focus === "queries" ? "Choose a case to manage its queries." : "Choose a case to review submitted responses and record assessments."}</Notice></div>}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search title, subject, reference" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search" />
        </div>
        <select className={nativeSelect} value={status} onChange={(e) => setStatus(e.target.value)} data-testid="select-status">
          <option value="">All statuses</option>{CASE_STATUSES.map((s) => <option key={s} value={s}>{human(s)}</option>)}
        </select>
        <select className={nativeSelect} value={caseType} onChange={(e) => setCaseType(e.target.value)} data-testid="select-type">
          <option value="">All types</option>{Object.entries(CASE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="rounded-lg border bg-card overflow-hidden">
        {q.isLoading ? <div className="p-4"><LoadingRows /></div> : q.isError ? <div className="p-4"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div> : !q.data?.length ? (
          <EmptyState icon={<FolderOpen className="h-6 w-6" />} title={search || status || caseType ? "No cases match these filters" : inv ? "No cases have been shared with you" : "No cases yet"}
            body={inv ? "A case owner must share it with your email address as investigator." : "Create your first case to start building the record."}
            action={!inv && <Button onClick={() => setOpen(true)}><Plus />Create case</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm dense-table">
              <thead className="bg-muted/50"><tr><th className="text-left">Case</th><th className="text-left">Type</th><th className="text-left">Subject</th><th className="text-left">Status</th><th className="text-left">Access</th><th className="text-right">Deadline</th><th /></tr></thead>
              <tbody className="stagger">
                {q.data.map((c) => (
                  <tr key={c.id} className="cursor-pointer" onClick={() => nav(`/cases/${c.id}${suffix}`)} data-testid={`row-case-${c.id}`}>
                    <td className="!py-2.5">
                      <div className="flex items-center gap-2"><Link href={`/cases/${c.id}${suffix}`} className="font-medium hover:text-primary" onClick={(e) => e.stopPropagation()}>{c.title}</Link>{c.isDemo && <DemoBadge />}</div>
                      <div className="text-[11px] text-muted-foreground num">{c.referenceNumber ?? `#${c.id}`}</div>
                    </td>
                    <td className="text-xs">{CASE_TYPES[c.caseType]}</td>
                    <td className="text-xs">{c.subjectName ?? "—"}</td>
                    <td><StatusBadge status={c.status} /></td>
                    <td><Tag tone={c.accessRole === "owner" ? "navy" : c.accessRole === "editor" ? "teal" : "brass"}>{human(c.accessRole)}</Tag></td>
                    <td className="text-right num text-xs">{fdate(c.submissionDeadline)}</td>
                    <td className="w-6"><ChevronRight className="h-4 w-4 text-muted-foreground" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <EntityFormDialog open={open} onOpenChange={setOpen} title="Open a new case" description="You will be the owner. Nothing is shared until you explicitly share it." fields={CASE_FIELDS} wide
        initial={{ caseType: "lokayukta_da", status: "open" }} pending={create.isPending} submitLabel="Create case"
        onSubmit={(v) => create.mutate({ data: v as unknown as CaseInput }, {
          onSuccess: (c) => { setOpen(false); invalidate(getListCasesQueryKey(), getGetDashboardSummaryQueryKey()); nav(`/cases/${c.id}`); },
          onError: (e) => toast({ title: "Could not create case", description: errMsg(e), variant: "destructive" }),
        })} />
    </div>
  );
}
