import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Upload, FileText, ChevronDown, Search, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formatUSD } from "@/lib/notices/numberToWords";
import { applyOwnerDirectory, chicagoToday, eligible, noticeIssues, parseAppFolioCsv, selectedNoticeInputs, type PropertyGroup, type RentBatch, type RentTenant } from "@/lib/notices/fiveDay";
import { buildSingleRentNotice, type GeneratedBatch } from "@/lib/notices/fiveDayPdf";
import { ReviewedExport } from "./ReviewedExport";
import { getSupabase } from "@/lib/supabase";
import { readLegalOwnerDirectory } from "@/lib/notices/legalOwnerMapping";
import { readReportSource, saveReportSource } from "@/lib/notices/reportSource";
import { useExportUser } from "./ExportSession";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block min-w-0 space-y-1.5 text-sm"><span className="font-medium">{label}</span>{children}</label>;
}

export function RentNoticeWorkspace() {
  const userId = useExportUser();
  return <AccountRentWorkspace key={userId ?? "unscoped"} userId={userId} />;
}

async function parseCurrentReport(csv: string) {
  const parsed = parseAppFolioCsv(csv);
  const client = getSupabase();
  if (client) { try { parsed.properties = applyOwnerDirectory(parsed.properties, await readLegalOwnerDirectory(client)); } catch { /* owner mapping unavailable: enter owners manually */ } }
  return parsed;
}

