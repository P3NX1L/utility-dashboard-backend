import { type FieldDef, type FiveDayTenant, type AccessTenant } from "./types";
import { parseAmount } from "./numberToWords";
import { toISODate, parseDateList, todayISO } from "./dates";

export const MAX_ROWS = 5000;
export const MAX_BYTES = 10 * 1024 * 1024;

export interface Grid { headers: string[]; rows: unknown[][] }

export async function readFileToGrid(file: File): Promise<Grid> {
  if (file.size > MAX_BYTES) throw new Error("File is larger than 10 MB.");
  const name = file.name.toLowerCase();
  let grid: unknown[][];
  if (name.endsWith(".csv") || name.endsWith(".tsv") || name.endsWith(".txt")) {
    const Papa = (await import("papaparse")).default;
    const res = Papa.parse<string[]>(await file.text(), { skipEmptyLines: "greedy" });
    if (res.errors.length) throw new Error(`CSV problem on row ${(res.errors[0]!.row ?? 0) + 1}: ${res.errors[0]!.message}`);
    grid = res.data;
  } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]!]!;
    grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "", blankrows: false });
  } else {
    throw new Error("Please upload a .csv or .xlsx file.");
  }
  const [head, ...rows] = grid;
  if (!head) throw new Error("The file is empty.");
  if (rows.length > MAX_ROWS) throw new Error(`Too many rows (${rows.length}). Limit is ${MAX_ROWS}.`);
  return { headers: head.map((h, i) => String(h ?? "").trim() || `Column ${i + 1}`), rows };
}

/** Mapping: field key -> column index (or -1 for not mapped). */
export type Mapping = Record<string, number>;

export function guessMapping(headers: string[], fields: FieldDef[]): Mapping {
  const norm = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim());
  const used = new Set<number>();
  const m: Mapping = {};
  for (const f of fields) {
    let idx = norm.findIndex((h, i) => !used.has(i) && f.synonyms.includes(h));
    if (idx < 0) idx = norm.findIndex((h, i) => !used.has(i) && f.synonyms.some((s) => h.includes(s)));
    m[f.key] = idx;
    if (idx >= 0) used.add(idx);
  }
  return m;
}

export function missingRequired(mapping: Mapping, fields: FieldDef[]): string[] {
  return fields.filter((f) => f.required && (mapping[f.key] ?? -1) < 0).map((f) => f.label);
}

const cell = (row: unknown[], i: number | undefined) => (i == null || i < 0 ? "" : row[i]);
const str = (v: unknown) => (v instanceof Date ? toISODate(v) : String(v ?? "").trim());
let seq = 0;
const nid = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;

export interface RowIssue { row: number; message: string }

/** Every imported tenant starts unselected — staff must opt in explicitly. */
export function buildFiveDay(grid: Grid, m: Mapping): { tenants: FiveDayTenant[]; issues: RowIssue[] } {
  const tenants: FiveDayTenant[] = [];
  const issues: RowIssue[] = [];
  grid.rows.forEach((r, i) => {
    const names = str(cell(r, m['names']));
    if (!names) { issues.push({ row: i + 2, message: "Missing tenant name — skipped" }); return; }
    const balRaw = cell(r, m['balance']);
    const balance = parseAmount(balRaw);
    if (balance == null) issues.push({ row: i + 2, message: `Balance "${str(balRaw)}" is not a number` });
    tenants.push({
      id: nid(), names, address: str(cell(r, m['address'])), unit: str(cell(r, m['unit'])), llc: str(cell(r, m['llc'])),
      issueDate: toISODate(cell(r, m['issueDate'])) || todayISO(), balance, selected: false, handedOff: false,
    });
  });
  return { tenants, issues };
}

export function buildAccess(grid: Grid, m: Mapping): { tenants: AccessTenant[]; issues: RowIssue[] } {
  const tenants: AccessTenant[] = [];
  const issues: RowIssue[] = [];
  grid.rows.forEach((r, i) => {
    const names = str(cell(r, m['names']));
    if (!names) { issues.push({ row: i + 2, message: "Missing occupant name — skipped" }); return; }
    tenants.push({
      id: nid(), names, address: str(cell(r, m['address'])), unit: str(cell(r, m['unit'])),
      entryDates: parseDateList(cell(r, m['entryDates'])), reason: str(cell(r, m['reason'])), selected: false, handedOff: false,
    });
  });
  return { tenants, issues };
}
