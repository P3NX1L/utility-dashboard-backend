import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import JSZip from "jszip";
import headingUrl from "@/assets/five-day-heading.png?url";
import { FIVE_DAY_OFFICE_TEMPLATE as template } from "./templates";
import { integerToWords, formatUSD } from "./numberToWords";
import { dateWording, noticeIssues, uniquePdfNames, type NoticeInput } from "./fiveDay";

export interface GeneratedNotice { id: string; filename: string; bytes: Uint8Array }
export interface GeneratedBatch { notices: GeneratedNotice[]; zip: Blob }
/** The active 5-Day workflow permits exactly one eligible tenant, even if called outside the UI. */
export async function buildSingleRentNotice(inputs: NoticeInput[]): Promise<Pick<GeneratedBatch, "notices">> {
  if (inputs.length !== 1) throw new Error("Select exactly one eligible tenant.");
  const input = inputs[0];
  if (!input) throw new Error("Select exactly one eligible tenant.");
  const issues = noticeIssues(input);
  if (issues.length) throw new Error(`${input.tenant.name}: ${issues.join(" ")}`);
  const response = await fetch(headingUrl);
  if (!response.ok) throw new Error("The office heading could not be loaded. Try again.");
  const filename = uniquePdfNames(inputs)[0];
  if (!filename) throw new Error("Unable to assign a filename.");
  const bytes = await generateNoticePdf(input, new Uint8Array(await response.arrayBuffer()));
  return { notices: [{ id: input.tenant.id, filename, bytes }] };
}
export function demandWords(amount: number): string {
  const cents = Math.round(amount * 100);
  const words = integerToWords(Math.floor(cents / 100)).replace(/-/g, " ").toLowerCase();
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} and ${String(cents % 100).padStart(2, "0")}/100 dollars (${formatUSD(amount)})`;
}
type Piece = { text: string; bold?: boolean; underline?: boolean };

/** Measured word wrapping keeps 12-point office fonts; never clips or silently
 * truncates an address, owner, or legal text. Extra lines move later baselines. */
function drawWrapped(page: PDFPage, regular: PDFFont, bold: PDFFont, pieces: Piece[], x: number, baseline: number, width: number, center = false): number {
  const lines: Piece[][] = [[]];
  let lineWidth = 0;
  for (const piece of pieces) {
    const font = piece.bold ? bold : regular;
    for (const token of piece.text.match(/\S+\s*|\s+/g) ?? []) {
      const tokenWidth = font.widthOfTextAtSize(token, 12);
      if (font.widthOfTextAtSize(token.trim(), 12) > width) throw new Error("A word is too long for the office layout. Please review the field.");
      if (lineWidth + tokenWidth > width && lineWidth > 0) { lines.push([]); lineWidth = 0; }
      const line = lines.at(-1);
      if (line) { line.push({ ...piece, text: lineWidth === 0 ? token.trimStart() : token }); lineWidth += tokenWidth; }
    }
  }
  lines.forEach((line, index) => {
    const total = line.reduce((sum, p) => sum + (p.bold ? bold : regular).widthOfTextAtSize(p.text, 12), 0);
    let left = center ? x + (width - total) / 2 : x;
    for (const piece of line) {
      const font = piece.bold ? bold : regular;
      const w = font.widthOfTextAtSize(piece.text, 12);
      const y = 792 - baseline - index * 13.8;
      page.drawText(piece.text, { x: left, y, size: 12, font });
      if (piece.underline) page.drawLine({ start: { x: left, y: y - 1.5 }, end: { x: left + w, y: y - 1.5 }, thickness: 0.5 });
      left += w;
    }
  });
  return (lines.length - 1) * 13.8;
}

export async function generateNoticePdf(input: NoticeInput, heading: Uint8Array): Promise<Uint8Array> {
  const issues = noticeIssues(input);
  if (issues.length) throw new Error(`${input.tenant.name}: ${issues.join(" ")}`);
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.TimesRoman), bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const page = doc.addPage([template.width, template.height]);
  const image = await doc.embedPng(heading);
  const art = template.heading;
  page.drawImage(image, { x: art.x, y: template.height - art.top - art.height, width: art.width, height: art.height });
  const t = input.tenant;
  let nameExtra = drawWrapped(page, regular, bold, [{ text: t.name, bold: true }], 95.3, 152, 444.7);
  // The sample leaves room for two name lines before UNKNOWN OCCUPANTS.
  nameExtra = Math.max(0, nameExtra - 13.8);
  const amount = t.rent;
  if (amount === null) throw new Error("Missing delinquent rent.");
  // One continuous sentence (sample: two lines at 220/234); later blocks follow its real last line.
  const sumExtra = Math.max(0, drawWrapped(page, regular, bold, [
    { text: "sum of: " }, { text: demandWords(amount), bold: true, underline: true },
    { text: ` being rent due for the premises situated in the City of ${t.city}, County of Cook, and State of Illinois described as follows to-wit:` },
  ], 72, 220 + nameExtra, 468) - 13.8);
  const cityExtra = 0;
  const streetExtra = drawWrapped(page, regular, bold, [{ text: `${t.street} Unit #${t.unit}, ${t.city}, IL ${t.zip}`, bold: true, underline: true }], 72, 262 + nameExtra + sumExtra + cityExtra, 468, true);
  const bodyExtra = nameExtra + sumExtra + cityExtra + streetExtra;
  for (const [x, baseline, isBold, text] of template.runs) {
    const extra = baseline >= 289 ? bodyExtra : baseline >= 179 ? nameExtra : 0;
    page.drawText(text, { x, y: 792 - baseline - extra, size: 12, font: isBold ? bold : regular });
  }
  drawWrapped(page, regular, bold, [{ text: dateWording(input.issueDate) }], 72, 538 + bodyExtra, 468);
  page.drawText("By", { x: 288, y: 792 - 634 - bodyExtra, size: 12, font: regular });
  const agentExtra = drawWrapped(page, regular, bold, [{ text: input.agent }], 311, 634 + bodyExtra, 229);
  page.drawLine({ start: { x: 305, y: 792 - 636 - bodyExtra - agentExtra }, end: { x: 432, y: 792 - 636 - bodyExtra - agentExtra }, thickness: 0.5 });
  const ownerExtra = drawWrapped(page, regular, bold, [{ text: `As an agent for ${input.owner}` }], 268, 648 + bodyExtra + agentExtra, 272);
  if (648 + bodyExtra + agentExtra + ownerExtra > 730) throw new Error(`${t.name}: fields exceed one-page office layout. Shorten the display fields without omitting required information.`);
  return doc.save();
}

export async function buildRentBatch(inputs: NoticeInput[], headingBytes?: Uint8Array): Promise<GeneratedBatch> {
  if (!inputs.length) throw new Error("Select at least one tenant.");
  for (const input of inputs) {
    const issues = noticeIssues(input);
    if (issues.length) throw new Error(`${input.tenant.name}: ${issues.join(" ")}`);
  }
  let heading = headingBytes;
  if (!heading) {
    const response = await fetch(headingUrl);
    if (!response.ok) throw new Error("The office heading could not be loaded. Try again.");
    heading = new Uint8Array(await response.arrayBuffer());
  }
  const names = uniquePdfNames(inputs), notices: GeneratedNotice[] = [];
  const zip = new JSZip();
  // Nothing downloadable is exposed until every selected row succeeds.
  for (const [index, input] of inputs.entries()) {
    const filename = names[index];
    if (!filename) throw new Error("Unable to assign a unique filename.");
    const bytes = await generateNoticePdf(input, heading);
    notices.push({ id: input.tenant.id, filename, bytes });
    zip.file(filename, bytes);
  }
  const zipBytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return { notices, zip: new Blob([new Uint8Array(zipBytes)], { type: "application/zip" }) };
}