import { useState } from "react";
import { Link } from "wouter";
import { Plus, Unlink, Scale, Search } from "lucide-react";
import {
  useListCaseLegalLinks, useCreateCaseLegalLink, useDeleteCaseLegalLink, useListLegalReferences, useListQueries, getListCaseLegalLinksQueryKey, type Case,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { CaseLayout, access, useCaseId } from "@/components/case-layout";
import { LoadingRows, ErrorState, EmptyState, Panel, useInvalidate, Notice, nativeSelect, Field, ConfirmButton, VerificationBadge } from "@/components/common";
import { LegalCard } from "@/components/legal-card";
import { errMsg } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function Body({ c }: { c: Case }) {
  const caseId = useCaseId();
  const a = access(c);
  const links = useListCaseLegalLinks(caseId);
  const queries = useListQueries(caseId);
  const [open, setOpen] = useState(false); const [s, setS] = useState("");
  const refs = useListLegalReferences({ search: s || undefined });
  const cr = useCreateCaseLegalLink(); const del = useDeleteCaseLegalLink();
  const inv = useInvalidate(); const { toast } = useToast();
  const [sel, setSel] = useState<number | null>(null); const [qid, setQid] = useState(""); const [note, setNote] = useState("");
  const fail = (e: unknown) => toast({ title: "Failed", description: errMsg(e), variant: "destructive" });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="font-display text-xl">Legal references for this case</h2><p className="text-xs text-muted-foreground">Linked from the shared <Link href="/legal" className="underline">legal library</Link>, with a note on why each matters here.</p></div>
        {a.canEdit && <Button onClick={() => setOpen(true)} data-testid="button-link-reference"><Plus />Link reference</Button>}
      </div>
      <Notice tone="brass">Unverified references are research leads, not legal authority. Confirm against the official reporter before citing.</Notice>
      {links.isLoading ? <LoadingRows /> : links.isError ? <ErrorState error={links.error} onRetry={() => links.refetch()} /> : !links.data?.length ? (
        <Panel><EmptyState icon={<Scale className="h-6 w-6" />} title="No references linked" body="Link judgments, statutes and circulars relevant to the questions in this case." /></Panel>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4 stagger">{links.data.map((l) => (
          <LegalCard key={l.id} r={l.reference}
            actions={a.canEdit && <ConfirmButton title="Unlink reference?" description="The reference stays in the library." confirmLabel="Unlink" onConfirm={() => del.mutate({ linkId: l.id }, { onSuccess: () => inv(getListCaseLegalLinksQueryKey(caseId)), onError: fail })} trigger={<Button size="icon" variant="ghost" className="h-7 w-7" data-testid={`button-unlink-${l.id}`}><Unlink /></Button>} />}
            footer={(l.relevanceNote || l.queryId) && <div className="mt-2 rounded bg-accent/40 px-2.5 py-1.5 text-xs"><b>Relevance:</b> {l.relevanceNote ?? "—"}{l.queryId && <> · <Link href={`/cases/${caseId}/queries/${l.queryId}`} className="underline">Query {queries.data?.find((x) => x.id === l.queryId)?.questionNumber ?? l.queryId}</Link></>}</div>} />
        ))}</div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display font-medium text-xl">Link a legal reference</DialogTitle><DialogDescription>Choose from the shared library.</DialogDescription></DialogHeader>
          <div className="relative"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-8" placeholder="Search library" value={s} onChange={(e) => setS(e.target.value)} /></div>
          <div className="max-h-64 overflow-y-auto rounded border divide-y">
            {(refs.data ?? []).map((r) => (
              <button key={r.id} type="button" onClick={() => setSel(r.id)} className={cn("w-full text-left px-3 py-2 hover:bg-muted/50", sel === r.id && "bg-accent/60")} data-testid={`option-reference-${r.id}`}>
                <div className="flex items-center gap-2"><VerificationBadge status={r.verificationStatus} /><span className="text-sm font-medium truncate">{r.title}</span></div>
                <div className="text-[11px] text-muted-foreground">{[r.court, r.citation, r.provision].filter(Boolean).join(" · ")}</div>
              </button>
            ))}
            {refs.data && !refs.data.length && <div className="p-4 text-xs text-muted-foreground">No matches. Add it in the <Link href="/legal" className="underline">legal library</Link> first.</div>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="For query (optional)"><select className={nativeSelect} value={qid} onChange={(e) => setQid(e.target.value)}><option value="">Case-wide</option>{(queries.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.questionNumber} — {x.subject}</option>)}</select></Field>
            <Field label="Relevance note"><Input value={note} onChange={(e) => setNote(e.target.value)} data-testid="input-relevance" /></Field>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!sel || cr.isPending} data-testid="button-confirm-link" onClick={() => sel && cr.mutate({ caseId, data: { legalReferenceId: sel, queryId: qid ? Number(qid) : null, relevanceNote: note || null } }, { onSuccess: () => { setOpen(false); setSel(null); setNote(""); setQid(""); inv(getListCaseLegalLinksQueryKey(caseId)); }, onError: fail })}>Link</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function CaseLegal() {
  return <CaseLayout>{(c) => <Body c={c} />}</CaseLayout>;
}
