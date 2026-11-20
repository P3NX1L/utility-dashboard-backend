import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RentNoticeWorkspace } from "@/components/notices/RentNoticeWorkspace";

const csv = 'Unit,Name,Tenant Status,Amount Receivable,Delinquent Rent,Delinquent other charges\n"-> North - 1 Test St Chicago, IL 60601",,,,,\nA,"Example, Alex",Current,2100,2070,30\nB,"Zero, Pat",Current,200,0,200\n"-> South - 2 Test St Chicago, IL 60601",,,,,\n9Z,"Other, Sam",Past,110,100,10';
afterEach(cleanup);
async function prepare() {
  render(<RentNoticeWorkspace />);
  const file = new File([csv], "synthetic.csv", { type: "text/csv" });
  Object.defineProperty(file, "text", { value: async () => csv });
  fireEvent.change(screen.getByLabelText("Upload AppFolio CSV"), { target: { files: [file] } });
  await screen.findByRole("checkbox", { name: "Select Example, Alex, unit A, row 3" });
}

describe("filtered checklist selection", () => {
  it("preserves hidden selections when filtering by tenant, property and unit", async () => {
    await prepare();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Example, Alex, unit A, row 3" }));
    const search = screen.getByRole("searchbox");
    for (const query of ["Other, Sam", "South", "9Z"]) {
      fireEvent.change(search, { target: { value: query } });
      expect(screen.getAllByRole("checkbox")).toHaveLength(1);
      expect(screen.getByRole("checkbox", { name: "Select Other, Sam, unit 9Z, row 6" })).not.toBeChecked();
      expect(screen.getByRole("combobox", { name: "Review tenant" })).toHaveValue("tenant-3");
    }
    fireEvent.change(search, { target: { value: "" } });
    expect(screen.getByRole("checkbox", { name: "Select Example, Alex, unit A, row 3" })).toBeChecked();
  });
  it("bulk select and clear affect only shown eligible rows, preserving hidden selections", async () => {
    await prepare();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Other, Sam, unit 9Z, row 6" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "North" } });
    fireEvent.click(screen.getByRole("button", { name: "Select shown eligible (1)" }));
    expect(screen.getByRole("checkbox", { name: "Select Example, Alex, unit A, row 3" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Zero, Pat, unit B, row 4" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Select Zero, Pat, unit B, row 4" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Clear shown" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    expect(screen.getByRole("checkbox", { name: "Select Other, Sam, unit 9Z, row 6" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Example, Alex, unit A, row 3" })).not.toBeChecked();
  });
});