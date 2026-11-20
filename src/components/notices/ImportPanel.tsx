import { useMemo, useState } from "react";
import { Upload, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FieldDef } from "@/lib/notices/types";
import { readFileToGrid, guessMapping, missingRequired, type Grid, type Mapping, type RowIssue } from "@/lib/notices/importer";

interface Props {
  title: string;
  fields: FieldDef[];
  demoCsv?: string;
  build: (g: Grid, m: Mapping) => { count: number; issues: RowIssue[] };
}

export function ImportPanel({ title, fields, demoCsv, build }: Props) {
  const [grid, setGrid] = useState<Grid | null>(null);
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState<Mapping>({});
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ count: number; issues: RowIssue[] } | null>(null);

  const load = async (f: File) => {
    setError(null); setResult(null);
    try {
      const g = await readFileToGrid(f);
      setGrid(g); setFileName(f.name); setMapping(guessMapping(g.headers, fields));
    } catch (e) { setGrid(null); setError((e as Error).message); }
  };
  const missing = useMemo(() => missingRequired(mapping, fields), [mapping, fields]);

  return (
    <section className="rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="flex gap-2">
          {demoCsv && <Button variant="outline" size="sm" onClick={() => load(new File([demoCsv], "fictional-sample.csv"))}>Load fictional sample</Button>}
          <Button asChild size="sm">
            <label className="cursor-pointer"><Upload className="size-4" /> Upload CSV / XLSX
              <input type="file" aria-label="Upload occupancy roster" accept=".csv,.tsv,.txt,.xlsx,.xls" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ""; }} />
            </label>
          </Button>
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      {grid && (
        <div className="mt-4 space-y-4">
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><FileSpreadsheet className="size-4" />{fileName} — {grid.rows.length} rows, {grid.headers.length} columns</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {fields.map((f) => (
              <label key={f.key} className="block text-sm">
                <span className="font-medium">{f.label}{f.required && <span className="text-destructive"> *</span>}</span>
                <select
                  className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  value={mapping[f.key] ?? -1}
                  onChange={(e) => setMapping({ ...mapping, [f.key]: Number(e.target.value) })}
                >
                  <option value={-1}>— Not in file —</option>
                  {grid.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="overflow-x-auto rounded border">
            <table className="w-full text-xs">
              <thead className="bg-muted"><tr>{fields.map((f) => <th key={f.key} className="px-2 py-1 text-left">{f.label}</th>)}</tr></thead>
              <tbody>
                {grid.rows.slice(0, 3).map((r, i) => (
                  <tr key={i} className="border-t">{fields.map((f) => <td key={f.key} className="px-2 py-1">{(mapping[f.key] ?? -1) >= 0 ? String(r[mapping[f.key] ?? -1] ?? "") : "—"}</td>)}</tr>
                ))}
              </tbody>
            </table>
            <p className="px-2 py-1 text-xs text-muted-foreground">Preview of first {Math.min(3, grid.rows.length)} of {grid.rows.length} rows</p>
          </div>
          {missing.length > 0 && <p className="text-sm text-destructive">Map required fields: {missing.join(", ")}</p>}
          <Button disabled={missing.length > 0} onClick={() => setResult(build(grid, mapping))}>Add rows to list</Button>
        </div>
      )}
      {result && (
        <div className="mt-3 rounded-md bg-muted p-3 text-sm">
          Added {result.count} rows (all unselected).{result.issues.length > 0 && ` ${result.issues.length} issue(s):`}
          <ul className="mt-1 list-disc pl-5 text-xs">{result.issues.slice(0, 10).map((x, i) => <li key={i}>Row {x.row}: {x.message}</li>)}</ul>
        </div>
      )}
    </section>
  );
}
