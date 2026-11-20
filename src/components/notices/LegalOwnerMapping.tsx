import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Upload, Search, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabase } from "@/lib/supabase";
import { useExportUser } from "./ExportSession";
import { diffDirectory, isDirectoryConflict, readLegalOwnerDirectory, readPropertyDirectoryFile, replaceLegalOwnerDirectory, type LegalOwnerRow } from "@/lib/notices/legalOwnerMapping";

const errorText = (error: unknown) => error && typeof error === "object" && "message" in error ? String(error.message) : "Unable to load the property directory.";

export function LegalOwnerMapping() {
  const userId = useExportUser();
  const [rows, setRows] = useState<LegalOwnerRow[] | null>(null);
  const [preview, setPreview] = useState<{ filename: string; directory: LegalOwnerRow[]; original: LegalOwnerRow[] } | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const input = useRef<HTMLInputElement>(null), generation = useRef(0);
  const refresh = useCallback(async () => {
    const ticket = ++generation.current;
    setBusy(true); setRows(null); setPreview(null);
    try {
      const client = getSupabase();
      if (!client || !userId || userId === "dev-only") throw new Error("Staff sign-in is required to read the legal owner directory.");
      const directory = await readLegalOwnerDirectory(client);
      if (ticket === generation.current) setRows(directory);
    } catch (e) { if (ticket === generation.current) setError(errorText(e)); }
    finally { if (ticket === generation.current) setBusy(false); }
  }, [userId]);
  useEffect(() => {
    setError(""); setMessage(""); setSearch("");
    void refresh();
    return () => { generation.current++; };
  }, [refresh]);
  const filtered = useMemo(() => (rows ?? []).filter((row) => `${row.property_name} ${row.legal_owner}`.toLowerCase().includes(search.trim().toLowerCase())), [rows, search]);
  const changes = useMemo(() => preview ? diffDirectory(preview.original, preview.directory) : [], [preview]);

  async function upload(file: File) {
    if (busy || !rows) return;
    const ticket = generation.current;
    setBusy(true); setError(""); setMessage(""); setPreview(null);
    try {
      const directory = await readPropertyDirectoryFile(file);
      if (ticket === generation.current) setPreview({ filename: file.name, directory, original: rows.map((row) => ({ ...row })) });
    } catch (e) { if (ticket === generation.current) setError(errorText(e)); }
    finally { if (ticket === generation.current) setBusy(false); }
  }
  async function apply() {
    if (busy || !preview || !changes.length) return;
    const client = getSupabase();
    if (!client || !userId || userId === "dev-only") { setError("Staff sign-in is required to replace the directory."); return; }
    const ticket = generation.current;
    setBusy(true); setError(""); setMessage("");
    try {
      const count = await replaceLegalOwnerDirectory(client, preview.directory, preview.original);
      if (ticket !== generation.current) return;
      setMessage(`Directory replaced: ${count} properties.`);
      await refresh();
    } catch (e) {
      if (ticket !== generation.current) return;
      setError(isDirectoryConflict(e) ? "The directory changed since your preview. The latest directory has been reloaded; upload again to review new changes." : errorText(e));
      // A failed response can be ambiguous; discard the preview and re-read before any retry.
      await refresh();
    } finally { if (ticket === generation.current) setBusy(false); }
  }

  return <section className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h1 className="text-3xl font-semibold">Legal owner mapping</h1>
      <Button disabled={busy || rows === null || preview !== null} onClick={() => input.current?.click()}><Upload className="size-4" aria-hidden="true" />Upload property directory</Button>
      <input ref={input} type="file" accept=".csv" aria-label="Upload property directory CSV" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); e.target.value = ""; }} />
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {busy && <p role="status" className="text-sm">{preview ? "Applying directory…" : "Loading directory…"}</p>}
    {rows === null && !busy && <Button variant="outline" onClick={() => { setError(""); void refresh(); }}><RefreshCw className="size-4" aria-hidden="true" />Retry</Button>}
    {preview && <section aria-label="Directory replacement preview" className="space-y-3 border-y border-border py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h2 className="text-lg font-semibold">Review replacement</h2><p className="break-all text-sm">{preview.filename}</p></div>
        <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => setPreview(null)}>Cancel</Button><Button disabled={busy || !changes.length} onClick={() => void apply()}>Apply replacement</Button></div>
      </div>
      <p className="text-sm">{preview.directory.length} properties · {changes.filter((c) => c.type === "Add").length} adds · {changes.filter((c) => c.type === "Edit").length} edits · {changes.filter((c) => c.type === "Delete").length} deletes</p>
      {!changes.length ? <p className="text-sm">No changes.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border"><th className="px-3 py-2 font-semibold">Change</th><th className="px-3 py-2 font-semibold">Property</th><th className="px-3 py-2 font-semibold">Current</th><th className="px-3 py-2 font-semibold">Replacement</th></tr></thead><tbody>{changes.map((change) => <tr key={`${change.type}-${change.property}`} className="border-b border-border"><td className="px-3 py-2">{change.type}</td><td className="px-3 py-2 break-words">{change.property}</td><td className="px-3 py-2 break-words">{change.before || "—"}</td><td className="px-3 py-2 break-words">{change.after || "—"}</td></tr>)}</tbody></table></div>}
    </section>}
    {rows !== null && <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:max-w-sm"><Search aria-hidden="true" className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search properties and legal owners" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search properties or legal owners" className="pl-9" /></div>
        <p className="text-sm" role="status">{search.trim() ? `${filtered.length} of ${rows.length}` : rows.length} properties</p>
      </div>
      <table className="w-full table-fixed text-left text-sm"><thead><tr className="border-y border-border bg-muted"><th scope="col" className="w-1/2 px-3 py-3 font-semibold">Property</th><th scope="col" className="w-1/2 px-3 py-3 font-semibold">Legal owner</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.property_name} className="border-b border-border"><td className="px-3 py-3 align-top break-words">{row.property_name}</td><td className="px-3 py-3 align-top break-words">{row.legal_owner}</td></tr>)}</tbody></table>
      {!filtered.length && <p className="text-sm">{rows.length ? "No matching properties." : "No properties in the directory."}</p>}
    </>}
  </section>;
}