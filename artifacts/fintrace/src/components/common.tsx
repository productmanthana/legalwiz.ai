import { useState, type ReactNode } from "react";
import { AlertTriangle, ShieldCheck, ShieldAlert, ShieldQuestion, Sparkles, RotateCw, Inbox, Check } from "lucide-react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { human, inr } from "@/lib/format";

export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: QueryKey[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k })));
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between mb-6 rise">
      <div className="min-w-0">
        {eyebrow && <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-[hsl(var(--teal))] mb-1.5">{eyebrow}</div>}
        <h1 className="text-[28px] leading-tight font-medium text-foreground">{title}</h1>
        {description && <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, description, actions, children, className, bodyClass }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={cn("rounded-lg border bg-card shadow-xs rise", className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 px-4 py-3 border-b">
          <div className="min-w-0">
            <h3 className="font-sans text-[13px] font-semibold tracking-tight">{title}</h3>
            {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={cn("p-4", bodyClass)}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "teal" | "brass" | "danger" }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3 shadow-xs">
      <div className="text-[10.5px] uppercase tracking-[0.1em] font-semibold text-muted-foreground">{label}</div>
      <div className={cn("num text-xl mt-1 font-medium",
        tone === "teal" && "text-[hsl(var(--teal))]", tone === "brass" && "text-[hsl(var(--brass))]", tone === "danger" && "text-destructive")}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

export function Money({ v, className, dim }: { v: number | null | undefined; className?: string; dim?: boolean }) {
  if (!v && dim) return <span className="num text-muted-foreground/50">—</span>;
  return <span className={cn("num", className)}>{inr(v)}</span>;
}

const toneMap: Record<string, string> = {
  teal: "bg-accent text-accent-foreground border-[hsl(var(--accent-border))]",
  navy: "bg-primary/8 text-primary border-primary/15",
  brass: "bg-[hsl(var(--brass-soft))] text-[hsl(var(--brass))] border-[hsl(var(--brass)/0.25)]",
  danger: "bg-destructive/8 text-destructive border-destructive/20",
  muted: "bg-muted text-muted-foreground border-border",
  success: "bg-[hsl(var(--success)/0.09)] text-[hsl(var(--success))] border-[hsl(var(--success)/0.25)]",
};

export function Tag({ children, tone = "muted", className, ...rest }: { children: ReactNode; tone?: keyof typeof toneMap; className?: string; "data-testid"?: string }) {
  return <span {...rest} className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-[1px] text-[10.5px] font-semibold tracking-wide whitespace-nowrap", toneMap[tone], className)}>{children}</span>;
}

const statusTone: Record<string, keyof typeof toneMap> = {
  open: "navy", under_preparation: "brass", submitted: "teal", under_review: "brass", closed: "muted", draft: "muted",
  clarification_required: "danger", partially_addressed: "brass", reviewed: "success", approved: "success", suggested: "brass",
  rejected: "danger", partial: "brass", unclassified: "muted", pending: "muted", flagged: "danger", reconciled: "success",
  partially_reconciled: "brass", unreconciled: "muted", manual_review: "danger", resolved: "success", reviewing: "brass", not_applicable: "muted",
  accepted: "success", disputed: "danger", unresolved: "brass", imported: "success", imported_with_warnings: "brass", failed: "danger", unsupported: "danger",
  passed: "success", not_available: "muted", high: "danger", medium: "brass", low: "muted", user_provided: "muted", documented: "teal", verified: "success",
};

export function StatusBadge({ status, label }: { status: string | null | undefined; label?: string }) {
  if (!status) return <Tag>—</Tag>;
  return <Tag tone={statusTone[status] ?? "muted"} data-testid={`status-${status}`}>{label ?? human(status)}</Tag>;
}

export function DemoBadge({ className }: { className?: string }) {
  return <Tag tone="brass" className={cn("uppercase tracking-[0.12em]", className)} data-testid="badge-demo">Demo data</Tag>;
}

export function AiBadge({ label = "AI suggestion" }: { label?: string }) {
  return <Tag tone="teal" data-testid="badge-ai"><Sparkles className="h-3 w-3" />{label}</Tag>;
}

export function VerificationBadge({ status, full }: { status: string; full?: boolean }) {
  if (status === "verified") return <Tag tone="success"><ShieldCheck className="h-3 w-3" />Verified</Tag>;
  if (status === "disputed") return <Tag tone="danger"><ShieldAlert className="h-3 w-3" />Disputed</Tag>;
  return <Tag tone="brass"><ShieldQuestion className="h-3 w-3" />{full ? "Unverified — not legal authority" : "Unverified"}</Tag>;
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6 rise" data-testid="empty-state">
      <div className="relative mb-4">
        <div className="h-14 w-14 rounded-xl border bg-card shadow-sm grid place-items-center text-[hsl(var(--teal))] rotate-[-4deg]">{icon ?? <Inbox className="h-6 w-6" />}</div>
        <div className="absolute -z-0 inset-0 translate-x-2 translate-y-1.5 rounded-xl border border-dashed" />
      </div>
      <div className="font-display text-lg">{title}</div>
      {body && <p className="text-sm text-muted-foreground mt-1 max-w-md">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error?: unknown; onRetry?: () => void }) {
  const msg = (error as { data?: { error?: string }; message?: string })?.data?.error ?? (error as Error)?.message;
  return (
    <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-5 flex items-start gap-3 rise" data-testid="error-state">
      <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
      <div className="flex-1">
        <div className="font-medium text-sm">This record could not be loaded</div>
        <div className="text-xs text-muted-foreground mt-0.5">{msg ?? "The server did not respond as expected."}</div>
      </div>
      {onRetry && <Button size="sm" variant="outline" onClick={onRetry} data-testid="button-retry"><RotateCw />Retry</Button>}
    </div>
  );
}

export function LoadingRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-8 w-full" style={{ opacity: 1 - i * 0.1 }} />)}
    </div>
  );
}

export function ConfirmButton({ trigger, title, description, confirmLabel = "Confirm", onConfirm, destructive = true }: { trigger: ReactNode; title: string; description: ReactNode; confirmLabel?: string; onConfirm: () => void; destructive?: boolean }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display font-medium">{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-confirm">Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className={destructive ? "bg-destructive text-destructive-foreground" : ""} data-testid="button-confirm">{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function Notice({ children, tone = "navy", icon }: { children: ReactNode; tone?: "navy" | "brass" | "teal" | "danger"; icon?: ReactNode }) {
  const cls = { navy: "bg-primary/[0.04] border-primary/15 text-foreground", brass: "bg-[hsl(var(--brass-soft))] border-[hsl(var(--brass)/0.3)] text-[hsl(36_60%_24%)]", teal: "bg-accent/60 border-[hsl(var(--accent-border))] text-accent-foreground", danger: "bg-destructive/5 border-destructive/25 text-destructive" }[tone];
  return <div className={cn("flex gap-2.5 rounded-md border px-3 py-2 text-xs leading-relaxed", cls)}>{icon ?? <ShieldQuestion className="h-4 w-4 shrink-0 mt-px" />}<div>{children}</div></div>;
}

export function SavedTick({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="saved-pulse inline-flex items-center gap-1 text-[11px] font-medium text-[hsl(var(--success))]"><Check className="h-3.5 w-3.5" />Saved</span>;
}

export function useSavedFlash(): [boolean, () => void] {
  const [k, setK] = useState(0);
  const [show, setShow] = useState(false);
  return [show, () => { setShow(false); setK(k + 1); requestAnimationFrame(() => setShow(true)); setTimeout(() => setShow(false), 1600); }];
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1", className)}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

export const nativeSelect = "h-9 rounded-md border border-input bg-card px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring";
