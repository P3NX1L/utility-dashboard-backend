import { buildNoticePdf } from "./pdf";
import { ACCESS_TEMPLATE, fieldValues } from "./templates";
import { dateWording } from "./fiveDay";
import type { AccessTenant } from "./types";
import type { GeneratedNotice } from "./fiveDayPdf";
export function accessIssues(rows: AccessTenant[]): string[] {
  return rows.flatMap((r) => {
    const issues: string[] = [];
    if (!r.names.trim() || !r.address.trim()) issues.push(`${r.names || "Tenant"}: name and address required.`);
    if (!r.reason.trim()) issues.push(`${r.names}: entry reason required.`);
    if (!r.entryDates.length) issues.push(`${r.names}: entry date required.`);
    for (const d of r.entryDates) { try { dateWording(d); } catch { issues.push(`${r.names}: valid entry date required.`); } }
    return issues;
  });
}
export async function generateAccessNotices(rows: AccessTenant[]): Promise<GeneratedNotice[]> {
  if (!rows.length) throw new Error("Select at least one occupant.");
  const issues = accessIssues(rows); if (issues.length) throw new Error(issues.join(" "));
  const notices: GeneratedNotice[] = [];
  for (const [i, row] of rows.entries()) {
    const name = row.names.normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 70) || "Tenant";
    const blob = await buildNoticePdf(ACCESS_TEMPLATE, [fieldValues("access", row)]);
    notices.push({ id: row.id, filename: `Access_DRAFT_${name}_${i + 1}.pdf`, bytes: new Uint8Array(await blob.arrayBuffer()) });
  }
  return notices;
}
