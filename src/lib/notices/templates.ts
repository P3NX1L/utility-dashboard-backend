/**
 * Reusable PDF template mapping.
 *
 * DRAFT LAYOUTS ONLY. When First Western supplies the actual office templates,
 * replace `blocks` (or set `backgroundPdfPage` workflows) and keep the field keys —
 * the rest of the app reads values only through `fieldValues()`.
 * Coordinates are in points on US Letter (612 x 792).
 */
import type { FiveDayTenant, AccessTenant, NoticeKind } from "./types";
import { amountToWords, formatUSD } from "./numberToWords";
import { formatLongDate } from "./dates";

export type Block =
  | { type: "text"; x: number; y: number; text: string; size?: number; bold?: boolean; maxWidth?: number; align?: "left" | "center" }
  | { type: "field"; x: number; y: number; field: string; label?: string; size?: number; bold?: boolean; maxWidth?: number }
  | { type: "rule"; x: number; y: number; w: number };

export interface NoticeTemplate {
  id: string;
  kind: NoticeKind;
  title: string;
  isDraft: boolean; // keep true until real office template is supplied
  version: string;
  blocks: Block[];
}

export const DRAFT_LABEL = "DRAFT — NOT AN OFFICIAL FIRST WESTERN TEMPLATE";

export const FIVE_DAY_TEMPLATE: NoticeTemplate = {
  id: "five-day-draft", kind: "five-day", title: "5-Day Notice (Draft Layout)", isDraft: true, version: "draft-0.1",
  blocks: [
    { type: "text", x: 306, y: 90, text: "FIVE-DAY NOTICE", size: 18, bold: true, align: "center" },
    { type: "text", x: 306, y: 110, text: "[Placeholder wording — replace with office template]", size: 9, align: "center" },
    { type: "rule", x: 72, y: 124, w: 468 },
    { type: "field", x: 72, y: 160, field: "issueDateLong", label: "Date issued: ", size: 11 },
    { type: "field", x: 72, y: 190, field: "names", label: "To: ", size: 11, bold: true, maxWidth: 468 },
    { type: "field", x: 72, y: 210, field: "addressLine", label: "Premises: ", size: 11, maxWidth: 468 },
    { type: "field", x: 72, y: 240, field: "llc", label: "Landlord / Owner: ", size: 11, maxWidth: 468 },
    { type: "field", x: 72, y: 280, field: "balanceNumeric", label: "Amount due: ", size: 12, bold: true },
    { type: "field", x: 72, y: 300, field: "balanceWords", label: "(", size: 10, maxWidth: 468 },
    { type: "text", x: 72, y: 340, size: 10, maxWidth: 468,
      text: "[Placeholder body text. The legally required notice language must come from the office's approved template. Do not serve this draft.]" },
    { type: "text", x: 72, y: 600, text: "Signature: ______________________________", size: 10 },
    { type: "field", x: 72, y: 620, field: "llc", label: "On behalf of ", size: 10 },
  ],
};

export const ACCESS_TEMPLATE: NoticeTemplate = {
  id: "access-draft", kind: "access", title: "Notice of Entry / Access (Draft Layout)", isDraft: true, version: "draft-0.1",
  blocks: [
    { type: "text", x: 306, y: 90, text: "NOTICE OF INTENT TO ENTER", size: 18, bold: true, align: "center" },
    { type: "text", x: 306, y: 110, text: "[Placeholder wording — replace with office template]", size: 9, align: "center" },
    { type: "rule", x: 72, y: 124, w: 468 },
    { type: "field", x: 72, y: 170, field: "names", label: "To: ", size: 11, bold: true, maxWidth: 468 },
    { type: "field", x: 72, y: 190, field: "addressLine", label: "Premises: ", size: 11, maxWidth: 468 },
    { type: "field", x: 72, y: 230, field: "entryDatesLong", label: "Scheduled entry date(s): ", size: 11, bold: true, maxWidth: 468 },
    { type: "field", x: 72, y: 270, field: "reason", label: "Reason for entry: ", size: 11, maxWidth: 468 },
    { type: "text", x: 72, y: 320, size: 10, maxWidth: 468,
      text: "[Placeholder body text. Required notice periods and wording must come from the office's approved template. Do not serve this draft.]" },
    { type: "text", x: 72, y: 600, text: "First Western Property Management — Office Staff", size: 10 },
  ],
};

