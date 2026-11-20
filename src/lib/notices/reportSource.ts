import { parseAppFolioCsv } from "./fiveDay";

export interface ReportSource { userId: string; filename: string; csv: string }
// Separate store leaves existing export bytes and database version untouched.
function openReports(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("first-western-delinquency-source", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("reports", { keyPath: "userId" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Browser report storage is unavailable. Your previous report has not been replaced."));
  });
}
export async function readReportSource(userId: string): Promise<ReportSource | null> {
  if (!userId) return null;
  const db = await openReports();
  try { return await new Promise((resolve, reject) => {
    const request = db.transaction("reports", "readonly").objectStore("reports").get(userId);
    request.onsuccess = () => {
      const source = request.result as ReportSource | undefined;
      resolve(source?.userId === userId ? source : null);
    };
    request.onerror = () => reject(new Error("Your saved report could not be restored. Try refreshing."));
  }); } finally { db.close(); }
}
export async function saveReportSource(userId: string, filename: string, csv: string, signal: AbortSignal): Promise<void> {
  if (!userId) throw new Error("A signed-in account is required.");
  if (!filename.toLowerCase().endsWith(".csv")) throw new Error("Please upload a .csv file.");
  if (new Blob([csv]).size > 10 * 1024 * 1024) throw new Error("The CSV exceeds 10 MB.");
  parseAppFolioCsv(csv); // Never overwrite a valid source with an empty or malformed report.
  const db = await openReports();
  try { await new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new Error("Report update cancelled.")); return; }
    const tx = db.transaction("reports", "readwrite");
    const abort = () => { try { tx.abort(); } catch { /* Already completed. */ } };
    signal.addEventListener("abort", abort, { once: true });
    const remove = () => signal.removeEventListener("abort", abort);
    tx.oncomplete = () => { remove(); resolve(); };
    tx.onerror = tx.onabort = () => { remove(); reject(new Error("Report could not be saved. Check browser storage space and try again. Your previous report has not been replaced.")); };
    tx.objectStore("reports").put({ userId, filename, csv } satisfies ReportSource);
  }); } catch {
    throw new Error("Report could not be saved. Check browser storage space and try again. Your previous report has not been replaced.");
  } finally { db.close(); }
}