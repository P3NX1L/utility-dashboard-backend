import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { packageReviewed, saveExport, downloadExport } from "@/lib/notices/exports";
import type { GeneratedNotice } from "@/lib/notices/fiveDayPdf";
import type { NoticeKind } from "@/lib/notices/types";
import { useExportUser } from "./ExportSession";
const PdfPreview = lazy(() => import("./OfficePdfPreview"));
export function ReviewedExport({ notices, tenants, kind, generatedAt, onSaved }: { notices: GeneratedNotice[]; tenants: string[]; kind: NoticeKind; generatedAt?: string; onSaved?: () => void }) {
  const userId = useExportUser();
  const [index, setIndex] = useState(0), [viewed, setViewed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const alive = useRef(true);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; pending.current?.abort(); }; }, []);
  const markViewed = useCallback((id: string) => setViewed((v) => v.includes(id) ? v : [...v, id]), []);
  const current = notices[index];
  const ready = notices.length > 0 && notices.every((n) => viewed.includes(n.id));
  const download = async () => {
    if (!userId || !ready || busy) return;
    setBusy(true); setError("");
    try {
      const output = await packageReviewed(notices, viewed, kind);
      if (!alive.current) return;
      if (kind === "five-day" && notices.length !== 1) throw new Error("Select exactly one eligible tenant.");
      if (!saved) {
        const controller = new AbortController(); pending.current = controller;
        await saveExport(userId, { ...output, id: crypto.randomUUID(), userId, kind, tenants, count: notices.length, createdAt: generatedAt || new Date().toISOString() }, controller.signal);
        if (!alive.current) return;
        setSaved(true);
      }
      if (kind === "five-day") onSaved?.();
      else downloadExport(output);
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Export failed."); }
    finally { if (alive.current) setBusy(false); }
  };
  if (!current) return null;
  return <div className="space-y-3 border-t border-border pt-5">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">PDF preview {index + 1} of {notices.length}</h3><div className="flex gap-1"><Button variant="outline" size="icon" aria-label="Previous PDF" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}><ChevronLeft className="size-4" /></Button><Button variant="outline" size="icon" aria-label="Next PDF" disabled={index >= notices.length - 1} onClick={() => setIndex((i) => i + 1)}><ChevronRight className="size-4" /></Button></div></div>
    <p className="break-all text-xs text-muted-foreground">{current.filename}</p>
    <Suspense fallback={<p role="status">Loading PDF preview…</p>}><PdfPreview key={current.id} bytes={current.bytes} id={current.id} onRendered={markViewed} /></Suspense>
    <p className="text-xs text-muted-foreground">{viewed.length} of {notices.length} previews viewed. Review every PDF before download. Any edit or selection change clears this batch.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button className="w-full" disabled={!ready || busy || !userId} onClick={() => void download()}><Download className="size-4" />{busy ? "Saving export…" : kind === "five-day" ? "Save notice to Exports" : notices.length === 1 ? "Download PDF" : `Download ZIP · ${notices.length} PDFs`}</Button>
    {saved && <p role="status" className="text-xs text-muted-foreground">Saved to Exports.</p>}
  </div>;
}
