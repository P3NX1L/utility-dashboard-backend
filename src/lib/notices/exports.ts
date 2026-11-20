import JSZip from "jszip";
import type { NoticeKind } from "./types";
import type { GeneratedNotice } from "./fiveDayPdf";

export interface ExportRecord {
  id: string; userId: string; kind: NoticeKind; createdAt: string;
  tenants: string[]; count: number; filename: string; blob: Blob;
  downloadedFiles?: string[];
  deletedFiles?: string[];
}
export async function packageReviewed(notices: GeneratedNotice[], reviewed: string[], kind: NoticeKind) {
  if (!notices.length || notices.some((n) => !reviewed.includes(n.id))) throw new Error("Review every PDF before exporting.");
  const names = new Set<string>();
  for (const n of notices) {
    if (new TextDecoder().decode(n.bytes.subarray(0, 5)) !== "%PDF-") throw new Error("Invalid PDF; no export saved.");
    if (!n.filename.endsWith(".pdf") || names.has(n.filename.toLowerCase())) throw new Error("PDF filenames must be unique.");
    names.add(n.filename.toLowerCase());
  }
  const single = notices[0];
  if (notices.length === 1 && single) return { filename: single.filename, blob: new Blob([new Uint8Array(single.bytes)], { type: "application/pdf" }) };
  const zip = new JSZip();
  for (const n of notices) zip.file(n.filename, n.bytes);
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return { filename: `${kind === "access" ? "Access" : "5-Day"}_Notices.zip`, blob: new Blob([new Uint8Array(bytes)], { type: "application/zip" }) };
}
function openHistory(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("first-western-notice-exports", 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("exports", { keyPath: ["userId", "id"] });
      store.createIndex("owner", "userId");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Browser export storage is unavailable."));
  });
}
export async function saveExport(userId: string, record: ExportRecord, signal?: AbortSignal): Promise<void> {
  if (!userId || record.userId !== userId) throw new Error("Export account mismatch.");
  const db = await openHistory();
  try { await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("Export was changed before saving.")); return; }
    const tx = db.transaction("exports", "readwrite");
    const abort = () => { try { tx.abort(); } catch { /* Already committed. */ } };
    signal?.addEventListener("abort", abort, { once: true });
    const remove = () => signal?.removeEventListener("abort", abort);
    tx.objectStore("exports").add(record);
    tx.oncomplete = () => { remove(); resolve(); };
    tx.onerror = () => { remove(); reject(new Error("Export could not be saved. Check browser storage space.")); };
    tx.onabort = () => { remove(); reject(new Error("Export storage was interrupted.")); };
  }); } finally { db.close(); }
}
export async function listExports(userId: string, kind: NoticeKind): Promise<ExportRecord[]> {
  if (!userId) return [];
  const db = await openHistory();
  try { return await new Promise<ExportRecord[]>((resolve, reject) => {
    const tx = db.transaction("exports", "readonly");
    const request = tx.objectStore("exports").index("owner").getAll(IDBKeyRange.only(userId));
    request.onsuccess = () => resolve((request.result as ExportRecord[]).filter((r) => r.userId === userId && r.kind === kind).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    request.onerror = () => reject(new Error("Export history could not be read."));
  }); } finally { db.close(); }
}
export function downloadExport(record: Pick<ExportRecord, "filename" | "blob">) {
  const url = URL.createObjectURL(record.blob);
  const a = document.createElement("a"); a.href = url; a.download = record.filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export interface NoticeDownload {
  recordId: string; filename: string; tenant: string; createdAt: string; blob: Blob; downloaded: boolean;
}
/** Legacy ZIPs remain stored verbatim; expose their individual PDFs without rewriting history. */
export async function individualFiveDayDownloads(records: ExportRecord[]): Promise<NoticeDownload[]> {
  const rows: NoticeDownload[] = [];
  for (const record of records) {
    const item = (filename: string, blob: Blob, index: number): NoticeDownload => ({ recordId: record.id, filename, blob, tenant: record.tenants[index] ?? filename, createdAt: record.createdAt, downloaded: record.downloadedFiles?.includes(filename) ?? false });
    if (record.filename.toLowerCase().endsWith(".pdf") && !record.deletedFiles?.includes(record.filename)) rows.push(item(record.filename, record.blob, 0));
    else if (record.filename.toLowerCase().endsWith(".zip")) {
      const zip = await JSZip.loadAsync(await record.blob.arrayBuffer());
      const files = Object.values(zip.files).filter((file) => !file.dir && file.name.toLowerCase().endsWith(".pdf"));
      for (const [index, file] of files.entries()) {
        if (record.deletedFiles?.includes(file.name)) continue;
        const bytes = await file.async("uint8array");
        rows.push(item(file.name, new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), index));
      }
    }
  }
  return rows;
}
export function chicagoGenerationDate(createdAt: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "2-digit", day: "2-digit", year: "numeric" }).format(new Date(createdAt));
}
/** Remove single PDFs; hide only the selected entry in legacy ZIPs, retaining sibling bytes and original tenant indices. */
export async function deleteFiveDayNotice(userId: string, recordId: string, filename: string): Promise<void> {
  if (!userId) throw new Error("A signed-in account is required.");
  const db = await openHistory();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("exports", "readwrite");
    const store = tx.objectStore("exports");
    const request = store.get([userId, recordId]);
    request.onsuccess = () => {
      const record = request.result as ExportRecord | undefined;
      if (!record || record.userId !== userId || record.kind !== "five-day") { tx.abort(); return; }
      if (record.filename.toLowerCase().endsWith(".pdf")) {
        if (record.filename !== filename) { tx.abort(); return; }
        store.delete([userId, recordId]);
      } else {
        store.put({ ...record, deletedFiles: [...new Set([...(record.deletedFiles ?? []), filename])] });
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(new Error("Notice could not be deleted. Please try again."));
  }); } finally { db.close(); }
}
export async function markNoticeDownloaded(userId: string, recordId: string, filename: string): Promise<void> {
  if (!userId) throw new Error("A signed-in account is required.");
  const db = await openHistory();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("exports", "readwrite");
    const store = tx.objectStore("exports");
    const request = store.get([userId, recordId]);
    request.onsuccess = () => {
      const record = request.result as ExportRecord | undefined;
      if (!record || record.userId !== userId || record.kind !== "five-day") { tx.abort(); return; }
      store.put({ ...record, downloadedFiles: [...new Set([...(record.downloadedFiles ?? []), filename])] });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(new Error("Downloaded state could not be saved."));
  }); } finally { db.close(); }
}
