import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { diffDirectory, isDirectoryConflict, parsePropertyDirectory, readLegalOwnerDirectory, readPropertyDirectoryFile, replaceLegalOwnerDirectory } from "@/lib/notices/legalOwnerMapping";

describe("AppFolio property directory", () => {
  it("maps Property and Portfolio with BOM, quoted commas, embedded newlines, blanks and an exact final Total footer", () => {
    expect(parsePropertyDirectory('\uFEFFProperty,Portfolio,Units\r\n"Synthetic, North","Example, LLC",2\r\n\r\n"Synthetic\nSouth",Example Trust,3\r\nTotal,,5\r\n')).toEqual([
      { property_name: "Synthetic\nSouth", legal_owner: "Example Trust" },
      { property_name: "Synthetic, North", legal_owner: "Example, LLC" },
    ]);
  });
  it("rejects CSV parsing errors rather than salvaging rows", () => {
    expect(() => parsePropertyDirectory('Property,Portfolio\n"Unclosed,Owner')).toThrow(/CSV error/);
  });
  it("requires the exact Property and Portfolio headers", () => {
    expect(() => parsePropertyDirectory("Property,Owner\nNorth,LLC")).toThrow(/Property.*Portfolio/);
  });
  it("rejects ambiguous duplicate headers", () => {
    expect(() => parsePropertyDirectory("Property,Portfolio,Portfolio\nNorth,A,B")).toThrow(/exactly one/);
  });
  it("rejects case-insensitive duplicate property names", () => {
    expect(() => parsePropertyDirectory("Property,Portfolio\nNorth,A\nnORTH,B")).toThrow(/duplicate property/);
  });
  it("rejects a blank property even after valid records", () => {
    expect(() => parsePropertyDirectory("Property,Portfolio\nNorth,A\n,B")).toThrow(/Row 3/);
  });
  it("rejects a blank owner even after valid records", () => {
    expect(() => parsePropertyDirectory("Property,Portfolio\nNorth,A\nSouth, ")).toThrow(/Row 3/);
  });
  it("rejects comma-only blank records instead of silently dropping them", () => {
    expect(() => parsePropertyDirectory("Property,Portfolio\nNorth,A\n,")).toThrow(/Row 3/);
  });
  it("rejects incorrect column counts", () => {
    expect(() => parsePropertyDirectory("Property,Portfolio\nNorth,A,Extra")).toThrow(/expected 2 columns/);
  });
  it("never skips a Total row with an owner", () => {
    expect(parsePropertyDirectory("Property,Portfolio\nTotal,Actual Owner")).toEqual([{ property_name: "Total", legal_owner: "Actual Owner" }]);
  });
  it("rejects a Total-with-empty-owner row that is not the final footer", () => {
    expect(() => parsePropertyDirectory("Property,Portfolio\nTotal,\nNorth,A")).toThrow(/Row 2/);
  });
  it("does not treat a differently cased total as the footer", () => {
    expect(() => parsePropertyDirectory("Property,Portfolio\nNorth,A\ntotal,")).toThrow(/Row 3/);
  });
  it("rejects directories with no valid rows", () => {
    expect(() => parsePropertyDirectory("Property,Portfolio\nTotal,")).toThrow(/no valid properties/);
  });
  it("rejects a non-CSV upload before reading it", async () => {
    await expect(readPropertyDirectoryFile(new File(["Property,Portfolio\nNorth,A"], "directory.xlsx"))).rejects.toThrow(/\.csv/);
  });
  it("previews adds, owner/name edits and deletes against the complete original", () => {
    const original = [{ property_name: "North", legal_owner: "Old" }, { property_name: "Removed", legal_owner: "Trust" }];
    const incoming = [{ property_name: "NORTH", legal_owner: "New" }, { property_name: "Added", legal_owner: "LLC" }];
    const changes = diffDirectory(original, incoming);
    expect(changes.map((c) => c.type)).toEqual(["Edit", "Add", "Delete"]);
    expect(changes[0]?.before).toBe("North — Old");
    expect(changes[0]?.after).toBe("NORTH — New");
    expect(changes[2]?.property).toBe("Removed");
  });
  it("recognizes a no-op irrespective of CSV ordering", () => {
    const rows = [{ property_name: "A", legal_owner: "Owner A" }, { property_name: "B", legal_owner: "Owner B" }];
    expect(diffDirectory(rows, [...rows].reverse())).toEqual([]);
  });
});

describe("existing directory service", () => {
  it("reads beyond 1000 with stable ordering and inclusive non-overlapping pages", async () => {
    const all = Array.from({ length: 1203 }, (_, i) => ({ property_name: `Synthetic ${String(i).padStart(4, "0")}`, legal_owner: "Synthetic LLC" }));
    const range = vi.fn((start: number, end: number) => Promise.resolve({ data: all.slice(start, end + 1), error: null }));
    const order = vi.fn();
    const query = { select: vi.fn(), order, range };
    query.select.mockReturnValue(query); order.mockReturnValue(query);
    const from = vi.fn(() => query);
    const rows = await readLegalOwnerDirectory({ from } as unknown as SupabaseClient);
    expect(rows).toEqual(all);
    expect(from).toHaveBeenCalledWith("notice_legal_owner_mapping");
    expect(query.select).toHaveBeenCalledWith("property_name,legal_owner");
    expect(order).toHaveBeenCalledWith("property_name", { ascending: true });
    expect(order).toHaveBeenCalledWith("legal_owner", { ascending: true });
    expect(range.mock.calls).toEqual([[0, 499], [500, 999], [1000, 1499]]);
  });
  it("fails the whole snapshot if a later page errors", async () => {
    const query = { select: vi.fn(), order: vi.fn(), range: vi.fn() };
    query.select.mockReturnValue(query); query.order.mockReturnValue(query);
    query.range.mockResolvedValueOnce({ data: Array.from({ length: 500 }, (_, i) => ({ property_name: String(i), legal_owner: "A" })), error: null }).mockResolvedValueOnce({ data: null, error: new Error("Read denied") });
    await expect(readLegalOwnerDirectory({ from: () => query } as unknown as SupabaseClient)).rejects.toThrow("Read denied");
  });
  it("sends exactly the replacement and full original arrays to the existing RPC", async () => {
    const directory = [{ property_name: "New", legal_owner: "New LLC" }], original = [{ property_name: "Old", legal_owner: "Old Trust" }];
    const rpc = vi.fn().mockResolvedValue({ data: 1, error: null });
    expect(await replaceLegalOwnerDirectory({ rpc } as unknown as SupabaseClient, directory, original)).toBe(1);
    expect(rpc).toHaveBeenCalledWith("replace_notice_legal_owner_mapping", { directory, expected_directory: original });
  });
  it("surfaces transactional conflicts", async () => {
    const error = { code: "40001", message: "Directory changed" };
    const rpc = vi.fn().mockResolvedValue({ data: null, error });
    await expect(replaceLegalOwnerDirectory({ rpc } as unknown as SupabaseClient, [], [])).rejects.toEqual(error);
    expect(isDirectoryConflict(error)).toBe(true);
  });
});