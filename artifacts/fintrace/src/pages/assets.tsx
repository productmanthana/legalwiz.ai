import { useState } from "react";
import { Plus, Pencil, Trash2, Building2, HandCoins } from "lucide-react";
import {
  useListAssets, useCreateAsset, useUpdateAsset, useDeleteAsset, useListLiabilities, useCreateLiability, useUpdateLiability, useDeleteLiability, useListFamilyMembers,
  getListAssetsQueryKey, getListLiabilitiesQueryKey, getGetCaseSummaryQueryKey, getGetDaCalculationQueryKey,
  type Case, type Asset, type Liability, type AssetInput, type LiabilityInput,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CaseLayout, access, useCaseId } from "@/components/case-layout";
import { Panel, LoadingRows, ErrorState, EmptyState, Tag, useInvalidate, Notice, Money, ConfirmButton } from "@/components/common";
import { EntityFormDialog, type FieldDef } from "@/components/entity-form";
import { fdate, human, errMsg, opts, inr } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";

function Body({ c }: { c: Case }) {
  const caseId = useCaseId();
  const a = access(c);
  const inv = useInvalidate();
  const { toast } = useToast();
  const assets = useListAssets(caseId); const liabs = useListLiabilities(caseId); const fam = useListFamilyMembers(caseId);
  const ca = useCreateAsset(); const ua = useUpdateAsset(); const da = useDeleteAsset();
  const cl = useCreateLiability(); const ul = useUpdateLiability(); const dl = useDeleteLiability();
  const [af, setAf] = useState<{ open: boolean; edit?: Asset }>({ open: false });
  const [lf, setLf] = useState<{ open: boolean; edit?: Liability }>({ open: false });
  const refresh = () => inv(getListAssetsQueryKey(caseId), getListLiabilitiesQueryKey(caseId), getGetCaseSummaryQueryKey(caseId), getGetDaCalculationQueryKey(caseId));
  const fail = (e: unknown) => toast({ title: "Failed", description: errMsg(e), variant: "destructive" });
  const famOpts = (fam.data ?? []).map((f) => ({ value: String(f.id), label: f.name }));
  const own = opts(["self", "spouse", "joint", "family_member", "other"]);

  const assetFields: FieldDef[] = [
    { name: "description", label: "Description", required: true, full: true, placeholder: "Site No. 42, 2nd Cross, HSR Layout, Bengaluru" },
    { name: "assetType", label: "Type", type: "select", options: opts(["land", "building", "residential_property", "commercial_property", "vehicle", "gold_jewellery", "bank_deposit", "fixed_deposit", "mutual_fund", "shares", "insurance", "cash", "other_investment"]) },
    { name: "acquisitionDate", label: "Acquired", type: "date" },
    { name: "purchasePrice", label: "Purchase price (₹)", type: "number" }, { name: "registrationCost", label: "Registration / stamp (₹)", type: "number" },
    { name: "currentValuation", label: "Current valuation (₹)", type: "number" }, { name: "valuationBasis", label: "Valuation basis" },
    { name: "legalOwner", label: "Legal / registered owner", hint: "Whose name is on the title" }, { name: "ownership", label: "Ownership", type: "select", options: own },
    { name: "familyMemberId", label: "Family member", type: "select", nullableSelect: true, options: famOpts }, { name: "ownershipSharePercent", label: "Ownership share %", type: "number" },
    { name: "fundingContributionBySubject", label: "Funded by subject (₹)", type: "number", hint: "Recorded separately from legal ownership" }, { name: "sourceOfFunds", label: "Source of funds" },
    { name: "linkedLiabilityId", label: "Linked loan", type: "select", nullableSelect: true, options: (liabs.data ?? []).map((l) => ({ value: String(l.id), label: `${l.lender} ${inr(l.principalAmount, true)}` })) },
    { name: "disposalDate", label: "Disposed", type: "date" },
    { name: "notes", label: "Notes", type: "textarea" },
  ];
  const liabFields: FieldDef[] = [
    { name: "lender", label: "Lender", required: true }, { name: "liabilityType", label: "Type", type: "select", options: opts(["bank_loan", "personal_loan", "housing_loan", "vehicle_loan", "other_borrowing"]) },
    { name: "borrower", label: "Borrower" }, { name: "ownership", label: "Ownership", type: "select", options: own },
    { name: "familyMemberId", label: "Family member", type: "select", nullableSelect: true, options: famOpts }, { name: "sanctionDate", label: "Sanctioned", type: "date" },
    { name: "principalAmount", label: "Principal (₹)", type: "number" }, { name: "interestRate", label: "Interest %", type: "number" },
    { name: "outstandingAtStart", label: "Outstanding at check-period start (₹)", type: "number" }, { name: "outstandingAtEnd", label: "Outstanding at check-period end (₹)", type: "number" },
    { name: "purpose", label: "Purpose", full: true }, { name: "notes", label: "Notes", type: "textarea" },
  ];

  const totalA = (assets.data ?? []).reduce((s, x) => s + (x.currentValuation ?? x.purchasePrice ?? 0), 0);
  const totalL = (liabs.data ?? []).reduce((s, x) => s + (x.outstandingAtEnd ?? 0), 0);

  return (
    <div className="space-y-4">
      <Notice>Legal ownership (whose name is on the title) and funding contribution (whose money paid for it) are recorded separately. Each can matter differently; FINTRACE does not decide which applies.</Notice>
      <Tabs defaultValue="assets">
        <TabsList>
          <TabsTrigger value="assets" data-testid="tab-assets">Assets <span className="ml-1.5 num text-xs text-muted-foreground">{assets.data?.length ?? 0}</span></TabsTrigger>
          <TabsTrigger value="liabilities" data-testid="tab-liabilities">Liabilities <span className="ml-1.5 num text-xs text-muted-foreground">{liabs.data?.length ?? 0}</span></TabsTrigger>
        </TabsList>
        <TabsContent value="assets">
          <Panel title="Assets" description={<>Total current valuation <span className="num">{inr(totalA, true)}</span></>} bodyClass="p-0"
            actions={a.canEdit && <Button size="sm" onClick={() => setAf({ open: true })} data-testid="button-add-asset"><Plus />Add asset</Button>}>
            {assets.isLoading ? <div className="p-4"><LoadingRows /></div> : assets.isError ? <div className="p-4"><ErrorState error={assets.error} onRetry={() => assets.refetch()} /></div> : !assets.data?.length ? (
              <EmptyState icon={<Building2 className="h-6 w-6" />} title="No assets recorded" body="Land, buildings, vehicles, gold, deposits and investments held at any point in the period." />
            ) : (
              <div className="overflow-x-auto"><table className="w-full text-[12.5px] dense-table">
                <thead className="bg-muted/50"><tr><th className="text-left">Asset</th><th className="text-left">Acquired</th><th className="text-left">Legal owner</th><th className="text-right">Funded by subject</th><th className="text-right">Purchase</th><th className="text-right">Valuation</th><th /></tr></thead>
                <tbody className="stagger">{assets.data.map((x) => (
                  <tr key={x.id} data-testid={`row-asset-${x.id}`}>
                    <td className="max-w-[300px]"><div className="truncate font-medium">{x.description}</div><div className="text-[11px] text-muted-foreground">{human(x.assetType)}{x.sourceOfFunds ? ` · ${x.sourceOfFunds}` : ""}</div></td>
                    <td className="num">{fdate(x.acquisitionDate)}</td>
                    <td><div>{x.legalOwner ?? "—"}</div><div className="flex gap-1 mt-0.5"><Tag tone={x.ownership === "self" ? "navy" : "muted"}>{human(x.ownership)}</Tag>{x.ownershipSharePercent != null && <Tag>{x.ownershipSharePercent}%</Tag>}</div></td>
                    <td className="text-right text-[hsl(var(--teal))]"><Money v={x.fundingContributionBySubject} dim /></td>
                    <td className="text-right"><Money v={(x.purchasePrice ?? 0) + (x.registrationCost ?? 0)} dim /></td>
                    <td className="text-right"><Money v={x.currentValuation} dim /><div className="text-[10.5px] text-muted-foreground">{x.valuationBasis}</div></td>
                    <td className="text-right">{a.canEdit && <div className="flex justify-end">
                      <Button size="icon" variant="ghost" onClick={() => setAf({ open: true, edit: x })} data-testid={`button-edit-asset-${x.id}`}><Pencil /></Button>
                      <ConfirmButton title="Delete asset?" description={x.description} onConfirm={() => da.mutate({ assetId: x.id }, { onSuccess: refresh, onError: fail })} trigger={<Button size="icon" variant="ghost" data-testid={`button-delete-asset-${x.id}`}><Trash2 /></Button>} />
                    </div>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </Panel>
        </TabsContent>
        <TabsContent value="liabilities">
          <Panel title="Liabilities" description={<>Outstanding at end <span className="num">{inr(totalL, true)}</span></>} bodyClass="p-0"
            actions={a.canEdit && <Button size="sm" onClick={() => setLf({ open: true })} data-testid="button-add-liability"><Plus />Add liability</Button>}>
            {liabs.isLoading ? <div className="p-4"><LoadingRows /></div> : liabs.isError ? <div className="p-4"><ErrorState error={liabs.error} /></div> : !liabs.data?.length ? (
              <EmptyState icon={<HandCoins className="h-6 w-6" />} title="No liabilities recorded" body="Housing loans, vehicle loans and personal borrowings reduce net assets." />
            ) : (
              <div className="overflow-x-auto"><table className="w-full text-[12.5px] dense-table">
                <thead className="bg-muted/50"><tr><th className="text-left">Lender</th><th className="text-left">Borrower</th><th className="text-left">Sanctioned</th><th className="text-right">Principal</th><th className="text-right">At start</th><th className="text-right">At end</th><th className="text-right">Rate</th><th /></tr></thead>
                <tbody className="stagger">{liabs.data.map((x) => (
                  <tr key={x.id} data-testid={`row-liability-${x.id}`}>
                    <td><div className="font-medium">{x.lender}</div><div className="text-[11px] text-muted-foreground">{human(x.liabilityType)}{x.purpose ? ` · ${x.purpose}` : ""}</div></td>
                    <td>{x.borrower ?? "—"} <Tag>{human(x.ownership)}</Tag></td>
                    <td className="num">{fdate(x.sanctionDate)}</td>
                    <td className="text-right"><Money v={x.principalAmount} dim /></td><td className="text-right"><Money v={x.outstandingAtStart} dim /></td><td className="text-right"><Money v={x.outstandingAtEnd} dim /></td>
                    <td className="text-right num">{x.interestRate != null ? `${x.interestRate}%` : "—"}</td>
                    <td className="text-right">{a.canEdit && <div className="flex justify-end">
                      <Button size="icon" variant="ghost" onClick={() => setLf({ open: true, edit: x })} data-testid={`button-edit-liability-${x.id}`}><Pencil /></Button>
                      <ConfirmButton title="Delete liability?" description={x.lender} onConfirm={() => dl.mutate({ liabilityId: x.id }, { onSuccess: refresh, onError: fail })} trigger={<Button size="icon" variant="ghost" data-testid={`button-delete-liability-${x.id}`}><Trash2 /></Button>} />
                    </div>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </Panel>
        </TabsContent>
      </Tabs>
      <EntityFormDialog open={af.open} onOpenChange={(o) => setAf({ open: o, edit: af.edit })} title={af.edit ? "Edit asset" : "Add asset"} fields={assetFields} wide
        initial={af.edit ? (af.edit as unknown as Record<string, unknown>) : { assetType: "residential_property", ownership: "self" }} pending={ca.isPending || ua.isPending}
        onSubmit={(v) => { const data = v as unknown as AssetInput; const cb = { onSuccess: () => { setAf({ open: false }); refresh(); }, onError: fail }; af.edit ? ua.mutate({ assetId: af.edit.id, data }, cb) : ca.mutate({ caseId, data }, cb); }} />
      <EntityFormDialog open={lf.open} onOpenChange={(o) => setLf({ open: o, edit: lf.edit })} title={lf.edit ? "Edit liability" : "Add liability"} fields={liabFields} wide
        initial={lf.edit ? (lf.edit as unknown as Record<string, unknown>) : { liabilityType: "housing_loan", ownership: "self" }} pending={cl.isPending || ul.isPending}
        onSubmit={(v) => { const data = v as unknown as LiabilityInput; const cb = { onSuccess: () => { setLf({ open: false }); refresh(); }, onError: fail }; lf.edit ? ul.mutate({ liabilityId: lf.edit.id, data }, cb) : cl.mutate({ caseId, data }, cb); }} />
    </div>
  );
}

export default function Assets() {
  return <CaseLayout>{(c) => <Body c={c} />}</CaseLayout>;
}
