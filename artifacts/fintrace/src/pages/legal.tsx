import { useState } from "react";
import { Plus, Pencil, Search, ShieldCheck, Scale } from "lucide-react";
import {
  useListLegalReferences, useCreateLegalReference, useUpdateLegalReference, useVerifyLegalReference, getListLegalReferencesQueryKey,
  type LegalReference, type LegalReferenceInput, type LegalVerificationInputVerificationStatus,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { PageHeader, LoadingRows, ErrorState, EmptyState, Panel, useInvalidate, Notice, nativeSelect, Field } from "@/components/common";
import { EntityFormDialog, type FieldDef } from "@/components/entity-form";
import { LegalCard } from "@/components/legal-card";
import { LegalOnlineResults } from "@/components/legal-online-results";
import { LEGAL_CATEGORIES, human, errMsg, opts } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";

const FIELDS: FieldDef[] = [
  { name: "title", label: "Title", required: true, full: true },
  { name: "sourceType", label: "Source type", type: "select", options: opts(["judgment", "statute", "circular", "rule", "notification"]) },
  { name: "bindingStatus", label: "Binding status", type: "select", options: opts(["binding", "persuasive", "not_assessed"]) },
  { name: "court", label: "Court / issuing body" }, { name: "decisionDate", label: "Decision date", type: "date" },
  { name: "caseNumber", label: "Case number" }, { name: "citation", label: "Citation" },
  { name: "provision", label: "Provision" }, { name: "sourceUrl", label: "Source URL" },
  { name: "categories", label: "Categories (comma separated)", full: true, hint: LEGAL_CATEGORIES.join(", ") },
  { name: "legalIssue", label: "Legal issue", type: "textarea" }, { name: "principle", label: "Principle", type: "textarea" },
  { name: "summary", label: "Summary", type: "textarea" }, { name: "relevantParagraphs", label: "Relevant paragraphs" }, { name: "subsequentTreatment", label: "Subsequent treatment" },
];

export default function Legal() {
  const [s, setS] = useState(""); const [cat, setCat] = useState(""); const [st, setSt] = useState(""); const [vs, setVs] = useState("");
  const q = useListLegalReferences({ search: s || undefined, category: cat || undefined, sourceType: st || undefined, verificationStatus: vs || undefined });
  const cr = useCreateLegalReference(); const up = useUpdateLegalReference(); const ver = useVerifyLegalReference();
  const inv = useInvalidate(); const { toast } = useToast();
  const [form, setForm] = useState<{ open: boolean; edit?: LegalReference }>({ open: false });
  const [vf, setVf] = useState<LegalReference | null>(null); const [vStatus, setVStatus] = useState<LegalVerificationInputVerificationStatus>("verified"); const [vNote, setVNote] = useState("");
  const refresh = () => inv(getListLegalReferencesQueryKey());
  const fail = (e: unknown) => toast({ title: "Failed", description: errMsg(e), variant: "destructive" });

  return (
    <div>
      <PageHeader eyebrow="Shared library" title="Legal references" description="Judgments, statutes and circulars on disproportionate assets and income tax scrutiny. Verification is recorded per reference."
        actions={<Button onClick={() => setForm({ open: true })} data-testid="button-add-reference"><Plus />Add reference</Button>} />
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[220px]"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-8" placeholder="Search title, citation, principle" value={s} onChange={(e) => setS(e.target.value)} data-testid="input-search-legal" /></div>
        <select className={nativeSelect} value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{LEGAL_CATEGORIES.map((x) => <option key={x} value={x}>{human(x)}</option>)}</select>
        <select className={nativeSelect} value={st} onChange={(e) => setSt(e.target.value)}><option value="">All sources</option>{["judgment", "statute", "circular", "rule", "notification"].map((x) => <option key={x} value={x}>{human(x)}</option>)}</select>
        <select className={nativeSelect} value={vs} onChange={(e) => setVs(e.target.value)} data-testid="filter-verification"><option value="">Any verification</option>{["verified", "unverified", "disputed"].map((x) => <option key={x} value={x}>{human(x)}</option>)}</select>
      </div>
      <div className="mb-4"><Notice tone="brass">Unverified — not legal authority. Unverified entries are research leads only. Check each against the official reporter before citing it in a response.</Notice></div>
      {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.length ? (
        <Panel><EmptyState icon={<Scale className="h-6 w-6" />} title="No references found" body="Adjust the filters or add a reference." /></Panel>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4 stagger">{q.data.map((r) => (
          <LegalCard key={r.id} r={r} actions={<>
            <Button size="icon" variant="ghost" className="h-7 w-7" title="Record verification" onClick={() => { setVf(r); setVStatus("verified"); setVNote(""); }} data-testid={`button-verify-${r.id}`}><ShieldCheck /></Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setForm({ open: true, edit: r })} data-testid={`button-edit-reference-${r.id}`}><Pencil /></Button>
          </>} />
        ))}</div>
      )}
      <LegalOnlineResults query={s} onAdded={refresh} />
      <EntityFormDialog open={form.open} onOpenChange={(o) => setForm({ open: o, edit: form.edit })} title={form.edit ? "Edit reference" : "Add legal reference"} wide fields={FIELDS}
        description="New references start as unverified."
        initial={form.edit ? { ...(form.edit as unknown as Record<string, unknown>), categories: form.edit.categories.join(", ") } : { sourceType: "judgment", bindingStatus: "not_assessed" }} pending={cr.isPending || up.isPending}
        onSubmit={(v) => {
          const data = { ...v, categories: String(v.categories ?? "").split(",").map((x) => x.trim()).filter(Boolean) } as unknown as LegalReferenceInput;
          const cb = { onSuccess: () => { setForm({ open: false }); refresh(); }, onError: fail };
          form.edit ? up.mutate({ referenceId: form.edit.id, data }, cb) : cr.mutate({ data }, cb);
        }} />
      <Dialog open={!!vf} onOpenChange={(o) => !o && setVf(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-display font-medium text-xl">Record verification</DialogTitle><DialogDescription>{vf?.title}</DialogDescription></DialogHeader>
          <Field label="Status"><select className={nativeSelect} value={vStatus} onChange={(e) => setVStatus(e.target.value as LegalVerificationInputVerificationStatus)} data-testid="select-verification">{["verified", "unverified", "disputed"].map((x) => <option key={x} value={x}>{human(x)}</option>)}</select></Field>
          <Field label="Note"><Textarea rows={3} value={vNote} placeholder="Checked against SCC online; para 14 confirmed." onChange={(e) => setVNote(e.target.value)} data-testid="input-verification-note" /></Field>
          <DialogFooter><Button variant="outline" onClick={() => setVf(null)}>Cancel</Button>
            <Button disabled={ver.isPending} data-testid="button-save-verification" onClick={() => vf && ver.mutate({ referenceId: vf.id, data: { verificationStatus: vStatus, note: vNote } }, { onSuccess: () => { setVf(null); refresh(); }, onError: fail })}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
