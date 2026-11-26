import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import type { LegalReference } from "@workspace/api-client-react";
import { Tag, VerificationBadge } from "@/components/common";
import { fdate, human } from "@/lib/format";

export function LegalCard({ r, actions, footer }: { r: LegalReference; actions?: ReactNode; footer?: ReactNode }) {
  return (
    <div className="rounded-lg border bg-card shadow-xs p-4" data-testid={`card-legal-${r.id}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <VerificationBadge status={r.verificationStatus} full />
        <Tag tone="navy">{human(r.sourceType)}</Tag>
        <Tag tone={r.bindingStatus === "binding" ? "teal" : "muted"}>{human(r.bindingStatus)}</Tag>
        <div className="ml-auto flex gap-1">{actions}</div>
      </div>
      <div className="font-display text-lg leading-snug mt-2">{r.title}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{[r.court, r.caseNumber, r.citation, r.provision, r.decisionDate && fdate(r.decisionDate)].filter(Boolean).join(" · ")}</div>
      {r.principle && <p className="text-sm mt-2 border-l-2 border-[hsl(var(--teal))] pl-3 italic">{r.principle}</p>}
      {r.summary && <p className="text-sm mt-2 text-muted-foreground">{r.summary}</p>}
      {r.relevantParagraphs && <div className="text-xs mt-1.5"><b>Relevant paragraphs:</b> {r.relevantParagraphs}</div>}
      {r.subsequentTreatment && <div className="text-xs mt-1"><b>Subsequent treatment:</b> {r.subsequentTreatment}</div>}
      <div className="flex flex-wrap items-center gap-1 mt-2">
        {r.categories.map((c) => <Tag key={c}>{human(c)}</Tag>)}
        {r.sourceUrl && <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-primary inline-flex items-center gap-1 ml-auto hover:underline">Source<ExternalLink className="h-3 w-3" /></a>}
      </div>
      {r.verificationStatus !== "unverified" && (r.verifiedBy || r.verificationNote) && <div className="text-[11px] text-muted-foreground mt-2 border-t pt-2">{human(r.verificationStatus)} by {r.verifiedBy ?? "—"} {r.verifiedAt ? `on ${fdate(r.verifiedAt)}` : ""}{r.verificationNote ? ` — ${r.verificationNote}` : ""}</div>}
      {footer}
    </div>
  );
}
