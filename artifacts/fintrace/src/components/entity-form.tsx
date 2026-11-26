import { useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, nativeSelect } from "@/components/common";
import { cn } from "@/lib/utils";

export type FieldDef = {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "select" | "textarea" | "checkbox" | "email";
  options?: { value: string; label: string }[];
  required?: boolean;
  full?: boolean;
  hint?: ReactNode;
  placeholder?: string;
  nullableSelect?: boolean;
};

type Values = Record<string, unknown>;

function toForm(fields: FieldDef[], initial?: Values | null): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const f of fields) {
    const v = initial?.[f.name];
    if (f.type === "checkbox") out[f.name] = Boolean(v);
    else if (f.type === "date") out[f.name] = typeof v === "string" ? v.slice(0, 10) : "";
    else if (f.type === "select" && (v === undefined || v === null)) out[f.name] = f.nullableSelect ? "" : f.options?.[0]?.value ?? "";
    else out[f.name] = v === undefined || v === null ? "" : String(v);
  }
  return out;
}

export function fromForm(fields: FieldDef[], vals: Record<string, string | boolean>): Values {
  const out: Values = {};
  for (const f of fields) {
    const v = vals[f.name];
    if (f.type === "checkbox") out[f.name] = Boolean(v);
    else if (v === "" || v === undefined) out[f.name] = null;
    else if (f.type === "number" || (f.type === "select" && f.name.endsWith("Id"))) out[f.name] = Number(v);
    else out[f.name] = v;
  }
  return out;
}

export function EntityFormDialog({ open, onOpenChange, title, description, fields, initial, onSubmit, pending, submitLabel = "Save", footerNote, wide }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: ReactNode; fields: FieldDef[]; initial?: Values | null;
  onSubmit: (v: Values) => void; pending?: boolean; submitLabel?: string; footerNote?: ReactNode; wide?: boolean;
}) {
  const [vals, setVals] = useState(() => toForm(fields, initial));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setVals(toForm(fields, initial)); setErr(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: string, v: string | boolean) => setVals((p) => ({ ...p, [k]: v }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const missing = fields.find((f) => f.required && (vals[f.name] === "" || vals[f.name] === undefined));
    if (missing) { setErr(`${missing.label} is required`); return; }
    onSubmit(fromForm(fields, vals));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-h-[90dvh] overflow-y-auto", wide ? "sm:max-w-3xl" : "sm:max-w-xl")}>
        <DialogHeader>
          <DialogTitle className="font-display font-medium text-xl">{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {fields.map((f) => (
            <Field key={f.name} label={f.label + (f.required ? " *" : "")} hint={f.hint} className={cn((f.full || f.type === "textarea") && "sm:col-span-2")}>
              {f.type === "textarea" ? (
                <Textarea rows={3} value={vals[f.name] as string} placeholder={f.placeholder} onChange={(e) => set(f.name, e.target.value)} data-testid={`input-${f.name}`} />
              ) : f.type === "select" ? (
                <select className={nativeSelect} value={vals[f.name] as string} onChange={(e) => set(f.name, e.target.value)} data-testid={`select-${f.name}`}>
                  {f.nullableSelect && <option value="">— None —</option>}
                  {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : f.type === "checkbox" ? (
                <span className="flex items-center gap-2 h-9 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--teal))]" checked={vals[f.name] as boolean} onChange={(e) => set(f.name, e.target.checked)} data-testid={`check-${f.name}`} />
                  Yes
                </span>
              ) : (
                <Input type={f.type ?? "text"} step={f.type === "number" ? "any" : undefined} value={vals[f.name] as string} placeholder={f.placeholder}
                  className={f.type === "number" ? "num text-right" : ""} onChange={(e) => set(f.name, e.target.value)} data-testid={`input-${f.name}`} />
              )}
            </Field>
          ))}
          {err && <div className="sm:col-span-2 text-xs text-destructive">{err}</div>}
          {footerNote && <div className="sm:col-span-2">{footerNote}</div>}
          <DialogFooter className="sm:col-span-2 mt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel">Cancel</Button>
            <Button type="submit" disabled={pending} data-testid="button-submit">{pending && <Loader2 className="animate-spin" />}{submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
