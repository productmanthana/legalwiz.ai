import { Fragment, useState } from "react";
import { Link, Redirect } from "wouter";
import { ChevronRight, ScrollText } from "lucide-react";
import { useListAuditLogs, useGetMe, type ListAuditLogsParams } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageHeader, LoadingRows, ErrorState, EmptyState, Panel, Tag } from "@/components/common";
import { fdatetime, human } from "@/lib/format";
import { cn } from "@/lib/utils";

const EMPTY = { user: "", action: "", caseTitle: "", from: "", to: "" };

function Filters({ value, onChange }: { value: typeof EMPTY; onChange: (v: typeof EMPTY) => void }) {
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value });
  const lbl = "text-[10.5px] uppercase tracking-wide font-semibold text-muted-foreground mb-1 block";
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_auto_auto_auto] items-end">
      <label><span className={lbl}>User</span><Input placeholder="Name or email" value={value.user} onChange={set("user")} data-testid="input-audit-user" /></label>
      <label><span className={lbl}>Action</span><Input placeholder="e.g. classify, upload" value={value.action} onChange={set("action")} data-testid="input-audit-action" /></label>
      <label><span className={lbl}>Case</span><Input placeholder="Case title" value={value.caseTitle} onChange={set("caseTitle")} data-testid="input-audit-case" /></label>
      <label><span className={lbl}>From</span><Input type="date" value={value.from} onChange={set("from")} data-testid="input-audit-from" /></label>
      <label><span className={lbl}>To</span><Input type="date" value={value.to} onChange={set("to")} data-testid="input-audit-to" /></label>
      <Button variant="outline" onClick={() => onChange(EMPTY)} disabled={Object.values(value).every((v) => !v)} data-testid="button-audit-clear">Clear</Button>
    </div>
  );
}

export default function Audit() {
  const me = useGetMe();
  if (me.isLoading) return <LoadingRows rows={6} />;
  if (!me.data?.canViewAudit) return <Redirect to="/dashboard" />;
  return <AuditLog />;
}

function AuditLog() {
  const [f, setF] = useState(EMPTY);
  const [open, setOpen] = useState<number | null>(null);
  const params: ListAuditLogsParams = { limit: 500 };
  for (const [k, v] of Object.entries(f)) if (v.trim()) params[k as keyof typeof EMPTY] = v.trim();
  const q = useListAuditLogs(params);
  return (
    <div>
      <PageHeader eyebrow="Accountability" title="Audit log" description="Every change made by every user, with who made it and what changed. Entries cannot be edited." />
      <Filters value={f} onChange={setF} />
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
                    <td><div>{e.userName ?? "System"}</div>{e.userEmail && <div className="text-[11px] text-muted-foreground">{e.userEmail}</div>}</td><td><Tag tone="navy">{human(e.action)}</Tag></td>
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
