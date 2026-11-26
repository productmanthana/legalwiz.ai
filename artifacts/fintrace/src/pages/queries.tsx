import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Plus, MessagesSquare, CornerDownRight } from "lucide-react";
import { useListQueries, type Case } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { CaseLayout, access, useCaseId } from "@/components/case-layout";
import { LoadingRows, ErrorState, EmptyState, Tag, StatusBadge, nativeSelect, Panel } from "@/components/common";
import { QueryFormDialog } from "@/components/query-form";
import { QUERY_STATUSES, fdate, human } from "@/lib/format";
import { cn } from "@/lib/utils";
import { differenceInCalendarDays, parseISO } from "date-fns";

function Body({ c }: { c: Case }) {
  const caseId = useCaseId();
  const a = access(c);
  const q = useListQueries(caseId);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [, nav] = useLocation();
  const rows = (q.data ?? []).filter((x) => !status || x.status === status);
  const canRaise = a.canEdit || a.isInvestigator;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="font-display text-xl">Investigation queries</h2><p className="text-xs text-muted-foreground">Each question, its responses, assessments and follow-ups — one thread per query.</p></div>
        <div className="flex gap-2">
          <select className={cn(nativeSelect, "h-9 text-xs")} value={status} onChange={(e) => setStatus(e.target.value)} data-testid="filter-query-status"><option value="">All statuses</option>{QUERY_STATUSES.map((s) => <option key={s} value={s}>{human(s)}</option>)}</select>
          {canRaise && <Button onClick={() => setOpen(true)} data-testid="button-new-query"><Plus />New query</Button>}
        </div>
      </div>
      <div className="rounded-lg border bg-card overflow-hidden">
        {q.isLoading ? <div className="p-4"><LoadingRows /></div> : q.isError ? <div className="p-4"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div> : !rows.length ? (
          <Panel className="border-0 shadow-none"><EmptyState icon={<MessagesSquare className="h-6 w-6" />} title={status ? "No queries with this status" : "No queries yet"} body="Record each question from the notice or the investigating officer to respond to it in a structured way." action={canRaise && !status && <Button onClick={() => setOpen(true)}><Plus />New query</Button>} /></Panel>
        ) : (
          <div className="overflow-x-auto"><table className="w-full text-sm dense-table">
            <thead className="bg-muted/50"><tr><th className="text-left">No.</th><th className="text-left">Subject</th><th className="text-left">Topic</th><th className="text-left">FY</th><th className="text-left">Status</th><th className="text-right">Responses</th><th className="text-right">Deadline</th></tr></thead>
            <tbody className="stagger">{rows.map((x) => {
              const days = x.responseDeadline ? differenceInCalendarDays(parseISO(x.responseDeadline), new Date()) : null;
              return (
                <tr key={x.id} className="cursor-pointer" onClick={() => nav(`/cases/${caseId}/queries/${x.id}`)} data-testid={`row-query-${x.id}`}>
                  <td className="num font-semibold">{x.parentQueryId && <CornerDownRight className="inline h-3 w-3 mr-1 text-muted-foreground" />}{x.questionNumber}</td>
                  <td className="max-w-[420px]"><Link href={`/cases/${caseId}/queries/${x.id}`} className="font-medium hover:text-primary truncate block">{x.subject}</Link><div className="text-[11px] text-muted-foreground truncate">{x.description}</div></td>
                  <td className="text-xs">{human(x.topic)}</td><td className="num text-xs">{x.financialYear ?? "—"}</td>
                  <td><StatusBadge status={x.status} /></td><td className="text-right num">{x.responseCount}</td>
                  <td className="text-right"><span className="num text-xs">{fdate(x.responseDeadline)}</span>{days !== null && x.status !== "closed" && x.status !== "reviewed" && <Tag tone={days < 0 ? "danger" : days <= 7 ? "brass" : "muted"} className="ml-1.5">{days < 0 ? "Overdue" : `${days}d`}</Tag>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </div>
      <QueryFormDialog caseId={caseId} open={open} onOpenChange={setOpen} onCreated={(id) => nav(`/cases/${caseId}/queries/${id}`)} />
    </div>
  );
}

export default function Queries() {
  return <CaseLayout>{(c) => <Body c={c} />}</CaseLayout>;
}
