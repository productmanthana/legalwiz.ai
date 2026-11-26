import { Fragment, useState } from "react";
import { Link } from "wouter";
import { ChevronRight, ScrollText } from "lucide-react";
import { useListAuditLogs } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { PageHeader, LoadingRows, ErrorState, EmptyState, Panel, Tag } from "@/components/common";
import { fdatetime, human } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function Audit() {
  const [action, setAction] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const q = useListAuditLogs({ action: action || undefined, limit: 300 });
  return (
    <div>
      <PageHeader eyebrow="Accountability" title="Audit log" description="Every change to case records, with who made it and what changed. Entries cannot be edited." />
      <div className="mb-4 max-w-xs"><Input placeholder="Filter by action, e.g. classify" value={action} onChange={(e) => setAction(e.target.value)} data-testid="input-audit-action" /></div>
      <Panel bodyClass="p-0">
        {q.isLoading ? <div className="p-4"><LoadingRows rows={10} /></div> : q.isError ? <div className="p-4"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div> : !q.data?.length ? (
          <EmptyState icon={<ScrollText className="h-6 w-6" />} title="No audit entries" />
        ) : (
          <div className="overflow-x-auto"><table className="w-full text-[12.5px] dense-table">
            <thead className="bg-muted/50"><tr><th className="text-left">When</th><th className="text-left">User</th><th className="text-left">Action</th><th className="text-left">Entity</th><th className="text-left">Case</th><th className="text-left">Summary</th></tr></thead>
            <tbody>{q.data.map((e) => {
              const has = !!(e.previousValue || e.newValue);
              return (
                <Fragment key={e.id}>
                  <tr className={cn(has && "cursor-pointer")} onClick={() => has && setOpen(open === e.id ? null : e.id)} data-testid={`row-audit-${e.id}`}>
                    <td className="num whitespace-nowrap">{has && <ChevronRight className={cn("inline h-3 w-3 mr-1 transition-transform", open === e.id && "rotate-90")} />}{fdatetime(e.createdAt)}</td>
                    <td>{e.userName ?? "System"}</td><td><Tag tone="navy">{human(e.action)}</Tag></td>
                    <td className="text-xs">{human(e.entityType)}{e.entityId ? ` #${e.entityId}` : ""}</td>
                    <td className="text-xs max-w-[180px] truncate">{e.caseId ? <Link href={`/cases/${e.caseId}`} className="hover:underline" onClick={(ev) => ev.stopPropagation()}>{e.caseTitle ?? `Case ${e.caseId}`}</Link> : "—"}</td>
                    <td className="max-w-[360px] truncate">{e.summary ?? "—"}</td>
                  </tr>
                  {open === e.id && <tr className="bg-muted/40"><td colSpan={6}><div className="grid md:grid-cols-2 gap-3 py-1">
                    <div><div className="text-[10px] uppercase font-semibold text-muted-foreground mb-1">Previous</div><pre className="num text-[11px] whitespace-pre-wrap break-all bg-card border rounded p-2 max-h-52 overflow-auto">{e.previousValue ?? "—"}</pre></div>
                    <div><div className="text-[10px] uppercase font-semibold text-muted-foreground mb-1">New</div><pre className="num text-[11px] whitespace-pre-wrap break-all bg-card border rounded p-2 max-h-52 overflow-auto">{e.newValue ?? "—"}</pre></div>
                  </div></td></tr>}
                </Fragment>
              );
            })}</tbody>
          </table></div>
        )}
      </Panel>
    </div>
  );
}
