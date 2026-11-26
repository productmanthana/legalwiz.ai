import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { Plus, Database, CalendarClock, FileText, Loader2, ArrowUpRight } from "lucide-react";
import {
  useGetDashboardSummary, useGetFinancialOverview, useGetRecentActivity, useGetUpcomingDeadlines, useSeedDemoCase, useCreateCase, useGetMe,
  getGetDashboardSummaryQueryKey, getListCasesQueryKey, getGetFinancialOverviewQueryKey, getGetRecentActivityQueryKey, getGetUpcomingDeadlinesQueryKey,
  type CaseInput,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader, Panel, Stat, EmptyState, ErrorState, LoadingRows, useInvalidate, Tag } from "@/components/common";
import { EntityFormDialog } from "@/components/entity-form";
import { CASE_FIELDS } from "@/lib/fields";
import { CASE_TYPES, fdate, fdatetime, inrCompact, n, errMsg, human } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { differenceInCalendarDays, parseISO } from "date-fns";

export default function Dashboard() {
  const { data: me } = useGetMe();
  const s = useGetDashboardSummary();
  const fo = useGetFinancialOverview();
  const act = useGetRecentActivity();
  const dl = useGetUpcomingDeadlines();
  const seed = useSeedDemoCase();
  const create = useCreateCase();
  const inv = useInvalidate();
  const [, nav] = useLocation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const refreshAll = () => inv(getGetDashboardSummaryQueryKey(), getListCasesQueryKey(), getGetFinancialOverviewQueryKey(), getGetRecentActivityQueryKey(), getGetUpcomingDeadlinesQueryKey());

  const loadDemo = () => seed.mutate(undefined, {
    onSuccess: (c) => { refreshAll(); toast({ title: "Demo case loaded", description: "All records in it are marked DEMO DATA." }); nav(`/cases/${c.id}`); },
    onError: (e) => toast({ title: "Could not load demo", description: errMsg(e), variant: "destructive" }),
  });

  const actions = (
    <>
      <Button variant="outline" onClick={loadDemo} disabled={seed.isPending} data-testid="button-load-demo">{seed.isPending ? <Loader2 className="animate-spin" /> : <Database />}Load demo case</Button>
      <Button onClick={() => setOpen(true)} data-testid="button-create-case"><Plus />Create case</Button>
    </>
  );
  const d = s.data;
  const hasCases = (d?.activeCases ?? 0) > 0;

  return (
    <div>
      <PageHeader eyebrow={me?.workspace === "investigation" ? "Investigation workspace" : "Client workspace"} title={`Good to see you${me?.displayName ? `, ${me.displayName.split(" ")[0]}` : ""}.`}
        description="Where every case stands, what still needs a person's attention, and what is due next." actions={actions} />

      {s.isError ? <ErrorState error={s.error} onRetry={() => s.refetch()} /> : s.isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : !hasCases ? (
        <div className="rounded-lg border bg-card ledger-rule">
          <EmptyState icon={<FileText className="h-6 w-6" />} title="No cases on the register yet"
            body="Open a case for a Lokayukta DA enquiry or an Income Tax scrutiny, or load a demo case — it will be clearly labelled DEMO DATA wherever it appears."
            action={<div className="flex gap-2">{actions}</div>} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3 stagger">
            <Stat label="Active cases" value={n(d!.activeCases)} />
            <Stat label="Bank accounts" value={n(d!.bankAccounts)} />
            <Stat label="Transactions" value={n(d!.transactions)} />
            <Stat label="Documents" value={n(d!.documents)} />
            <Stat label="Awaiting classification" value={n(d!.awaitingClassification)} tone={d!.awaitingClassification ? "brass" : undefined} />
            <Stat label="Awaiting reconciliation" value={n(d!.awaitingReconciliation)} tone={d!.awaitingReconciliation ? "brass" : undefined} />
            <Stat label="Missing documents" value={n(d!.missingDocuments)} hint="High-value, no support linked" tone={d!.missingDocuments ? "danger" : undefined} />
            <Stat label="Pending queries" value={n(d!.pendingQueries)} tone="teal" />
            <Stat label="Responses awaiting review" value={n(d!.responsesAwaitingReview)} />
            <Stat label="Financial years" value={n(d!.financialYears.length)} hint={d!.financialYears.length ? `${d!.financialYears[0]} – ${d!.financialYears[d!.financialYears.length - 1]}` : "—"} />
            <div className="col-span-2 rounded-lg border bg-card px-4 py-3 shadow-xs">
              <div className="text-[10.5px] uppercase tracking-[0.1em] font-semibold text-muted-foreground">Cases by type</div>
              <div className="mt-2 space-y-1">
                {d!.casesByType.map((c) => (
                  <div key={c.caseType} className="flex justify-between text-xs"><span className="truncate">{CASE_TYPES[c.caseType] ?? human(c.caseType)}</span><span className="num">{c.count}</span></div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid xl:grid-cols-[1.6fr_1fr] gap-5 mt-5">
            <Panel title="Financial overview by financial year" description="Gross credits and debits across all accessible cases, before reconciliation adjustments.">
              {fo.isLoading ? <Skeleton className="h-64" /> : fo.isError ? <ErrorState error={fo.error} onRetry={() => fo.refetch()} /> : !fo.data?.length ? (
                <EmptyState title="No transactions imported" body="Import a statement to see year-wise movement." />
              ) : (
                <div className="h-72">
                  <ResponsiveContainer>
                    <BarChart data={fo.data} barGap={2}>
                      <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="financialYear" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={(v) => inrCompact(v)} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))", fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} width={72} />
                      <Tooltip formatter={(v: number) => inrCompact(v)} cursor={{ fill: "hsl(var(--accent) / .5)" }} contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="credits" name="Credits" fill="hsl(var(--chart-2))" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="debits" name="Debits" fill="hsl(var(--chart-1))" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Panel>
            <Panel title="Upcoming deadlines" description="Query responses and case submissions">
              {dl.isLoading ? <LoadingRows rows={4} /> : dl.isError ? <ErrorState error={dl.error} onRetry={() => dl.refetch()} /> : !dl.data?.length ? (
                <EmptyState icon={<CalendarClock className="h-6 w-6" />} title="Nothing due" body="Deadlines appear when queries or cases carry a due date." />
              ) : (
                <div className="divide-y stagger">
                  {dl.data.map((x, i) => {
                    const days = differenceInCalendarDays(parseISO(x.dueDate), new Date());
                    return (
                      <Link key={i} href={x.queryId ? `/cases/${x.caseId}/queries/${x.queryId}` : `/cases/${x.caseId}`} className="flex items-center gap-3 py-2.5 group" data-testid={`link-deadline-${i}`}>
                        <div className="w-12 text-center shrink-0 rounded border py-1">
                          <div className="num text-base leading-none">{fdate(x.dueDate).slice(0, 2)}</div>
                          <div className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">{fdate(x.dueDate).slice(3, 6)}</div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm truncate group-hover:text-primary">{x.title}</div>
                          <div className="text-[11px] text-muted-foreground truncate">{x.caseTitle} · {human(x.kind)}</div>
                        </div>
                        <Tag tone={days < 0 ? "danger" : days <= 7 ? "brass" : "muted"}>{days < 0 ? `${-days}d overdue` : days === 0 ? "Today" : `${days}d`}</Tag>
                      </Link>
                    );
                  })}
                </div>
              )}
            </Panel>
          </div>

          <div className="grid xl:grid-cols-[1.6fr_1fr] gap-5 mt-5">
            <Panel title="Case activity" description="Every change is logged with who, when and what changed.">
              {act.isLoading ? <LoadingRows /> : act.isError ? <ErrorState error={act.error} onRetry={() => act.refetch()} /> : !act.data?.length ? <EmptyState title="No activity yet" /> : (
                <ol className="relative border-l ml-2 space-y-3 stagger">
                  {act.data.slice(0, 12).map((a) => (
                    <li key={a.id} className="pl-4 relative">
                      <span className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-[hsl(var(--teal))]" />
                      <div className="text-sm"><span className="font-medium">{a.userName ?? "System"}</span> <span className="text-muted-foreground">{a.summary ?? human(a.action)}</span></div>
                      <div className="text-[11px] text-muted-foreground num">{fdatetime(a.createdAt)}{a.caseTitle ? ` · ${a.caseTitle}` : ""}</div>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
            <Panel title="Recent documents">
              {!d!.recentDocuments?.length ? <EmptyState title="No documents yet" /> : (
                <div className="divide-y">
                  {d!.recentDocuments.map((doc) => (
                    <Link key={doc.id} href={`/cases/${doc.caseId}/documents`} className="flex items-center gap-2 py-2 text-sm hover:text-primary" data-testid={`link-doc-${doc.id}`}>
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" /><span className="truncate flex-1">{doc.name}</span>
                      <span className="text-[11px] text-muted-foreground">{fdate(doc.createdAt)}</span><ArrowUpRight className="h-3.5 w-3.5 opacity-40" />
                    </Link>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </>
      )}

      <EntityFormDialog open={open} onOpenChange={setOpen} title="Open a new case" description="You will be the owner. Nothing is shared until you explicitly share it." fields={CASE_FIELDS} wide
        initial={{ caseType: "lokayukta_da", status: "open" }} pending={create.isPending} submitLabel="Create case"
        onSubmit={(v) => create.mutate({ data: v as unknown as CaseInput }, {
          onSuccess: (c) => { setOpen(false); refreshAll(); nav(`/cases/${c.id}`); },
          onError: (e) => toast({ title: "Could not create case", description: errMsg(e), variant: "destructive" }),
        })} />
    </div>
  );
}
