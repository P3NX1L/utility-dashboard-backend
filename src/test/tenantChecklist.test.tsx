import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RentNoticeWorkspace } from "@/components/notices/RentNoticeWorkspace";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
const csv = 'Unit,Name,Tenant Status,Amount Receivable,Delinquent Rent,Delinquent other charges\n"-> North - 1 Test St Chicago, IL 60601",,,,,\nA,"Example, Alex",Current,2100,2070,30\nB,"Zero, Pat",Current,200,0,200\n"-> South - 2 Test St Chicago, IL 60601",,,,,\n9Z,"Other, Sam",Past,110,100,10';
afterEach(cleanup);
async function prepare() {
  render(<RentNoticeWorkspace />);
  const file = new File([csv], "synthetic.csv", { type: "text/csv" });
  Object.defineProperty(file, "text", { value: async () => csv });
  fireEvent.change(screen.getByLabelText("Upload AppFolio CSV"), { target: { files: [file] } });
  await screen.findByRole("radio", { name: "Select Example, Alex, unit A, row 3" });
}

describe("filtered checklist selection", () => {
  it("preserves hidden selections when filtering by tenant, property and unit", async () => {
    await prepare();
    fireEvent.click(screen.getByRole("radio", { name: "Select Example, Alex, unit A, row 3" }));
    const search = screen.getByRole("searchbox");
    for (const query of ["Other, Sam", "South", "9Z"]) {
      fireEvent.change(search, { target: { value: query } });
      expect(screen.getAllByRole("radio")).toHaveLength(1);
      expect(screen.getByRole("radio", { name: "Select Other, Sam, unit 9Z, row 6" })).not.toBeChecked();
      expect(screen.getByRole("combobox", { name: "Review tenant" })).toHaveValue("tenant-3");
    }
    fireEvent.change(search, { target: { value: "" } });
    expect(screen.getByRole("radio", { name: "Select Example, Alex, unit A, row 3" })).toBeChecked();
  });
  it("replaces the prior selection across properties and filters and excludes zero rent", async () => {
    await prepare();
    fireEvent.click(screen.getByRole("radio", { name: "Select Example, Alex, unit A, row 3" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "South" } });
    fireEvent.click(screen.getByRole("radio", { name: "Select Other, Sam, unit 9Z, row 6" }));
    expect(screen.getByRole("combobox", { name: "Review tenant" })).toHaveValue("tenant-6");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    expect(screen.getByRole("radio", { name: "Select Example, Alex, unit A, row 3" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Select Other, Sam, unit 9Z, row 6" })).toBeChecked();
    expect(screen.getAllByRole("radio").filter((r) => r.getAttribute("aria-checked") === "true")).toHaveLength(1);
    const zero = screen.getByRole("radio", { name: "Select Zero, Pat, unit B, row 4" });
    expect(zero).toBeDisabled();
    fireEvent.click(zero);
    expect(zero).not.toBeChecked();
  });
});
