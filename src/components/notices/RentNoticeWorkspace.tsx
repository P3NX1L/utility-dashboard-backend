import { lazy, Suspense, useCallback, useRef, useState, type ReactNode } from "react";
import { Upload, Download, FileText, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { formatUSD } from "@/lib/notices/numberToWords";
import { chicagoToday, eligible, noticeIssues, parseAppFolioCsv, selectedNoticeInputs, type PropertyGroup, type RentBatch, type RentTenant } from "@/lib/notices/fiveDay";
import { buildRentBatch, type GeneratedBatch } from "@/lib/notices/fiveDayPdf";

const PdfPreview = lazy(() => import("./OfficePdfPreview"));
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block min-w-0 space-y-1.5 text-sm"><span className="font-medium">{label}</span>{children}</label>;
}

export function RentNoticeWorkspace() {
  const [batch, setBatch] = useState<RentBatch>({ properties: [], tenants: [] });
  const [fileName, setFileName] = useState("");
  const [issueDate, setIssueDate] = useState(chicagoToday);
  const [activeId, setActiveId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [generated, setGenerated] = useState<GeneratedBatch | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [viewed, setViewed] = useState<string[]>([]);
  const revision = useRef(0), uploadVersion = useRef(0);
  const invalidate = () => { revision.current++; setGenerated(null); setViewed([]); setError(""); };
  const updateTenant = (id: string, patch: Partial<RentTenant>) => {
    invalidate(); setBatch((b) => ({ ...b, tenants: b.tenants.map((t) => t.id === id ? { ...t, ...patch } : t) }));
  };
  const updateProperty = (id: string, patch: Partial<PropertyGroup>) => {
    invalidate(); setBatch((b) => ({ ...b, properties: b.properties.map((p) => p.id === id ? { ...p, ...patch } : p) }));
  };
  const select = (t: RentTenant, value: boolean) => {
    updateTenant(t.id, { selected: value && eligible(t) });
    if (value) setActiveId(t.id);
  };
  const load = async (file: File) => {
    const version = ++uploadVersion.current;
    invalidate(); setUploading(true);
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("The CSV exceeds 10 MB.");
      const parsed = parseAppFolioCsv(await file.text());
      if (version !== uploadVersion.current) return;
      setBatch(parsed); setFileName(file.name); setActiveId("");
    } catch (e) { if (version === uploadVersion.current) setError(e instanceof Error ? e.message : "Unable to read CSV."); }
    finally { if (version === uploadVersion.current) setUploading(false); }
  };
  const selected = batch.tenants.filter((t) => t.selected);
  const active = selected.find((t) => t.id === activeId) ?? selected[0];
  const properties = batch.properties.filter((p) => selected.some((t) => t.propertyId === p.id));
  const inputs = selectedNoticeInputs(batch, issueDate);
  const issues = inputs.flatMap((input) => noticeIssues(input).map((message) => `${input.tenant.name}: ${message}`));
  const generate = async () => {
    const version = revision.current;
    setBusy(true); setError(""); setGenerated(null); setViewed([]);
    try {
      const result = await buildRentBatch(inputs);
      if (version !== revision.current) return;
      setGenerated(result); setPreviewIndex(0);
    } catch (e) { if (version === revision.current) setError(e instanceof Error ? e.message : "Unable to generate notices. No ZIP was created."); }
    finally { setBusy(false); }
  };
  const markViewed = useCallback((id: string) => setViewed((ids) => ids.includes(id) ? ids : [...ids, id]), []);
  const currentPdf = generated?.notices[previewIndex];
  const allViewed = Boolean(generated && generated.notices.every((n) => viewed.includes(n.id)));
  const download = () => {
    if (!generated || !allViewed) return;
    const url = URL.createObjectURL(generated.zip);
    const a = document.createElement("a"); a.href = url; a.download = `5-Day_Notices_${issueDate}.zip`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="mt-6 space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-4">
      <div className="min-w-0"><h2 className="text-base font-semibold">AppFolio delinquency report</h2>
        {fileName && <p className="mt-1 break-all text-sm text-muted-foreground">{fileName} · {batch.properties.length} properties · {batch.tenants.length} tenants</p>}
      </div>
      <Button asChild variant={fileName ? "outline" : "default"}>
        <label className="cursor-pointer"><Upload className="size-4" />{uploading ? "Reading CSV…" : fileName ? "Replace CSV" : "Upload UTF-8 CSV"}
          <input type="file" accept=".csv,text/csv" aria-label="Upload AppFolio CSV" className="sr-only" disabled={uploading} onChange={(e) => { const file = e.target.files?.[0]; if (file) void load(file); e.target.value = ""; }} />
        </label>
      </Button>
    </div>
    <p className="text-sm leading-relaxed text-muted-foreground">Rent demand uses <strong className="text-foreground">Delinquent Rent only</strong>, not Amount Receivable. Other charges are shown separately. Tenants with zero, negative, or missing rent cannot be selected. Nothing is sent to tenants or AppFolio.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {batch.tenants.length > 0 && <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <section aria-label="Tenant checklist" className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Tenants <span className="text-sm font-normal text-muted-foreground">({selected.length} selected)</span></h2>
          <div className="flex gap-1"><Button variant="ghost" size="sm" disabled={uploading} onClick={() => { invalidate(); setBatch((b) => ({ ...b, tenants: b.tenants.map((t) => ({ ...t, selected: eligible(t) })) })); }}>Select eligible</Button>
            <Button variant="ghost" size="sm" disabled={!selected.length || uploading} onClick={() => { invalidate(); setBatch((b) => ({ ...b, tenants: b.tenants.map((t) => ({ ...t, selected: false })) })); }}>Clear</Button></div>
        </div>
        <div className="space-y-5 lg:max-h-[1000px] lg:overflow-y-auto lg:pr-1">
          {batch.properties.map((property) => <div key={property.id}>
            <h3 className="mb-2 break-words text-sm font-semibold">{property.label}</h3>
            <p className="mb-2 break-words text-xs text-muted-foreground">{[property.street, property.city, property.zip].filter(Boolean).join(", ")}</p>
            <div className="space-y-2">{batch.tenants.filter((t) => t.propertyId === property.id).map((t) => <label key={t.id} className={`flex gap-3 rounded-lg border p-3 ${t.selected ? "border-primary bg-accent" : "border-border bg-card"}`}>
              <Checkbox className="mt-0.5 rounded-full" aria-label={`Select ${t.name}, unit ${t.unit}, row ${t.sourceRow}`} checked={t.selected} disabled={!eligible(t) || uploading} onCheckedChange={(v) => select(t, v === true)} />
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline justify-between gap-x-2"><span className="break-words text-sm font-medium">{t.name}</span><span className="text-xs text-muted-foreground">Unit {t.unit || "—"}</span></div>
                <p className="mt-1 text-xs text-muted-foreground">{t.status || "No status"}</p>
                <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs"><div><dt className="text-muted-foreground">Delinquent rent</dt><dd className="font-semibold">{formatUSD(t.rent)}</dd></div><div><dt className="text-muted-foreground">Other charges</dt><dd>{formatUSD(t.other)}</dd></div><div className="col-span-2 flex gap-2"><dt className="text-muted-foreground">Amount receivable</dt><dd>{formatUSD(t.receivable)}</dd></div></dl>
                {!eligible(t) && <p className="mt-2 text-xs text-muted-foreground">{t.rent === 0 ? "Zero delinquent rent — disabled" : "No positive delinquent rent — disabled"}</p>}
              </div>
            </label>)}</div>
          </div>)}
        </div>
      </section>
      <section aria-label="Review selected notices" className="min-w-0 space-y-5">
        <h2 className="font-semibold">Review & prepare</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Issue date · Chicago"><Input aria-label="Issue date" type="date" value={issueDate} onChange={(e) => { invalidate(); setIssueDate(e.target.value); }} /></Field>
        </div>
        {properties.length > 0 && <div className="space-y-3 border-y border-border py-4">
          <h3 className="text-sm font-semibold">Property owners & signers · required</h3>
          <p className="text-xs text-muted-foreground">The report has no owner LLC or trust. Enter the legal owner once per property for this batch.</p>
          {properties.map((p) => <div key={p.id} className="space-y-3">
            <h4 className="break-words text-sm font-medium">{p.label}</h4>
            <Field label="Legal owner LLC or trust"><Input aria-label={`Owner for ${p.label}`} value={p.owner} onChange={(e) => updateProperty(p.id, { owner: e.target.value })} /></Field>
            <Field label="Printed agent"><Input aria-label={`Printed agent for ${p.label}`} value={p.agent} onChange={(e) => updateProperty(p.id, { agent: e.target.value })} /></Field>
          </div>)}
        </div>}
        {active ? <div className="space-y-4">
          <Field label="Selected tenant"><select aria-label="Review tenant" className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={active.id} onChange={(e) => setActiveId(e.target.value)}>{selected.map((t) => <option key={t.id} value={t.id}>{t.name} · Unit {t.unit} · Row {t.sourceRow}</option>)}</select></Field>
          <Field label="Tenant display name"><Input aria-label="Tenant display name" value={active.name} onChange={(e) => updateTenant(active.id, { name: e.target.value })} /></Field>
          <Field label="Exact street (keep ranges and multiple addresses)"><Input aria-label="Exact street" value={active.street} onChange={(e) => updateTenant(active.id, { street: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-4"><Field label="Unit"><Input aria-label="Unit" value={active.unit} onChange={(e) => updateTenant(active.id, { unit: e.target.value })} /></Field><Field label="ZIP"><Input aria-label="ZIP" value={active.zip} onChange={(e) => updateTenant(active.id, { zip: e.target.value })} /></Field></div>
          <Field label="City · Cook County, Illinois"><Input aria-label="City" value={active.city} onChange={(e) => updateTenant(active.id, { city: e.target.value })} /></Field>
          <p className="text-sm">Rent demand: <strong>{formatUSD(active.rent)}</strong><span className="text-muted-foreground"> · Other charges excluded: {formatUSD(active.other)}</span></p>
        </div> : <p className="border-y border-dashed py-6 text-sm text-muted-foreground">No tenants selected.</p>}
        {issues.length > 0 && <div role="status" className="space-y-1 text-xs text-destructive">{[...new Set(issues)].slice(0, 6).map((issue) => <p key={issue}>{issue}</p>)}{issues.length > 6 && <p>Review all {issues.length} missing or invalid fields before generating.</p>}</div>}
        <Button className="w-full" disabled={!selected.length || issues.length > 0 || busy || uploading} onClick={() => void generate()}><FileText className="size-4" />{busy ? "Generating complete batch…" : `Generate & preview ${selected.length || ""} notice${selected.length === 1 ? "" : "s"}`}</Button>
        {generated && currentPdf && <div className="space-y-3 border-t border-border pt-5">
          <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">PDF preview {previewIndex + 1} of {generated.notices.length}</h3><div className="flex gap-1"><Button variant="outline" size="icon" aria-label="Previous PDF" disabled={previewIndex === 0} onClick={() => setPreviewIndex((i) => i - 1)}><ChevronLeft className="size-4" /></Button><Button variant="outline" size="icon" aria-label="Next PDF" disabled={previewIndex >= generated.notices.length - 1} onClick={() => setPreviewIndex((i) => i + 1)}><ChevronRight className="size-4" /></Button></div></div>
          <p className="break-all text-xs text-muted-foreground">{currentPdf.filename}</p>
          <Suspense fallback={<p className="text-sm text-muted-foreground">Loading PDF preview…</p>}><PdfPreview key={currentPdf.id} bytes={currentPdf.bytes} id={currentPdf.id} onRendered={markViewed} /></Suspense>
          <p className="text-xs text-muted-foreground">{viewed.length} of {generated.notices.length} previews viewed. Review every PDF before download. Any edit or selection change clears this batch.</p>
          <Button className="w-full" disabled={!allViewed} onClick={download}><Download className="size-4" />Download ZIP · {generated.notices.length} PDFs</Button>
        </div>}
      </section>
    </div>}
  </div>;
}