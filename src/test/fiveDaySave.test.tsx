import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ReviewedExport } from "@/components/notices/ReviewedExport";
import { ExportSessionProvider } from "@/components/notices/ExportSession";
const mocks = vi.hoisted(() => ({ save: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/notices/exports", async (original) => ({ ...await original<typeof import("@/lib/notices/exports")>(), saveExport: mocks.save, downloadExport: mocks.download }));
vi.mock("@/components/notices/OfficePdfPreview", async () => {
  const { useEffect } = await import("react");
  return { default: ({ id, onRendered }: { id: string; onRendered: (id: string) => void }) => {
    useEffect(() => onRendered(id), [id, onRendered]); return null;
  } };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("saves the reviewed single PDF with generation time before opening Exports, without downloading", async () => {
  mocks.save.mockResolvedValue(undefined);
  const onSaved = vi.fn();
  render(<ExportSessionProvider userId="staff-a"><ReviewedExport kind="five-day" generatedAt="2026-11-20T21:21:00Z" onSaved={onSaved} tenants={["Synthetic Sam"]} notices={[{ id: "one", filename: "sam.pdf", bytes: new TextEncoder().encode("%PDF-synthetic") }]} /></ExportSessionProvider>);
  await waitFor(() => expect(screen.getByRole("button", { name: "Save notice to Exports" })).toBeEnabled());
  expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save notice to Exports" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  const record = mocks.save.mock.calls[0]?.[1] as { createdAt: string; blob: Blob; tenants: string[]; count: number };
  expect(record.createdAt).toBe("2026-11-20T21:21:00Z");
  expect(record.count).toBe(1);
  expect(record.tenants).toEqual(["Synthetic Sam"]);
  expect(record.blob.type).toBe("application/pdf");
  expect(mocks.download).not.toHaveBeenCalled();
});