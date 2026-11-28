import { useState } from "react";
import { FileText, ExternalLink } from "lucide-react";
import type { AssistantMessageCitationsItem } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type PageRef = AssistantMessageCitationsItem & { page: number };
const pageUrl = (c: PageRef) => `${import.meta.env.BASE_URL}api/documents/${c.id}/pages/${c.page}/image`;
/** Page of a document citation; older answers only carry it in the label ("…, p. 3"). */
const pageOf = (c: AssistantMessageCitationsItem) => c.page ?? Number(c.label.match(/, p\. (\d+)$/)?.[1] ?? 0);

function PageThumb({ c, onOpen }: { c: PageRef; onOpen: () => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <button type="button" onClick={onOpen} title={c.label} data-testid={`source-page-${c.id}-${c.page}`}
      className="w-44 shrink-0 rounded-md border bg-card overflow-hidden text-left hover:border-primary">
      {failed ? <div className="h-56 grid place-items-center bg-muted"><FileText className="h-6 w-6 text-muted-foreground" /></div>
        : <img src={pageUrl(c)} alt={c.label} loading="lazy" onError={() => setFailed(true)} className="h-56 w-full object-cover object-top bg-white" />}
      <div className="px-1.5 py-1 text-[10px] leading-tight truncate">Page {c.page}</div>
      <div className="px-1.5 pb-1 text-[10px] leading-tight text-muted-foreground truncate">{c.label.replace(/, p\. \d+$/, "")}</div>
    </button>
  );
}

/** The document pages an answer relied on, shown as thumbnails that open the full page. */
export function SourcePages({ citations }: { citations: AssistantMessageCitationsItem[] }) {
  const pages: PageRef[] = citations.filter((c) => c.kind === "document" && pageOf(c)).map((c) => ({ ...c, page: pageOf(c) }));
  const [open, setOpen] = useState<PageRef | null>(null);
  if (!pages.length) return null;
  return (
    <div className="mt-2 pt-2 border-t">
      <div className="text-[11px] text-muted-foreground mb-1.5">Pages from your documents ({pages.length}) — click to enlarge</div>
      <div className="flex gap-2 overflow-x-auto pb-1">{pages.map((c) => <PageThumb key={`${c.id}:${c.page}`} c={c} onOpen={() => setOpen(c)} />)}</div>
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-4xl">
          {open && <>
            <DialogHeader>
              <DialogTitle className="font-display font-medium pr-6">{open.label}</DialogTitle>
              <DialogDescription>Page {open.page} of the uploaded document. Check the figures in the answer against this page.</DialogDescription>
            </DialogHeader>
            <div className="max-h-[70vh] overflow-auto rounded border bg-white"><img src={pageUrl(open)} alt={open.label} className="w-full" /></div>
            <a href={pageUrl(open)} target="_blank" rel="noreferrer" className="text-sm text-primary inline-flex items-center gap-1 hover:underline">Open page in new tab<ExternalLink className="h-3.5 w-3.5" /></a>
          </>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
