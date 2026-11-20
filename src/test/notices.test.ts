import { describe, expect, it } from "vitest";
import { amountToWords, parseAmount } from "@/lib/notices/numberToWords";
import { buildFiveDay, buildAccess, guessMapping } from "@/lib/notices/importer";
import { FIVE_DAY_FIELDS, ACCESS_FIELDS } from "@/lib/notices/types";
import { FIVE_DAY_TEMPLATE, ACCESS_TEMPLATE } from "@/lib/notices/templates";

describe("balance in words", () => {
  it("writes dollars and cents", () => {
    expect(amountToWords(1234.56)).toBe("One Thousand Two Hundred Thirty-Four and 56/100 Dollars");
    expect(amountToWords(875)).toBe("Eight Hundred Seventy-Five and 00/100 Dollars");
  });
  it("parses currency text", () => {
    expect(parseAmount("$1,234.56")).toBe(1234.56);
    expect(parseAmount("abc")).toBeNull();
  });
});

describe("tenant selection", () => {
  it("imports every 5-day tenant unselected", () => {
    const grid = { headers: ["Tenant", "Address", "LLC", "Balance"], rows: [["A", "1 St", "X LLC", "10"], ["B", "2 St", "X LLC", "20"]] };
    const { tenants } = buildFiveDay(grid, guessMapping(grid.headers, FIVE_DAY_FIELDS));
    expect(tenants).toHaveLength(2);
    expect(tenants.every((t) => !t.selected)).toBe(true);
  });
  it("imports access occupants unselected with multiple entry dates", () => {
    const grid = { headers: ["Occupants", "Address", "Entry Dates", "Reason"], rows: [["A", "1 St", "2026-01-12; 01/13/2026", "Repair"]] };
    const { tenants } = buildAccess(grid, guessMapping(grid.headers, ACCESS_FIELDS));
    expect(tenants[0]?.selected).toBe(false);
    expect(tenants[0]?.entryDates).toEqual(["2026-01-12", "2026-01-13"]);
  });
});

describe("templates", () => {
  it("stay labelled as drafts until office templates are supplied", () => {
    expect(FIVE_DAY_TEMPLATE.isDraft).toBe(true);
    expect(ACCESS_TEMPLATE.isDraft).toBe(true);
  });
});
