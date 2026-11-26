import { useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, Sparkles, Loader2, Pencil, CheckCheck, Send, Eye, Plus, Gavel, History, CornerDownRight, CloudOff } from "lucide-react";
import {
  useGetQuery, useUpdateQuery, useCreateQueryResponse, useUpdateQueryResponse, useGenerateDraftResponse, useCreateAssessment,
  getGetQueryQueryKey, getListQueriesQueryKey, getGetDashboardSummaryQueryKey,
  type Case, type QueryResponse, type DraftResponse, type InvestigationQueryUpdateStatus, type AssessmentInputOutcome, type QueryResponseUpdateAction,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CaseLayout, access, useCaseId } from "@/components/case-layout";
import { Panel, LoadingRows, ErrorState, EmptyState, Tag, StatusBadge, AiBadge, useInvalidate, Notice, Money, nativeSelect, Field, SavedTick, useSavedFlash } from "@/components/common";
import { QueryFormDialog } from "@/components/query-form";
import { QUERY_STATUSES, fdate, fdatetime, human, errMsg } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function ResponseCard({ r, canEdit, canReview, queryId }: { r: QueryResponse; canEdit: boolean; canReview: boolean; queryId: number }) {
  const up = useUpdateQueryResponse();
  const inv = useInvalidate();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(r.body);
  const [saved, flash] = useSavedFlash();
  const approved = !!r.approvedAt;
  const locked = r.status !== "draft";
  const run = (data: { body?: string; action?: QueryResponseUpdateAction }, msg: string) => up.mutate({ responseId: r.id, data }, {
    onSuccess: () => { inv(getGetQueryQueryKey(queryId), getGetDashboardSummaryQueryKey()); flash(); setEditing(false); toast({ title: msg }); },
    onError: (e) => toast({ title: "Action failed", description: errMsg(e), variant: "destructive" }),
  });
  return (
    <div className={cn("rounded-lg border bg-card shadow-xs", r.isAiDraft && !approved && "border-[hsl(var(--accent-border))]")} data-testid={`card-response-${r.id}`}>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b">
        <span className="font-semibold text-sm">Version {r.version}</span><StatusBadge status={r.status} />
        {r.isAiDraft && !approved && <AiBadge label="AI suggestion — not approved" />}
        {r.isAiDraft && approved && <Tag tone="muted">AI-assisted, approved by {r.approvedBy}</Tag>}
        {approved && !r.isAiDraft && <Tag tone="success">Approved by {r.approvedBy}</Tag>}
        <SavedTick show={saved} />
        <span className="ml-auto text-[11px] text-muted-foreground">{r.authorName ?? "—"} · {fdatetime(r.createdAt)}{r.submittedAt ? ` · submitted ${fdatetime(r.submittedAt)}` : ""}</span>
      </div>
      <div className="p-4">
        {editing ? <Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} data-testid={`input-response-body-${r.id}`} /> : <div className="text-sm whitespace-pre-wrap leading-relaxed">{r.body}</div>}
      </div>
      {(canEdit || canReview) && (
        <div className="px-4 pb-3 flex flex-wrap justify-end gap-1.5">
          {canEdit && !locked && (editing ? (
            <><Button size="sm" variant="outline" onClick={() => { setBody(r.body); setEditing(false); }}>Cancel</Button><Button size="sm" disabled={up.isPending} onClick={() => run({ body }, "Draft saved")} data-testid={`button-save-response-${r.id}`}>Save draft</Button></>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)} data-testid={`button-edit-response-${r.id}`}><Pencil />Edit</Button>
              {!approved && <Button size="sm" variant="outline" disabled={up.isPending} onClick={() => run({ action: "approve" }, "Response approved")} data-testid={`button-approve-response-${r.id}`}><CheckCheck />Approve content</Button>}
              <Button size="sm" disabled={!approved || up.isPending} title={approved ? undefined : "Approve before submitting"} onClick={() => run({ action: "submit" }, "Response submitted")} data-testid={`button-submit-response-${r.id}`}><Send />Submit</Button>
            </>
          ))}
          {canReview && r.status === "submitted" && <Button size="sm" variant="outline" disabled={up.isPending} onClick={() => run({ action: "mark_under_review" }, "Marked under review")} data-testid={`button-review-response-${r.id}`}><Eye />Mark under review</Button>}
        </div>
      )}
    </div>
  );
}

