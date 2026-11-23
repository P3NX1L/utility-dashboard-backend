import { AccessEmailSend } from "./AccessEmailSend";
import { useEffect, useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listExports, downloadExport, individualFiveDayDownloads, markNoticeDownloaded, deleteFiveDayNotice, chicagoGenerationDate, type ExportRecord, type NoticeDownload } from "@/lib/notices/exports";
import type { NoticeKind } from "@/lib/notices/types";
import { useExportUser } from "./ExportSession";
export function ExportHistory({ kind }: { kind: NoticeKind }) {
  const userId = useExportUser();
  const [rows, setRows] = useState<ExportRecord[]>([]), [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [notices, setNotices] = useState<NoticeDownload[]>([]);
  const [downloading, setDownloading] = useState<string[]>([]);
  useEffect(() => {
    let active = true; setRows([]); setNotices([]); setDownloading([]); setError(""); setLoading(true);
    if (!userId) { setLoading(false); return; }
    void listExports(userId, kind).then(async (records) => {
      const individual = kind === "five-day" ? await individualFiveDayDownloads(records) : records.map((row) => ({
        recordId: row.id, tenant: row.count === 1 ? row.tenants[0] : `${row.count} tenants`,
        filename: row.filename, blob: row.blob, createdAt: row.createdAt,
        downloaded: row.downloadedFiles?.includes(row.filename) ?? false,
      }));
      if (active) { setRows(records); setNotices(individual); }
    }).catch((e) => { if (active) setError(e instanceof Error ? e.message : "History unavailable."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId, kind]);
  const downloadNotice = async (notice: NoticeDownload) => {
    if (!userId) return;
    const key = `${notice.recordId}:${notice.filename}`;
    setError(""); setDownloading((ids) => [...ids, key]);
    try {
      downloadExport(notice);
      await markNoticeDownloaded(userId, notice.recordId, notice.filename, kind);
      setNotices((items) => items.map((item) => item.recordId === notice.recordId && item.filename === notice.filename ? { ...item, downloaded: true } : item));
    } catch (e) { setError(e instanceof Error ? e.message : "Download failed."); }
    finally { setDownloading((ids) => ids.filter((id) => id !== key)); }
  };
  const deleteNotice = async (notice: NoticeDownload) => {
    if (!userId || !window.confirm(`Delete the notice for ${notice.tenant}? This cannot be undone.`)) return;
    const key = `${notice.recordId}:${notice.filename}`;
    setError(""); setDownloading((ids) => [...ids, key]);
    try {
      await deleteFiveDayNotice(userId, notice.recordId, notice.filename, kind);
      setNotices((items) => items.filter((item) => item.recordId !== notice.recordId || item.filename !== notice.filename));
    } catch (e) { setError(e instanceof Error ? e.message : "Notice could not be deleted."); }
    finally { setDownloading((ids) => ids.filter((id) => id !== key)); }
  };
  return <section className="space-y-5">
    <header>
      <h1 className="text-3xl font-semibold tracking-tight">Exports</h1>
      <p className="mt-1 text-sm font-normal text-foreground">Generated AppFolio files</p>
    </header>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!loading && !error && !notices.length && <p className="text-sm text-muted-foreground">No exports yet.</p>}
    {!loading && notices.length > 0 && <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">{notices.map((notice) => {
      const row = kind === "access" ? rows.find((record) => record.id === notice.recordId) : undefined;
      return <li key={`${notice.recordId}:${notice.filename}`} aria-label={`${notice.tenant}${notice.downloaded ? ", downloaded" : ", not downloaded"}`} className={`grid items-center gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] ${notice.downloaded ? "bg-downloaded" : "bg-card"}`}>
      <p className="min-w-0 break-words text-sm font-medium">{notice.tenant}</p>
      {row && row.count > 1 && <details className="text-xs sm:col-start-1 sm:row-start-2"><summary>Tenants</summary><ul>{row.tenants.map((name, index) => <li key={index}>{name}</li>)}</ul></details>}
      <time className="text-xs text-muted-foreground" dateTime={notice.createdAt}>{chicagoGenerationDate(notice.createdAt)}</time>
      <div className="flex flex-wrap items-center gap-2">{row?.count === 1 && row.accessEmail && <AccessEmailSend row={row} />}<Button variant="outline" size="sm" title={notice.filename} disabled={downloading.includes(`${notice.recordId}:${notice.filename}`)} onClick={() => void downloadNotice(notice)}><Download aria-hidden="true" className="size-4" />Download notice</Button><Button variant="ghost" size="icon" className="size-8" title={`Delete notice for ${notice.tenant}`} aria-label={`Delete notice for ${notice.tenant}`} disabled={downloading.includes(`${notice.recordId}:${notice.filename}`)} onClick={() => void deleteNotice(notice)}><Trash2 aria-hidden="true" className="size-4" /></Button>{notice.downloaded && <span role="status" className="text-xs">Downloaded</span>}</div>
    </li>; })}</ul>}
    {loading && <p role="status">Loading exports…</p>}
  </section>;
}
