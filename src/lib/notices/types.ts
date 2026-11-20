export type NoticeKind = "five-day" | "access";

export interface FiveDayTenant {
  id: string;
  names: string;
  address: string;
  unit: string;
  llc: string;
  issueDate: string; // YYYY-MM-DD
  balance: number | null;
  selected: boolean;
  handedOff: boolean;
}

export interface AccessTenant {
  id: string;
  names: string;
  address: string;
  unit: string;
  entryDates: string[]; // YYYY-MM-DD
  reason: string;
  selected: boolean;
  handedOff: boolean;
}

export interface FieldDef {
  key: string;
  label: string;
  required: boolean;
  synonyms: string[];
}

export const FIVE_DAY_FIELDS: FieldDef[] = [
  { key: "names", label: "Tenant name(s)", required: true, synonyms: ["name", "names", "tenant", "tenants", "tenant name", "resident"] },
  { key: "address", label: "Address", required: true, synonyms: ["address", "property address", "street"] },
  { key: "unit", label: "Unit", required: false, synonyms: ["unit", "apt", "apartment", "unit number"] },
  { key: "llc", label: "LLC / Owner entity", required: true, synonyms: ["llc", "owner", "entity", "landlord", "owner entity"] },
  { key: "issueDate", label: "Issue date", required: false, synonyms: ["issue date", "date", "notice date"] },
  { key: "balance", label: "Balance due", required: true, synonyms: ["balance", "amount", "amount due", "balance due", "rent due"] },
];

export const ACCESS_FIELDS: FieldDef[] = [
  { key: "names", label: "Occupant name(s)", required: true, synonyms: ["name", "names", "tenant", "tenants", "occupant", "occupants", "resident"] },
  { key: "address", label: "Address", required: true, synonyms: ["address", "property address", "street"] },
  { key: "unit", label: "Unit", required: false, synonyms: ["unit", "apt", "apartment", "unit number"] },
  { key: "entryDates", label: "Entry date(s)", required: false, synonyms: ["entry date", "entry dates", "dates", "access date", "access dates"] },
  { key: "reason", label: "Reason for entry", required: false, synonyms: ["reason", "purpose", "work", "description"] },
];