function Body({ c }: { c: Case }) {
  const caseId = useCaseId();
  const { queryId: qid } = useParams<{ queryId: string }>();
  const queryId = Number(qid);
  const a = access(c);
  const { toast } = useToast();
  const inv = useInvalidate();
  const q = useGetQuery(queryId, { query: { enabled: !!queryId, queryKey: getGetQueryQueryKey(queryId) } });
  const upd = useUpdateQuery(); const cr = useCreateQueryResponse(); const gen = useGenerateDraftResponse(); const asmt = useCreateAssessment();
  const [newBody, setNewBody] = useState(""); const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [outcome, setOutcome] = useState<AssessmentInputOutcome>("accepted"); const [reasons, setReasons] = useState(""); const [respId, setRespId] = useState("");
  const [fu, setFu] = useState(false);
  const refresh = () => inv(getGetQueryQueryKey(queryId), getListQueriesQueryKey(caseId), getGetDashboardSummaryQueryKey());
  const fail = (e: unknown) => toast({ title: "Failed", description: errMsg(e), variant: "destructive" });

  if (q.isLoading) return <LoadingRows rows={10} />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const create = (body: string, isAiDraft: boolean) => cr.mutate({ queryId, data: { body, isAiDraft } }, { onSuccess: () => { setNewBody(""); setDraft(null); refresh(); toast({ title: isAiDraft ? "AI draft inserted as a new version" : "Draft response saved" }); }, onError: fail });

  return (
    <div className="space-y-5">
      <Link href={`/cases/${caseId}/queries`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-testid="link-back"><ArrowLeft className="h-3.5 w-3.5" />All queries</Link>
      <div className="grid xl:grid-cols-[1.6fr_1fr] gap-5">
        <div className="space-y-5">
          <div className="rounded-lg border bg-card shadow-xs p-5 rise">
            <div className="flex flex-wrap items-center gap-2">
              <span className="num text-sm font-semibold text-[hsl(var(--teal))]">Q {d.questionNumber}</span><StatusBadge status={d.status} /><Tag>{human(d.topic)}</Tag>
              {d.financialYear && <Tag className="num">FY {d.financialYear}</Tag>}{d.applicableSchedule && <Tag>{d.applicableSchedule}</Tag>}
              {d.parentQueryId && <Link href={`/cases/${caseId}/queries/${d.parentQueryId}`} className="text-xs underline">Follow-up of parent query</Link>}
            </div>
            <h2 className="font-display text-2xl mt-2">{d.subject}</h2>
            <p className="text-sm mt-2 whitespace-pre-wrap leading-relaxed">{d.description}</p>
            <div className="text-[11px] text-muted-foreground mt-3">Raised by {d.raisedBy ?? "—"} · {fdate(d.createdAt)} · Deadline <span className="num">{fdate(d.responseDeadline)}</span></div>
          </div>
          {!!d.relatedTransactions.length && (
            <Panel title="Related transactions" bodyClass="p-0">
              <table className="w-full text-[12.5px] dense-table"><tbody>{d.relatedTransactions.map((t) => (
                <tr key={t.id}><td className="num text-muted-foreground">{fdate(t.txnDate)}</td><td className="num text-[11px]">{t.maskedAccountNumber}</td><td className="max-w-[340px] truncate">{t.description}</td><td>{human(t.category)}</td><td className="text-right">{t.credit ? <Money v={t.credit} className="text-[hsl(var(--teal))]" /> : <Money v={-t.debit} />}</td></tr>
              ))}</tbody></table>
            </Panel>
          )}
          <div>
            <div className="flex items-center justify-between mb-2"><h3 className="font-display text-lg">Responses</h3><span className="text-xs text-muted-foreground">Submit is available only after a person approves the content.</span></div>
            {!d.responses.length ? <Panel><EmptyState title="No response yet" body={a.canEdit ? "Write a response below or generate an AI draft to start from." : "The case team has not responded yet."} /></Panel> : (
              <div className="space-y-3 stagger">{[...d.responses].sort((x, y) => y.version - x.version).map((r) => <ResponseCard key={r.id} r={r} canEdit={a.canEdit} canReview={a.isInvestigator} queryId={queryId} />)}</div>
            )}
          </div>
          {a.canEdit && (
            <Panel title="Write a response" actions={
              <Button size="sm" variant="outline" disabled={gen.isPending} data-testid="button-generate-draft" onClick={() => gen.mutate({ queryId }, { onSuccess: setDraft, onError: fail })}>
                {gen.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}Generate AI draft</Button>}>
              {draft && (
                <div className="mb-4 rounded-lg border border-[hsl(var(--accent-border))] bg-accent/30 p-4 rise" data-testid="panel-ai-draft">
                  {!draft.available ? (
                    <div className="flex items-start gap-3"><CloudOff className="h-5 w-5 text-muted-foreground" /><div><div className="font-medium text-sm">AI drafting is unavailable</div><div className="text-xs text-muted-foreground">{draft.message ?? "The AI service is not configured. Write the response manually."}</div></div></div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 mb-2"><AiBadge /><span className="text-xs text-muted-foreground">Review every statement against the record before using it.</span></div>
                      <div className="text-sm whitespace-pre-wrap leading-relaxed bg-card rounded border p-3 max-h-80 overflow-y-auto">{draft.body}</div>
                      {!!draft.citations.length && <div className="mt-2 flex flex-wrap gap-1">{draft.citations.map((x, i) => <Tag key={i} tone="teal">{x}</Tag>)}</div>}
                      {!!draft.gaps.length && <div className="mt-2"><div className="text-xs font-semibold text-[hsl(var(--brass))]">Gaps the draft could not fill</div><ul className="text-xs list-disc pl-5 mt-1">{draft.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul></div>}
                      <div className="mt-3 flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Discard</Button><Button size="sm" variant="outline" onClick={() => setNewBody(draft.body)}>Copy into editor</Button><Button size="sm" disabled={cr.isPending} onClick={() => create(draft.body, true)} data-testid="button-insert-draft">Insert as AI draft</Button></div>
                    </>
                  )}
                </div>
              )}
              <Textarea rows={7} value={newBody} onChange={(e) => setNewBody(e.target.value)} placeholder="Explain the entries in question, with references to statements, deeds and returns." data-testid="input-new-response" />
              <div className="flex justify-end mt-2"><Button disabled={!newBody.trim() || cr.isPending} onClick={() => create(newBody, false)} data-testid="button-save-new-response">{cr.isPending && <Loader2 className="animate-spin" />}Save as draft</Button></div>
            </Panel>
          )}
        </div>
        <div className="space-y-5">
          <Panel title="Status">
            {a.canEdit || a.isInvestigator ? (
              <select className={nativeSelect + " w-full"} value={d.status} disabled={upd.isPending} onChange={(e) => upd.mutate({ queryId, data: { status: e.target.value as InvestigationQueryUpdateStatus } }, { onSuccess: refresh, onError: fail })} data-testid="select-query-status">
                {QUERY_STATUSES.map((s) => <option key={s} value={s}>{human(s)}</option>)}
              </select>
            ) : <StatusBadge status={d.status} />}
          </Panel>
          <Panel title={<span className="flex items-center gap-1.5"><Gavel className="h-4 w-4" />Assessments</span>} description="Recorded by investigators with reasons. An assessment is a view on a response, not a legal finding.">
            {!d.assessments.length ? <div className="text-xs text-muted-foreground">No assessments recorded.</div> : (
              <div className="space-y-2.5 mb-3">{d.assessments.map((x) => (
                <div key={x.id} className="rounded border p-2.5"><div className="flex items-center gap-2"><StatusBadge status={x.outcome} /><span className="text-[11px] text-muted-foreground ml-auto">{x.assessorName} · {fdate(x.createdAt)}</span></div><p className="text-xs mt-1.5 whitespace-pre-wrap">{x.reasons}</p></div>
              ))}</div>
            )}
            {a.isInvestigator && (
              <div className="space-y-2 border-t pt-3">
                <Field label="Outcome"><select className={nativeSelect} value={outcome} onChange={(e) => setOutcome(e.target.value as AssessmentInputOutcome)} data-testid="select-outcome">{["accepted", "disputed", "unresolved", "clarification_required"].map((o) => <option key={o} value={o}>{human(o)}</option>)}</select></Field>
                <Field label="On response"><select className={nativeSelect} value={respId} onChange={(e) => setRespId(e.target.value)}><option value="">Query as a whole</option>{d.responses.map((r) => <option key={r.id} value={r.id}>Version {r.version}</option>)}</select></Field>
                <Field label="Reasons *"><Textarea rows={3} value={reasons} onChange={(e) => setReasons(e.target.value)} data-testid="input-reasons" /></Field>
                <Button className="w-full" disabled={!reasons.trim() || asmt.isPending} data-testid="button-record-assessment"
                  onClick={() => asmt.mutate({ queryId, data: { outcome, reasons, responseId: respId ? Number(respId) : null } }, { onSuccess: () => { setReasons(""); refresh(); toast({ title: "Assessment recorded" }); }, onError: fail })}>Record assessment</Button>
              </div>
            )}
          </Panel>
          <Panel title="Follow-up questions" actions={(a.isInvestigator || a.canEdit) && <Button size="sm" variant="outline" onClick={() => setFu(true)} data-testid="button-follow-up"><Plus />Follow-up</Button>}>
            {!d.followUps.length ? <div className="text-xs text-muted-foreground">None.</div> : d.followUps.map((f) => (
              <Link key={f.id} href={`/cases/${caseId}/queries/${f.id}`} className="flex items-center gap-2 py-1.5 text-sm hover:text-primary"><CornerDownRight className="h-3.5 w-3.5 text-muted-foreground" /><span className="num text-xs">{f.questionNumber}</span><span className="truncate flex-1">{f.subject}</span><StatusBadge status={f.status} /></Link>
            ))}
          </Panel>
          <Panel title={<span className="flex items-center gap-1.5"><History className="h-4 w-4" />History</span>}>
            {!d.history.length ? <div className="text-xs text-muted-foreground">No history.</div> : (
              <ol className="border-l ml-1.5 space-y-2.5">{d.history.map((h) => (
                <li key={h.id} className="pl-3 relative text-xs"><span className="absolute -left-[4px] top-1 h-2 w-2 rounded-full bg-[hsl(var(--teal))]" /><div><b>{h.userName ?? "System"}</b> {h.summary ?? human(h.action)}</div><div className="text-muted-foreground num text-[10.5px]">{fdatetime(h.createdAt)}</div></li>
              ))}</ol>
            )}
          </Panel>
          <Notice>Responses and assessments are working records. Neither FINTRACE nor any AI output decides whether an explanation is legally sufficient.</Notice>
        </div>
      </div>
      <QueryFormDialog caseId={caseId} open={fu} onOpenChange={setFu} parentQueryId={queryId} />
    </div>
  );
}

export default function QueryDetail() {
  return <CaseLayout>{(c) => <Body c={c} />}</CaseLayout>;
}
