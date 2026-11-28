import { Link, useLocation, useParams } from "wouter";
import { FileText } from "lucide-react";
import { useListCases, useGetCase, getGetCaseQueryKey } from "@workspace/api-client-react";
import { LoadingRows, ErrorState, EmptyState, PageHeader, nativeSelect } from "@/components/common";
import { DocumentsBody } from "@/pages/documents";
import { cn } from "@/lib/utils";

function CaseDocuments({ caseId }: { caseId: number }) {
  const q = useGetCase(caseId, { query: { queryKey: getGetCaseQueryKey(caseId) } });
  if (q.isLoading) return <LoadingRows />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <DocumentsBody key={caseId} c={q.data} />;
}

/** Standalone documents page reached from the sidebar, with a case picker. */
export default function DocumentsLibrary() {
  const params = useParams<{ caseId?: string }>();
  const [, nav] = useLocation();
  const cases = useListCases();
  const caseId = Number(params.caseId) || cases.data?.[0]?.id;

  return (
    <div>
      <PageHeader eyebrow="Records" title="Documents" description="Upload, read and manage the documents of a case."
        actions={!!cases.data?.length && (
          <select className={cn(nativeSelect, "min-w-64")} value={caseId ?? ""} onChange={(e) => nav(`/documents/${e.target.value}`)} data-testid="select-documents-case">
            {cases.data.map((x) => <option key={x.id} value={x.id}>{x.title}{x.subjectName ? ` — ${x.subjectName}` : ""}</option>)}
          </select>
        )} />
      {cases.isLoading ? <LoadingRows /> : cases.isError ? <ErrorState error={cases.error} onRetry={() => cases.refetch()} />
        : !caseId ? <EmptyState icon={<FileText className="h-6 w-6" />} title="No cases yet" body={<>Create a case first, then upload its documents here. <Link href="/cases" className="underline">Go to cases</Link></>} />
        : <CaseDocuments caseId={caseId} />}
    </div>
  );
}
