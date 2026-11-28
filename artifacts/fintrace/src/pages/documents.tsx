import { useRef, useState } from "react";
import { FileText, Upload, Loader2, Download, Archive, Pencil, Search, Copy, Layers, X } from "lucide-react";
import {
  useListDocuments, useCreateDocument, useUpdateDocument, useArchiveDocument, useRequestUploadUrl, getListDocumentsQueryKey, getGetCaseSummaryQueryKey,
  type Case, type Document, type DocumentInputCategory,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { CaseLayout, access } from "@/components/case-layout";
import { Panel, LoadingRows, ErrorState, EmptyState, Tag, useInvalidate, Notice, nativeSelect, Field, ConfirmButton } from "@/components/common";
import { EntityFormDialog, type FieldDef } from "@/components/entity-form";
import { DOC_CATEGORIES, fdatetime, human, n, errMsg, opts } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { DocumentIndexTag, ReindexButton, isIndexing } from "@/components/document-index-status";

async function sha256(file: File) {
  const buf = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function UploadDialog({ caseId, open, onOpenChange, prev }: { caseId: number; open: boolean; onOpenChange: (o: boolean) => void; prev?: Document | null }) {
  const reqUrl = useRequestUploadUrl(); const create = useCreateDocument();
  const inv = useInvalidate(); const { toast } = useToast();
  // A new version replaces exactly one document; a fresh upload may take several files at once.
  const multiple = !prev;
  const [files, setFiles] = useState<File[]>([]);
  const [cat, setCat] = useState<string>(prev?.category ?? "bank_statement");
  const [fy, setFy] = useState(prev?.financialYear ?? ""); const [desc, setDesc] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const busy = progress !== null;

  const uploadOne = async (file: File) => {
    const hash = await sha256(file);
    const contentType = file.type || "application/octet-stream";
    const { uploadURL, objectPath } = await reqUrl.mutateAsync({ data: { name: file.name, size: file.size, contentType } });
    const put = await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": contentType }, credentials: "include" });
    if (!put.ok) throw new Error(`Upload failed (${put.status})`);
    return create.mutateAsync({ caseId, data: { name: file.name, category: cat as DocumentInputCategory, description: desc || null, objectPath, sha256: hash, sizeBytes: file.size, contentType, financialYear: fy || null, previousVersionId: prev?.id ?? null } });
  };

  const go = async () => {
    if (!files.length) return;
    const failed: File[] = []; let done = 0; let dupes = 0; let lastVersion = 1;
    for (const [i, file] of files.entries()) {
      setProgress(i);
      try {
        const doc = await uploadOne(file);
        done++; if (doc.isDuplicate) dupes++; lastVersion = doc.version;
      } catch (e) {
        failed.push(file);
        toast({ title: `Upload failed: ${file.name}`, description: errMsg(e), variant: "destructive" });
      }
    }
    setProgress(null);
    if (done) {
      inv(getListDocumentsQueryKey(caseId), getGetCaseSummaryQueryKey(caseId));
      toast({
        title: prev ? `Uploaded version ${lastVersion}` : `Uploaded ${done} document${done === 1 ? "" : "s"}`,
        description: dupes ? `${dupes} file${dupes === 1 ? " matches" : "s match"} an existing document in this case (same SHA-256).` : undefined,
      });
    }
    // Keep only the failed files selected so they can be retried.
    setFiles(failed);
    if (!failed.length) { onOpenChange(false); setDesc(""); }
  };

  const pick = (list: FileList | null) => setFiles(list ? Array.from(list) : []);
  const total = files.reduce((t, f) => t + f.size, 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle className="font-display font-medium text-xl">{prev ? `New version of ${prev.name}` : "Upload documents"}</DialogTitle><DialogDescription>Each file is fingerprinted with SHA-256 so duplicates and altered copies can be identified.</DialogDescription></DialogHeader>
        <button type="button" disabled={busy} onClick={() => ref.current?.click()} className={cn("w-full rounded-lg border-2 border-dashed p-6 text-center", files.length ? "border-[hsl(var(--teal))] bg-accent/40" : "hover:bg-muted/60")} data-testid="button-pick-document">
          <Upload className="h-6 w-6 mx-auto text-[hsl(var(--teal))]" />
          <div className="text-sm mt-2 font-medium">{files.length === 0 ? (multiple ? "Choose one or more files" : "Choose a file") : files.length === 1 ? files[0]!.name : `${files.length} files selected`}</div>
          {files.length > 0 && <div className="text-xs text-muted-foreground num">{n(total)} bytes</div>}
        </button>
        <input ref={ref} type="file" multiple={multiple} className="hidden" onChange={(e) => { pick(e.target.files); e.target.value = ""; }} data-testid="input-document-file" />
        {files.length > 1 && (
          <ul className="max-h-36 overflow-y-auto rounded-md border divide-y text-sm" data-testid="list-selected-files">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className={cn("flex items-center justify-between gap-3 px-3 py-1.5", progress === i && "bg-accent/40")}>
                <span className="truncate">{f.name}</span>
                <span className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground num">
                  {progress === i && <Loader2 className="h-3 w-3 animate-spin" />}{n(f.size)} bytes
                  {!busy && <button type="button" className="hover:text-foreground" title="Remove" onClick={() => setFiles(files.filter((_, j) => j !== i))}><X className="h-3.5 w-3.5" /></button>}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category"><select className={nativeSelect} value={cat} onChange={(e) => setCat(e.target.value)} data-testid="select-document-category">{DOC_CATEGORIES.map((c) => <option key={c} value={c}>{human(c)}</option>)}</select></Field>
          <Field label="Financial year"><Input value={fy} placeholder="2018-19" onChange={(e) => setFy(e.target.value)} /></Field>
          <Field label="Description" className="col-span-2"><Input value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
        </div>
        {files.length > 1 && <p className="text-xs text-muted-foreground -mt-1">Category, financial year and description apply to every selected file; each can be edited afterwards.</p>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!files.length || busy} onClick={go} data-testid="button-upload-document">
            {busy && <Loader2 className="animate-spin" />}
            {busy && files.length > 1 ? `Uploading ${progress! + 1} of ${files.length}` : files.length > 1 ? `Upload ${files.length} files` : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DocumentsBody({ c }: { c: Case }) {
  const caseId = c.id;
  const a = access(c);
  const inv = useInvalidate(); const { toast } = useToast();
  const [cat, setCat] = useState(""); const [s, setS] = useState("");
  const params = { category: cat || undefined, search: s || undefined };
  const q = useListDocuments(caseId, params, {
    // Poll while any document is still being read and indexed in the background.
    query: { queryKey: getListDocumentsQueryKey(caseId, params), refetchInterval: (query) => (query.state.data?.some(isIndexing) ? 4000 : false) },
  });
  const upd = useUpdateDocument(); const arc = useArchiveDocument();
  const [up, setUp] = useState<{ open: boolean; prev?: Document | null }>({ open: false });
  const [edit, setEdit] = useState<Document | null>(null);
  const fail = (e: unknown) => toast({ title: "Failed", description: errMsg(e), variant: "destructive" });
  const fields: FieldDef[] = [
    { name: "name", label: "Name", required: true, full: true }, { name: "category", label: "Category", type: "select", options: opts(DOC_CATEGORIES) },
    { name: "financialYear", label: "Financial year" }, { name: "description", label: "Description", type: "textarea" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="font-display text-xl">Document vault</h2><p className="text-xs text-muted-foreground">Statements, returns, deeds and notices, versioned and hashed.</p></div>
        <div className="flex flex-wrap gap-2">
          <div className="relative"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-8 w-52" placeholder="Search" value={s} onChange={(e) => setS(e.target.value)} data-testid="input-search-documents" /></div>
          <select className={nativeSelect} value={cat} onChange={(e) => setCat(e.target.value)} data-testid="filter-document-category"><option value="">All categories</option>{DOC_CATEGORIES.map((x) => <option key={x} value={x}>{human(x)}</option>)}</select>
          {a.canEdit && <Button onClick={() => setUp({ open: true })} data-testid="button-upload"><Upload />Upload</Button>}
        </div>
      </div>
      <Panel bodyClass="p-0">
        {q.isLoading ? <div className="p-4"><LoadingRows /></div> : q.isError ? <div className="p-4"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div> : !q.data?.length ? (
          <EmptyState icon={<FileText className="h-6 w-6" />} title="No documents" body="Upload ITRs, Form 16, sale deeds, loan sanction letters and the notice itself." action={a.canEdit && <Button onClick={() => setUp({ open: true })}><Upload />Upload</Button>} />
        ) : (
          <div className="overflow-x-auto"><table className="w-full text-[12.5px] dense-table">
            <thead className="bg-muted/50"><tr><th className="text-left">Document</th><th className="text-left">Category</th><th className="text-left">FY</th><th className="text-right">Size</th><th className="text-left">SHA-256</th><th className="text-left">Uploaded</th><th /></tr></thead>
            <tbody className="stagger">{q.data.map((d) => (
              <tr key={d.id} className={cn(d.isArchived && "opacity-55")} data-testid={`row-document-${d.id}`}>
                <td className="max-w-[300px]"><div className="flex items-center gap-1.5"><FileText className="h-4 w-4 text-[hsl(var(--teal))] shrink-0" /><span className="truncate font-medium">{d.name}</span></div>
                  <div className="flex gap-1 mt-0.5">{d.version > 1 && <Tag tone="navy"><Layers className="h-3 w-3" />v{d.version}</Tag>}{d.isDuplicate && <Tag tone="brass"><Copy className="h-3 w-3" />Duplicate</Tag>}{d.isArchived && <Tag>Archived</Tag>}{!!d.transactionIds.length && <Tag tone="teal">{d.transactionIds.length} txns</Tag>}<DocumentIndexTag d={d} /></div>
                  {d.description && <div className="text-[11px] text-muted-foreground truncate">{d.description}</div>}</td>
                <td>{human(d.category)}</td><td className="num">{d.financialYear ?? "—"}</td>
                <td className="text-right num">{(d.sizeBytes / 1024).toFixed(1)} KB</td>
                <td className="num text-[10.5px] text-muted-foreground" title={d.sha256}>{d.sha256.slice(0, 12)}…</td>
                <td className="text-xs">{fdatetime(d.createdAt)}<div className="text-[10.5px] text-muted-foreground">{d.uploadedBy}</div></td>
                <td className="text-right"><div className="flex justify-end gap-0.5">
                  <a href={`${import.meta.env.BASE_URL}api/storage${d.objectPath}`} target="_blank" rel="noreferrer" className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted" title="Download" data-testid={`link-download-${d.id}`}><Download className="h-4 w-4" /></a>
                  {a.canEdit && !d.isArchived && <>
                    <Button size="icon" variant="ghost" title="Upload new version" onClick={() => setUp({ open: true, prev: d })} data-testid={`button-version-${d.id}`}><Layers /></Button>
                    <Button size="icon" variant="ghost" onClick={() => setEdit(d)} data-testid={`button-edit-document-${d.id}`}><Pencil /></Button>
                    {d.indexStatus !== "not_indexed" && <ReindexButton d={d} caseId={caseId} />}
                    <ConfirmButton title="Archive document?" description="Archived documents stay in the audit record but are hidden from reports." confirmLabel="Archive" onConfirm={() => arc.mutate({ documentId: d.id }, { onSuccess: () => inv(getListDocumentsQueryKey(caseId)), onError: fail })} trigger={<Button size="icon" variant="ghost" data-testid={`button-archive-${d.id}`}><Archive /></Button>} />
                  </>}
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      <Notice>Files are kept in private object storage. Downloads require your signed-in session.</Notice>
      <UploadDialog caseId={caseId} key={up.prev?.id ?? "new"} open={up.open} prev={up.prev} onOpenChange={(o) => setUp({ open: o, prev: o ? up.prev : null })} />
      <EntityFormDialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title="Edit document" fields={fields} initial={edit as unknown as Record<string, unknown>} pending={upd.isPending}
        onSubmit={(v) => edit && upd.mutate({ documentId: edit.id, data: v as never }, { onSuccess: () => { setEdit(null); inv(getListDocumentsQueryKey(caseId)); }, onError: fail })} />
    </div>
  );
}

export default function Documents() {
  return <CaseLayout>{(c) => <DocumentsBody c={c} />}</CaseLayout>;
}
