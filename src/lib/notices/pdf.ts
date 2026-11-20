import type { jsPDF as JsPDF } from "jspdf";
import { DRAFT_LABEL, type NoticeTemplate } from "./templates";

function drawPage(doc: JsPDF, tpl: NoticeTemplate, values: Record<string, string>) {
  for (const b of tpl.blocks) {
    if (b.type === "rule") { doc.setLineWidth(0.75); doc.line(b.x, b.y, b.x + b.w, b.y); continue; }
    doc.setFont("helvetica", b.bold ? "bold" : "normal");
    doc.setFontSize(b.size ?? 11);
    const text = b.type === "text" ? b.text : `${b.label ?? ""}${values[b.field] ?? `[${b.field}]`}`;
    if (b.type === "text" && b.align === "center") { doc.text(text, b.x, b.y, { align: "center" }); continue; }
    doc.text(b.maxWidth ? doc.splitTextToSize(text, b.maxWidth) : text, b.x, b.y);
  }
  if (tpl.isDraft) {
    doc.setTextColor(200, 40, 40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(DRAFT_LABEL, 306, 40, { align: "center" });
    doc.text(DRAFT_LABEL, 306, 760, { align: "center" });
    doc.setFontSize(64);
    doc.setTextColor(235, 200, 200);
    doc.text("DRAFT", 306, 470, { align: "center", angle: 30 });
    doc.setTextColor(0, 0, 0);
  }
}

/** One page per selected tenant. Opens in a new tab for printing; never sent anywhere. */
export async function buildNoticePdf(tpl: NoticeTemplate, pages: Record<string, string>[]): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  pages.forEach((v, i) => { if (i) doc.addPage(); drawPage(doc, tpl, v); });
  return doc.output("blob");
}
