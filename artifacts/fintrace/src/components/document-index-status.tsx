import { Loader2, ScanSearch, AlertTriangle, Eye, RefreshCw } from "lucide-react";
import { useReindexDocument, getListDocumentsQueryKey, type Document } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Tag, useInvalidate } from "@/components/common";
import { useToast } from "@/hooks/use-toast";
import { errMsg } from "@/lib/format";

export const isIndexing = (d: Document) => d.indexStatus === "queued" || d.indexStatus === "processing";

/** Search-index badge: how the document was read (text / vision) and whether it is searchable. */
export function DocumentIndexTag({ d }: { d: Document }) {
  if (isIndexing(d)) return <Tag tone="brass" data-testid={`tag-index-${d.id}`}><Loader2 className="h-3 w-3 animate-spin" />{d.indexStatus === "queued" ? "Queued" : "Reading…"}</Tag>;
  if (d.indexStatus === "failed") return <span title={d.indexError ?? undefined}><Tag tone="danger" data-testid={`tag-index-${d.id}`}><AlertTriangle className="h-3 w-3" />Not searchable</Tag></span>;
  if (d.indexStatus !== "indexed") return null;
  const title = [`${d.indexedPages} page(s), ${d.indexedChunks} passage(s)`, d.visionPages ? `${d.visionPages} page(s) read by vision AI` : "", d.indexError ?? ""].filter(Boolean).join(" · ");
  return (
    <span title={title}>
      <Tag tone="success" data-testid={`tag-index-${d.id}`}>
        {d.visionPages ? <Eye className="h-3 w-3" /> : <ScanSearch className="h-3 w-3" />}
        Searchable{d.visionPages ? ` · ${d.visionPages} vision` : ""}
        {d.indexError && <AlertTriangle className="h-3 w-3" />}
      </Tag>
    </span>
  );
}

export function ReindexButton({ d, caseId }: { d: Document; caseId: number }) {
  const re = useReindexDocument();
  const inv = useInvalidate();
  const { toast } = useToast();
  return (
    <Button size="icon" variant="ghost" title="Re-read and re-index for search" disabled={re.isPending || isIndexing(d)}
      onClick={() => re.mutate({ documentId: d.id }, { onSuccess: () => inv(getListDocumentsQueryKey(caseId)), onError: (e) => toast({ title: "Re-index failed", description: errMsg(e), variant: "destructive" }) })}
      data-testid={`button-reindex-${d.id}`}>
      <RefreshCw />
    </Button>
  );
}
