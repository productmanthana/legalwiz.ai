import { FileDown, FileSpreadsheet, FileText, History } from "lucide-react";
import { useListReportTypes, useListGeneratedReports, getListGeneratedReportsQueryKey, type Case } from "@workspace/api-client-react";
import { CaseLayout, useCaseId } from "@/components/case-layout";
import { LoadingRows, ErrorState, EmptyState, Panel, Tag, Notice, DemoBadge, useInvalidate } from "@/components/common";
import { fdatetime, human } from "@/lib/format";

function Body({ c }: { c: Case }) {
  const caseId = useCaseId();
  const types = useListReportTypes();
  const gen = useListGeneratedReports(caseId);
  const inv = useInvalidate();
  const href = (key: string, fmt: string) => `${import.meta.env.BASE_URL}api/cases/${caseId}/reports/export?type=${key}&format=${fmt}`;

  return (
    <div className="space-y-5">
      <div><h2 className="font-display text-xl">Reports</h2><p className="text-xs text-muted-foreground">Generated from the current record. Every export is logged.</p></div>
      {c.isDemo && <Notice tone="brass"><span className="inline-flex items-center gap-2"><DemoBadge />Exports from this case are marked as demo data.</span></Notice>}
      {types.isLoading ? <LoadingRows /> : types.isError ? <ErrorState error={types.error} onRetry={() => types.refetch()} /> : (
        <div className="grid md:grid-cols-2 gap-4 stagger">{(types.data ?? []).map((t) => (
          <div key={t.key} className="rounded-lg border bg-card shadow-xs p-4 flex flex-col" data-testid={`card-report-${t.key}`}>
            <div className="flex items-start gap-3"><div className="h-9 w-9 rounded-md bg-accent grid place-items-center text-[hsl(var(--teal))]"><FileText className="h-4.5 w-4.5" /></div>
              <div className="flex-1"><div className="font-display text-lg leading-tight">{t.name}</div><p className="text-xs text-muted-foreground mt-1">{t.description}</p></div></div>
            <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t">
              {t.formats.map((f) => (
                <a key={f} href={href(t.key, f)} target="_blank" rel="noreferrer" onClick={() => setTimeout(() => inv(getListGeneratedReportsQueryKey(caseId)), 1500)}
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:border-primary hover:text-primary" data-testid={`link-export-${t.key}-${f}`}>
                  {f === "docx" ? <FileSpreadsheet className="h-3.5 w-3.5" /> : <FileDown className="h-3.5 w-3.5" />}{f.toUpperCase()}
                </a>
              ))}
            </div>
          </div>
        ))}</div>
      )}
      <Panel title={<span className="flex items-center gap-1.5"><History className="h-4 w-4" />Export history</span>} bodyClass="p-0">
        {gen.isLoading ? <div className="p-4"><LoadingRows rows={3} /></div> : gen.isError ? <div className="p-4"><ErrorState error={gen.error} /></div> : !gen.data?.length ? <EmptyState title="No exports yet" /> : (
          <table className="w-full text-[12.5px] dense-table"><thead className="bg-muted/50"><tr><th className="text-left">Report</th><th className="text-left">Format</th><th className="text-left">By</th><th className="text-right">When</th></tr></thead>
            <tbody>{gen.data.map((g) => <tr key={g.id}><td>{types.data?.find((t) => t.key === g.reportType)?.name ?? human(g.reportType)}</td><td><Tag>{g.format.toUpperCase()}</Tag></td><td>{g.generatedBy ?? "—"}</td><td className="text-right num">{fdatetime(g.createdAt)}</td></tr>)}</tbody></table>
        )}
      </Panel>
      <Notice>Reports organise the record for review. They are not legal opinions and do not decide whether any income or asset is lawful.</Notice>
    </div>
  );
}

export default function Reports() {
  return <CaseLayout>{(c) => <Body c={c} />}</CaseLayout>;
}
