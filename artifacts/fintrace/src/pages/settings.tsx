import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useGetMe, useUpdateMe, useGetServiceStatus, useHealthCheck, getGetMeQueryKey, type UserProfileUpdateRole } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, Panel, Field, LoadingRows, ErrorState, SavedTick, useSavedFlash, useInvalidate, nativeSelect, Tag } from "@/components/common";
import { useToast } from "@/hooks/use-toast";
import { errMsg } from "@/lib/format";

export default function SettingsPage() {
  const me = useGetMe();
  const status = useGetServiceStatus();
  const health = useHealthCheck();
  const update = useUpdateMe();
  const inv = useInvalidate();
  const { toast } = useToast();
  const [saved, flash] = useSavedFlash();
  const [f, setF] = useState({ displayName: "", organisation: "", workspace: "client", role: "individual" });

  useEffect(() => { if (me.data) setF({ displayName: me.data.displayName, organisation: me.data.organisation ?? "", workspace: me.data.workspace, role: me.data.role === "admin" ? "individual" : me.data.role }); }, [me.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => update.mutate({ data: { displayName: f.displayName, organisation: f.organisation || null, workspace: f.workspace as "client" | "investigation", role: f.role as UserProfileUpdateRole } }, {
    onSuccess: () => { inv(getGetMeQueryKey()); flash(); },
    onError: (e) => toast({ title: "Could not save", description: errMsg(e), variant: "destructive" }),
  });

  return (
    <div>
      <PageHeader eyebrow="Account" title="Settings" description="Your profile and the honest state of the services FINTRACE relies on." />
      <div className="grid lg:grid-cols-[1.2fr_1fr] gap-5">
        <Panel title="Profile" actions={<SavedTick show={saved} />}>
          {me.isLoading ? <LoadingRows rows={4} /> : me.isError ? <ErrorState error={me.error} onRetry={() => me.refetch()} /> : (
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Display name"><Input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} data-testid="input-display-name" /></Field>
              <Field label="Email"><Input value={me.data?.email ?? ""} disabled /></Field>
              <Field label="Organisation"><Input value={f.organisation} onChange={(e) => setF({ ...f, organisation: e.target.value })} data-testid="input-organisation" /></Field>
              <Field label="Workspace" hint="Switching changes your navigation labels. Case access still depends on sharing.">
                <select className={nativeSelect} value={f.workspace} onChange={(e) => setF({ ...f, workspace: e.target.value, role: e.target.value === "investigation" ? "investigation_officer" : "individual" })} data-testid="select-workspace">
                  <option value="client">Client (individual / advocate / CA)</option>
                  <option value="investigation">Investigation (authorised officer)</option>
                </select>
              </Field>
              <Field label="Role">
                <select className={nativeSelect} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} data-testid="select-role">
                  {f.workspace === "investigation" ? <option value="investigation_officer">Investigation officer</option> : <>
                    <option value="individual">Individual</option><option value="advocate">Advocate</option><option value="chartered_accountant">Chartered accountant</option></>}
                </select>
              </Field>
              <div className="sm:col-span-2 flex justify-end">
                <Button onClick={save} disabled={update.isPending} data-testid="button-save-profile">{update.isPending && <Loader2 className="animate-spin" />}Save profile</Button>
              </div>
            </div>
          )}
        </Panel>
        <Panel title="Service status" description="Optional services are reported as they are — unavailable means the feature is switched off, not hidden.">
          {status.isLoading ? <LoadingRows rows={3} /> : status.isError ? <ErrorState error={status.error} onRetry={() => status.refetch()} /> : (
            <div className="divide-y stagger">
              <div className="flex items-center justify-between py-2.5 text-sm">
                <span>API</span><Tag tone={health.data?.status === "ok" ? "success" : "brass"}>{health.data?.status ?? "checking"}</Tag>
              </div>
              {status.data?.map((s) => (
                <div key={s.key} className="py-2.5" data-testid={`row-service-${s.key}`}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{s.name}</span>
                    <Tag tone={s.available ? "success" : "danger"}>{s.available ? "Available" : "Unavailable"}</Tag>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{s.detail}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