export const TEMPLATES: Record<NoticeKind, NoticeTemplate> = { "five-day": FIVE_DAY_TEMPLATE, access: ACCESS_TEMPLATE };

/** Office-supplied text runs. Coordinates retain top-left baselines; the pdf-lib
 * renderer converts them to PDF bottom-left coordinates without rounding. */
export const FIVE_DAY_OFFICE_TEMPLATE = {
  isDraft: false,
  width: 612, height: 792,
  heading: { x: 180, top: 70, width: 252, height: 44 },
  runs: [
    [72.0, 151.5, 1, "TO"], [89.12, 151.5, 0, ": "],
    [72.0, 179.1, 1, "        AND ANY AND ALL UNKNOWN OCCUPANTS"],
    [72.0, 206.7, 1, "YOU ARE HEREBY NOTIFIED"],
    [246.77, 206.7, 0, " that there is now due the undersigned landlord or agent the "],
    [72.0, 289.49, 0, "together with all buildings, sheds, closets, out-buildings, garages and barns used in connection "],
    [72.0, 303.29, 0, "with said premises.  "],
    [173.32, 303.29, 1, "AND YOU ARE FURTHER NOTIFIED"],
    [382.41, 303.29, 0, " that full payment of said sum so "],
    [72.0, 317.09, 0, "due has been and is hereby demanded of you, and that unless full payment thereof is made on or "],
    [72.0, 330.89, 0, "before the expiration of five days after service of this notice, your leasehold of said premises will "],
    [72.0, 344.68, 0, "be terminated, without terminating your obligations thereunder, five legal days after the date of "],
    [72.0, 358.48, 0, "service of this notice, excluding federal holidays. Should the fifth day of the five-day period be a "],
    [72.0, 372.28, 0, "Saturday or Sunday, the fifth day shall become the next business day. "],
    [72.0, 399.88, 1, "ONLY FULL PAYMENT"],
    [203.74, 399.88, 0, " of the rent demanded in this notice will waive the landlord’s right to "],
    [72.0, 413.68, 0, "terminate the lease under this notice, unless the landlord agrees in writing to continue the lease in "],
    [72.0, 427.48, 0, "exchange for receiving partial payment. "],
    [72.0, 455.07, 1, "THIS IS AN ATTEMPT TO COLLECT A DEBT AND ANY INFORMATION   "],
    [72.0, 468.87, 1, "OBTAINED WILL BE USED FOR THAT PURPOSE. "],
    [72.0, 496.47, 0, "LANDLORD/AGENT: First Western Properties, Inc is authorized to receive said rent for the "],
    [72.0, 510.27, 0, "undersigned. "],
    [288.0, 593.06, 0, "LESSOR/LANDLORD:   "],
  ] as const,
};

export const addressLine = (t: { address: string; unit: string }) =>
  [t.address, t.unit ? `Unit ${t.unit}` : ""].filter(Boolean).join(", ") || "[address]";

export function fieldValues(kind: "five-day", t: FiveDayTenant): Record<string, string>;
export function fieldValues(kind: "access", t: AccessTenant): Record<string, string>;
export function fieldValues(kind: NoticeKind, t: FiveDayTenant | AccessTenant): Record<string, string> {
  const base = { names: t.names || "[names]", addressLine: addressLine(t), address: t.address, unit: t.unit };
  if (kind === "five-day") {
    const f = t as FiveDayTenant;
    return {
      ...base, llc: f.llc || "[LLC]", issueDateLong: formatLongDate(f.issueDate),
      balanceNumeric: formatUSD(f.balance), balanceWords: f.balance != null ? `${amountToWords(f.balance)})` : "[balance])",
    };
  }
  const a = t as AccessTenant;
  return {
    ...base, reason: a.reason || "[reason]",
    entryDatesLong: a.entryDates.length ? a.entryDates.map(formatLongDate).join("; ") : "[entry dates]",
  };
}
