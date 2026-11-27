import type { ReactNode } from "react";
import { Link, useLocation, useParams } from "wouter";
import { ChevronRight, Lock, Eye } from "lucide-react";
import { useGetCase, useGetMe, getGetCaseQueryKey, type Case } from "@workspace/api-client-react";
import { DemoBadge, ErrorState, StatusBadge, Tag } from "@/components/common";
import { Skeleton } from "@/components/ui/skeleton";
import { CASE_TYPES, human } from "@/lib/format";
import { cn } from "@/lib/utils";

export function useCaseId(): number {
  const p = useParams<{ caseId: string }>();
  return Number(p.caseId);
}

export function access(c?: Case) {
  const r = c?.accessRole;
  return { canEdit: r === "owner" || r === "editor", isOwner: r === "owner", isInvestigator: r === "investigator", readOnly: r === "reviewer" || r === "investigator" };
}

export function CaseLayout({ children }: { children: (c: Case) => ReactNode }) {
  const caseId = useCaseId();
  const [location] = useLocation();
  const { data: me } = useGetMe();
  const inv = me?.workspace === "investigation";
  const q = useGetCase(caseId, { query: { enabled: !!caseId, queryKey: getGetCaseQueryKey(caseId) } });

  const base = `/cases/${caseId}`;
  const tabs = [
    { href: base, label: "Overview" },
    { href: `${base}/accounts`, label: "Accounts" },
    { href: `${base}/transactions`, label: "Transactions" },
    { href: `${base}/reconciliation`, label: inv ? "Discrepancy Analysis" : "Reconciliation" },
    { href: `${base}/income-expenditure`, label: "Income & Expenditure" },
    { href: `${base}/assets`, label: "Assets & Liabilities" },
    { href: `${base}/family`, label: "Family" },
    { href: `${base}/lokayukta`, label: inv ? "DA & Blind Spots" : "Lokayukta DA" },
    { href: `${base}/income-tax`, label: "Income Tax" },
    { href: `${base}/queries`, label: inv ? "Query Management" : "Queries" },
    { href: `${base}/documents`, label: "Documents" },
    { href: `${base}/legal`, label: inv ? "Legal References" : "Legal" },
    { href: `${base}/reports`, label: inv ? "Investigation Reports" : "Reports" },
  ];

  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-5 w-40" /><Skeleton className="h-9 w-96" /><Skeleton className="h-10 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data;
  const a = access(c);

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
        <Link href="/cases" className="hover:text-foreground" data-testid="link-breadcrumb-cases">{inv ? "Assigned Investigations" : "Cases"}</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="truncate">{c.referenceNumber ?? `Case ${c.id}`}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2.5 mb-1">
        <h1 className="text-[26px] font-medium leading-tight" data-testid="text-case-title">{c.title}</h1>
        {c.isDemo && <DemoBadge />}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mb-4">
        <span>{CASE_TYPES[c.caseType]}</span>
        <span className="opacity-40">/</span>
        <StatusBadge status={c.status} />
        {c.subjectName && <><span className="opacity-40">/</span><span>Subject: <span className="text-foreground">{c.subjectName}</span></span></>}
        <span className="opacity-40">/</span>
        <Tag tone={a.canEdit ? "teal" : "brass"} data-testid="badge-access-role">{a.canEdit ? null : a.isInvestigator ? <Eye className="h-3 w-3" /> : <Lock className="h-3 w-3" />}Your access: {human(c.accessRole)}</Tag>
      </div>
      <nav className="sticky top-12 md:top-0 z-10 -mx-4 md:-mx-8 px-4 md:px-8 bg-background/92 backdrop-blur border-b mb-6 overflow-x-auto">
        <div className="flex gap-0.5 min-w-max">
          {tabs.map((t) => {
            const active = t.href === base ? location === base : location.startsWith(t.href);
            return (
              <Link key={t.href} href={t.href} data-testid={`tab-${t.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
                className={cn("relative px-3 py-2.5 text-[12.5px] transition-colors whitespace-nowrap", active ? "text-primary font-semibold" : "text-muted-foreground hover:text-foreground")}>
                {t.label}
                <span className={cn("absolute left-2 right-2 -bottom-px h-[2px] rounded-full bg-[hsl(var(--teal))] transition-transform origin-left", active ? "scale-x-100" : "scale-x-0")} />
              </Link>
            );
          })}
        </div>
      </nav>
      <div key={location}>{children(c)}</div>
    </div>
  );
}