function AccountRentWorkspace({ userId }: { userId: string | null }) {
  const navigate = useNavigate();
  const [batch, setBatch] = useState<RentBatch>({ properties: [], tenants: [] });
  const [fileName, setFileName] = useState("");
  const [search, setSearch] = useState("");
  const [issueDate, setIssueDate] = useState(chicagoToday);
  const [activeId, setActiveId] = useState("");
  const [error, setError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const uploadAbort = useRef<AbortController | null>(null);
  const restoreCancelled = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadLock = useRef(false);
  const dragDepth = useRef(0);
  const [generated, setGenerated] = useState<Pick<GeneratedBatch, "notices"> | null>(null);
  const [generatedAt, setGeneratedAt] = useState("");
  const preview = useRef<HTMLDivElement>(null);
  const generationLock = useRef(false);
  const revision = useRef(0), uploadVersion = useRef(0);
  useEffect(() => {
    let active = true;
    restoreCancelled.current = false;
    if (userId) {
      setRestoring(true);
      void readReportSource(userId).then(async (source) => {
        if (!source || !active || restoreCancelled.current) return;
        const parsed = await parseCurrentReport(source.csv);
        if (!active || restoreCancelled.current) return;
        setBatch(parsed); setFileName(source.filename);
      }).catch((e: unknown) => {
        if (active && !restoreCancelled.current) setUploadError(e instanceof Error ? e.message : "Your saved report could not be restored.");
      }).finally(() => { if (active) setRestoring(false); });
    }
    return () => { active = false; revision.current++; uploadVersion.current++; uploadAbort.current?.abort(); };
  }, [userId]);
  useEffect(() => {
    if (!generated || !preview.current) return;
    preview.current.focus({ preventScroll: true });
    preview.current.scrollIntoView({ behavior: "instant", block: "start" });
  }, [generated]);
  const invalidate = () => { revision.current++; setGenerated(null); setError(""); };
  const updateTenant = (id: string, patch: Partial<RentTenant>) => {
    invalidate(); setBatch((b) => ({ ...b, tenants: b.tenants.map((t) => t.id === id ? { ...t, ...patch } : t) }));
  };
  const updateProperty = (id: string, patch: Partial<PropertyGroup>) => {
    invalidate(); setBatch((b) => ({ ...b, properties: b.properties.map((p) => p.id === id ? { ...p, ...patch } : p) }));
  };
  const select = (id: string) => {
    const tenant = batch.tenants.find((t) => t.id === id);
    if (!tenant || !eligible(tenant) || uploading) return;
    invalidate();
    setBatch((b) => ({ ...b, tenants: b.tenants.map((t) => ({ ...t, selected: t.id === id })) }));
    setActiveId(id);
  };
  const load = async (files: File[]) => {
    if (uploadLock.current || busy || files.length === 0) return;
    uploadLock.current = true;
    const version = ++uploadVersion.current;
    const controller = new AbortController();
    uploadAbort.current = controller;
    setUploadError(""); setRestoring(false); setUploading(true);
    try {
      const file = files[0];
      if (files.length !== 1 || !file) throw new Error("Please upload exactly one .csv file.");
      if (!file.name.toLowerCase().endsWith(".csv")) throw new Error("Please upload a .csv file.");
      if (file.size > 10 * 1024 * 1024) throw new Error("The CSV exceeds 10 MB.");
      const csv = await file.text();
      const parsed = await parseCurrentReport(csv);
      if (version !== uploadVersion.current) return;
      if (userId) await saveReportSource(userId, file.name, csv, controller.signal);
      if (version !== uploadVersion.current) return;
      restoreCancelled.current = true;
      invalidate(); setBatch(parsed); setFileName(file.name); setActiveId(""); setSearch(""); setIssueDate(chicagoToday());
    } catch (e) { if (version === uploadVersion.current) setUploadError(e instanceof Error ? e.message : "Unable to read CSV."); }
    finally { uploadLock.current = false; if (version === uploadVersion.current) setUploading(false); }
  };
  const selected = batch.tenants.filter((t) => t.selected);
  const query = search.trim().toLocaleLowerCase();
  const visibleTenants = batch.tenants.filter((t) => {
    const property = batch.properties.find((p) => p.id === t.propertyId);
    return [t.name, t.unit, property?.label, property?.street, property?.city, property?.zip].some((value) => value?.toLocaleLowerCase().includes(query));
  });
  const visibleIds = new Set(visibleTenants.map((t) => t.id));
  const hiddenSelected = selected.filter((t) => !visibleIds.has(t.id)).length;
  const active = selected.find((t) => t.id === activeId) ?? selected[0];
  const properties = batch.properties.filter((p) => selected.some((t) => t.propertyId === p.id));
  const inputs = selectedNoticeInputs(batch, issueDate);
  const issues = inputs.flatMap((input) => noticeIssues(input).map((message) => `${input.tenant.name}: ${message}`));
  const validation = selected.length !== 1 ? ["Choose one tenant with positive delinquent rent from the tenant list."] : [...new Set(issues)];
  const generate = async () => {
    if (generationLock.current || uploading) return;
    if (inputs.length !== 1 || !inputs[0] || !eligible(inputs[0].tenant)) { setError("Choose exactly one tenant with positive delinquent rent from the tenant list, then try again."); return; }
    if (issues.length) { setError(`Complete the required fields before generating: ${[...new Set(issues)].join(" ")}`); return; }
    const version = revision.current;
    generationLock.current = true;
    setBusy(true); setError(""); setGenerated(null);
    try {
      // Let the generating state paint before PDF work can occupy the main thread.
      await new Promise<void>((resolve) => {
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        else setTimeout(resolve, 0);
      });
      if (version !== revision.current) return;
      const result = await buildSingleRentNotice(inputs);
      if (version !== revision.current) return;
      setGenerated(result);
      setGeneratedAt(new Date().toISOString());
    } catch (e) {
      if (version !== revision.current) return;
      const detail = e instanceof Error ? e.message : "Unable to generate notice.";
      setError(/fetch|heading|network/i.test(detail)
        ? `${detail} Check your connection, then click Generate & preview again.`
        : /encode/i.test(detail)
          ? `${detail} Replace unsupported characters in the name, address, owner or signer, then try again.`
          : `${detail} Review the fields above, then try again.`);
    } finally { generationLock.current = false; setBusy(false); }
  };
  return <div className="mt-6 space-y-6">
    {restoring && <p role="status" className="text-sm text-muted-foreground">Restoring saved report…</p>}
    {!fileName && <div className="space-y-3">
      <h2 className="text-base font-semibold">AppFolio delinquency report</h2>
      <div role="region" aria-label="CSV drop area" aria-busy={uploading}
        onDragEnter={(e) => { e.preventDefault(); dragDepth.current++; if (!uploading && !busy) setDragging(true); }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = uploading || busy ? "none" : "copy"; if (!uploading && !busy) setDragging(true); }}
        onDragLeave={(e) => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current && !e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => { e.preventDefault(); dragDepth.current = 0; setDragging(false); void load(Array.from(e.dataTransfer.files)); }}>
        <Button type="button" variant="ghost" aria-label={uploading ? "Reading CSV…" : fileName ? "Replace CSV" : "Upload CSV"}
          className={`h-auto min-h-36 w-full flex-col gap-2 whitespace-normal rounded-md border border-dashed px-4 py-5 text-center font-normal focus-visible:ring-2 focus-visible:ring-offset-2 ${dragging && !uploading && !busy ? "border-primary bg-accent" : "border-border bg-card hover:bg-card"}`}
          disabled={uploading || busy} onClick={() => fileInput.current?.click()}>
          <Upload aria-hidden="true" className="size-4 text-primary" />
          {uploading ? <span className="text-sm text-muted-foreground">Reading CSV…</span>
            : dragging && !busy ? <span className="text-sm text-primary">Drop to upload</span>
            : fileName ? <><span className="max-w-full break-all text-sm text-muted-foreground">{fileName} · {batch.tenants.length} tenant{batch.tenants.length === 1 ? "" : "s"}</span><span className="text-sm text-primary">Replace CSV</span></>
            : <span className="text-sm text-muted-foreground">Drop your CSV here or <span className="text-primary">browse files</span></span>}
          {!fileName && !uploading && !dragging && <span className="text-xs text-muted-foreground">CSV up to 10 MB</span>}
        </Button>
      </div>
    </div>}
    <input ref={fileInput} type="file" accept=".csv,text/csv" aria-label="Upload AppFolio CSV" className="sr-only" tabIndex={-1} disabled={uploading || busy} onChange={(e) => { void load(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
    {uploadError && batch.tenants.length === 0 && <p role="alert" className="text-sm text-destructive">{uploadError}</p>}
    {fileName && batch.tenants.length === 0 && !uploading && <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2">
      <p className="min-w-0 break-all text-sm text-muted-foreground">{fileName} · 0 tenants found in this report.</p>
      <Button type="button" variant="ghost" size="sm" title={fileName} disabled={uploading || busy} onClick={() => fileInput.current?.click()}><Upload aria-hidden="true" className="size-4" />Update Delinquency</Button>
    </div>}
    {batch.tenants.length > 0 && <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <section aria-label="Tenant checklist" className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Tenants <span className="text-sm font-normal text-muted-foreground">({selected.length} selected)</span></h2>
        </div>
        <div className="relative mb-2"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" /><Input type="search" aria-label="Search tenants, properties or units" placeholder="Search tenant, property or unit" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <p role="status" className="mb-3 text-xs text-muted-foreground">{visibleTenants.length} of {batch.tenants.length} shown · {selected.length} selected{hiddenSelected > 0 && ` (${hiddenSelected} hidden by search)`}</p>
        <RadioGroup aria-label="Select one tenant" value={selected[0]?.id ?? ""} onValueChange={select} className="space-y-4 lg:max-h-[1000px] lg:overflow-y-auto lg:pr-1">
          {visibleTenants.length === 0 && <p className="py-4 text-sm text-muted-foreground">No matching tenants.</p>}
          {batch.properties.filter((p) => visibleTenants.some((t) => t.propertyId === p.id)).map((property) => <div key={property.id}>
            <h3 className="mb-2 break-words text-sm font-semibold">{property.label}</h3>
            <p className="mb-2 break-words text-xs text-muted-foreground">{[property.street, property.city, property.zip].filter(Boolean).join(", ")}</p>
            <div className="space-y-1.5">{visibleTenants.filter((t) => t.propertyId === property.id).map((t) => <div key={t.id} className={`relative grid grid-cols-[20px_minmax(0,1fr)_24px] items-center gap-x-2 rounded-lg border px-3 py-2 ${t.selected ? "border-primary bg-accent" : "border-border bg-card"}`}>
              <RadioGroupItem id={`select-${t.id}`} value={t.id} aria-label={`Select ${t.name}, unit ${t.unit}, row ${t.sourceRow}`} aria-describedby={!eligible(t) ? `reason-${t.id}` : undefined} disabled={!eligible(t) || uploading} />
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
        </RadioGroup>
      </section>
      <section aria-label="Review selected notices" className="min-w-0 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="font-semibold">Review & prepare</h2>
          <div className="min-w-0 max-w-full text-right">
            <Button type="button" variant="ghost" size="sm" title={fileName} disabled={uploading || busy} onClick={() => fileInput.current?.click()}><Upload aria-hidden="true" className="size-4" />Update Delinquency</Button>
            <p className="max-w-64 break-all text-xs text-muted-foreground">{fileName} · {batch.tenants.length} tenant{batch.tenants.length === 1 ? "" : "s"}</p>
            {uploading && <p role="status" className="text-xs text-muted-foreground">Reading CSV…</p>}
            {uploadError && <p role="alert" className="max-w-64 break-words text-xs text-destructive">{uploadError}</p>}
          </div>
        </div>
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
        <div className="space-y-2" aria-busy={busy}>
          <div id="rent-generation-feedback" aria-live="polite" aria-atomic="true" className="space-y-1 text-sm">
            {busy ? <p role="status" className="text-muted-foreground">Generating your PDF…</p>
              : error ? <p role="alert" className="break-words text-destructive">{error}</p>
              : validation.length > 0 ? <div className="space-y-1 text-destructive">{validation.map((issue) => <p key={issue}>{issue}</p>)}</div> : null}
          </div>
          <Button className="w-full" aria-describedby="rent-generation-feedback" disabled={busy || uploading} onClick={() => void generate()}>{busy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : <FileText aria-hidden="true" className="size-4" />}{busy ? "Generating notice…" : `Generate & preview ${selected.length || ""} notice`}</Button>
        </div>
        {generated && <div ref={preview} role="region" aria-label="Generated 5-Day notice preview" tabIndex={-1} className="scroll-mt-4 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ReviewedExport key={revision.current} notices={generated.notices} tenants={selected.map((t) => t.name)} kind="five-day" generatedAt={generatedAt} onSaved={() => void navigate({ to: "/five-day/exports" })} />
        </div>}
      </section>
    </div>}
  </div>;
}