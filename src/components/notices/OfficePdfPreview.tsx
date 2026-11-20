import { useEffect, useRef, useState } from "react";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export default function OfficePdfPreview({ bytes, id, onRendered }: { bytes: Uint8Array; id: string; onRendered: (id: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    setError(""); setLoading(true);
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        if (cancelled) return;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true });
        dispose = () => { void task.destroy(); };
        const doc = await task.promise;
        const page = await doc.getPage(1);
        if (cancelled || !canvas.current) return;
        const viewport = page.getViewport({ scale: 1.5 });
        const target = canvas.current;
        target.width = viewport.width; target.height = viewport.height;
        await page.render({ canvas: target, viewport }).promise;
        if (!cancelled) { setLoading(false); onRendered(id); }
      } catch (e) { if (!cancelled) { setError(e instanceof Error ? e.message : "PDF preview failed."); setLoading(false); } }
    })();
    return () => { cancelled = true; dispose?.(); };
  }, [bytes, id, onRendered]);
  return <div className="relative aspect-[612/792] w-full border border-border bg-card">
    {loading && <p className="absolute inset-x-0 top-5 text-center text-sm text-muted-foreground" role="status">Rendering PDF…</p>}
    {error && <p role="alert" className="absolute inset-x-0 top-5 px-4 text-sm text-destructive">{error}</p>}
    <canvas ref={canvas} className="h-auto w-full" aria-label="Generated notice PDF preview" />
  </div>;
}