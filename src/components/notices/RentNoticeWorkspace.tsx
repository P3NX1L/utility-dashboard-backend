import { useRef, useState, type ReactNode } from "react";
import { Upload, FileText, ChevronDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { formatUSD } from "@/lib/notices/numberToWords";
import { chicagoToday, eligible, noticeIssues, parseAppFolioCsv, selectedNoticeInputs, type PropertyGroup, type RentBatch, type RentTenant } from "@/lib/notices/fiveDay";
import { buildRentBatch, type GeneratedBatch } from "@/lib/notices/fiveDayPdf";
import { ReviewedExport } from "./ReviewedExport";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block min-w-0 space-y-1.5 text-sm"><span className="font-medium">{label}</span>{children}</label>;
}

export function RentNoticeWorkspace() {
  const [batch, setBatch] = useState<RentBatch>({ properties: [], tenants: [] });
  const [fileName, setFileName] = useState("");
  const [search, setSearch] = useState("");
  const [issueDate, setIssueDate] = useState(chicagoToday);
  const [activeId, setActiveId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [generated, setGenerated] = useState<GeneratedBatch | null>(null);
  const revision = useRef(0), uploadVersion = useRef(0);
  const invalidate = () => { revision.current++; setGenerated(null); setError(""); };
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
      setBatch(parsed); setFileName(file.name); setActiveId(""); setSearch("");
    } catch (e) { if (version === uploadVersion.current) setError(e instanceof Error ? e.message : "Unable to read CSV."); }
    finally { if (version === uploadVersion.current) setUploading(false); }
  };
  const selected = batch.tenants.filter((t) => t.selected);
  const query = search.trim().toLocaleLowerCase();
  const visibleTenants = batch.tenants.filter((t) => {
    const property = batch.properties.find((p) => p.id === t.propertyId);
    return [t.name, t.unit, property?.label, property?.street, property?.city, property?.zip].some((value) => value?.toLocaleLowerCase().includes(query));
  });
  const visibleIds = new Set(visibleTenants.map((t) => t.id));
  const visibleEligible = visibleTenants.filter(eligible);
  const hiddenSelected = selected.filter((t) => !visibleIds.has(t.id)).length;
  const bulkSelect = (value: boolean) => {
    invalidate();
    setBatch((b) => ({ ...b, tenants: b.tenants.map((t) => visibleIds.has(t.id) ? { ...t, selected: value && eligible(t) } : t) }));
  };
  const active = selected.find((t) => t.id === activeId) ?? selected[0];
  const properties = batch.properties.filter((p) => selected.some((t) => t.propertyId === p.id));
  const inputs = selectedNoticeInputs(batch, issueDate);
  const issues = inputs.flatMap((input) => noticeIssues(input).map((message) => `${input.tenant.name}: ${message}`));
  const generate = async () => {
    const version = revision.current;
    setBusy(true); setError(""); setGenerated(null);
    try {
      const result = await buildRentBatch(inputs);
      if (version !== revision.current) return;
      setGenerated(result);
    } catch (e) { if (version === revision.current) setError(e instanceof Error ? e.message : "Unable to generate notices. No ZIP was created."); }
    finally { setBusy(false); }
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
          <div className="flex flex-wrap gap-1"><Button variant="ghost" size="sm" disabled={!visibleEligible.length || uploading} onClick={() => bulkSelect(true)}>Select shown eligible ({visibleEligible.length})</Button>
            <Button variant="ghost" size="sm" disabled={!visibleTenants.some((t) => t.selected) || uploading} onClick={() => bulkSelect(false)}>Clear shown</Button></div>
        </div>
        <div className="relative mb-2"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" /><Input type="search" aria-label="Search tenants, properties or units" placeholder="Search tenant, property or unit" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <p role="status" className="mb-3 text-xs text-muted-foreground">{visibleTenants.length} of {batch.tenants.length} shown · {selected.length} selected{hiddenSelected > 0 && ` (${hiddenSelected} hidden by search)`}</p>
        <div className="space-y-4 lg:max-h-[1000px] lg:overflow-y-auto lg:pr-1">
          {visibleTenants.length === 0 && <p className="py-4 text-sm text-muted-foreground">No matching tenants.</p>}
          {batch.properties.filter((p) => visibleTenants.some((t) => t.propertyId === p.id)).map((property) => <div key={property.id}>
            <h3 className="mb-2 break-words text-sm font-semibold">{property.label}</h3>
            <p className="mb-2 break-words text-xs text-muted-foreground">{[property.street, property.city, property.zip].filter(Boolean).join(", ")}</p>
            <div className="space-y-1.5">{visibleTenants.filter((t) => t.propertyId === property.id).map((t) => <div key={t.id} className={`relative grid grid-cols-[20px_minmax(0,1fr)_24px] items-center gap-x-2 rounded-lg border px-3 py-2 ${t.selected ? "border-primary bg-accent" : "border-border bg-card"}`}>
              <Checkbox id={`select-${t.id}`} className="rounded-full" aria-label={`Select ${t.name}, unit ${t.unit}, row ${t.sourceRow}`} aria-describedby={!eligible(t) ? `reason-${t.id}` : undefined} checked={t.selected} disabled={!eligible(t) || uploading} onCheckedChange={(v) => select(t, v === true)} />
              <label htmlFor={`select-${t.id}`} className="min-w-0 cursor-pointer">
                <span className="block break-words text-sm font-medium leading-tight">{t.name}</span>
                <span className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs"><span className="break-words text-muted-foreground">Unit {t.unit || "—"}</span><span className="font-semibold" aria-label={`Delinquent rent ${formatUSD(t.rent)}`}>{formatUSD(t.rent)}</span>{!eligible(t) && <span id={`reason-${t.id}`} className="text-muted-foreground">{t.rent === 0 ? "Zero rent · disabled" : "No positive rent · disabled"}</span>}</span>
              </label>
              <details className="group col-start-2 col-span-2 min-w-0">
                <summary aria-label={`Details for ${t.name}, unit ${t.unit}, row ${t.sourceRow}`} title="Tenant details" className="absolute right-2 top-2 flex size-7 cursor-pointer list-none items-center justify-center rounded-sm text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"><ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" /></summary>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-2 text-xs"><div><dt className="text-muted-foreground">Status</dt><dd className="break-words">{t.status || "No status"}</dd></div><div><dt className="text-muted-foreground">Other charges</dt><dd>{formatUSD(t.other)}</dd></div><div className="col-span-2 flex flex-wrap gap-x-2"><dt className="text-muted-foreground">Amount receivable</dt><dd>{formatUSD(t.receivable)}</dd></div></dl>
              </details>
            </div>)}</div>
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
        {generated && <ReviewedExport key={revision.current} notices={generated.notices} tenants={selected.map((t) => t.name)} kind="five-day" />}
      </section>
    </div>}
  </div>;
}