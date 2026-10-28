import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { DatePicker } from "@/components/DatePicker";
import { StyledSelect } from "@/components/StyledSelect";
import { supabase } from "@/integrations/supabase/client";
import { downloadCsv } from "@/lib/export";
import {
  parseCasualPayrollCsv,
  parseCasualPayrollWorkbook,
  type CasualPayrollImportRow,
} from "@/lib/casual-payroll-import";
import { ugx } from "@/lib/payroll";

export const Route = createFileRoute("/_authenticated/casual-payroll-import")({
  head: () => ({ meta: [{ title: "Import casual payroll · BMP Media Production" }] }),
  component: CasualPayrollImport,
});

function CasualPayrollImport() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<CasualPayrollImportRow[]>([]);
  const [periodStart, setPeriodStart] = useState("2026-09-22");
  const [periodEnd, setPeriodEnd] = useState("2026-09-30");
  const [fileName, setFileName] = useState("");
  const [previewSearch, setPreviewSearch] = useState("");
  const [positionFilter, setPositionFilter] = useState("all");

  const importPayroll = useMutation({
    mutationFn: async () => {
      if (!rows.length) throw new Error("Choose and validate a casual payroll file first.");
      if (!periodStart || !periodEnd || periodEnd < periodStart) {
        throw new Error("Choose valid payroll period dates.");
      }
      const period = `${periodStart} to ${periodEnd} · Casual workers`;
      const { data, error } = await supabase.rpc("import_casual_payroll", {
        p_rows: rows,
        p_period_start: periodStart,
        p_period_end: periodEnd,
        p_period: period,
      });
      if (error) throw error;
      if (!data) throw new Error("The payroll import did not return a run ID.");
      return data;
    },
    onSuccess: (runId) => {
      toast.success(`Imported ${rows.length} casual worker payslips as a draft.`);
      navigate({ to: "/payroll/$runId", params: { runId } });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const positions = [...new Set(rows.map((row) => row.position.trim()).filter(Boolean))].sort();
  const filteredRows = rows.filter((row) => {
    const matchesSearch = `${row.employee_no} ${row.full_name} ${row.position}`
      .toLowerCase()
      .includes(previewSearch.trim().toLowerCase());
    return matchesSearch && (positionFilter === "all" || row.position === positionFilter);
  });
  const inputClass = "w-full rounded-sm border border-input bg-card px-3 py-2 text-sm";

  return (
    <AppShell title="Import casual payroll">
      <div className="mx-auto max-w-4xl space-y-5">
        <section className="rounded-sm border-l-4 border-gold bg-accent p-4 text-sm text-accent-foreground">
          This import creates or updates casual-worker staff records and saves a historical draft
          payroll run. Casual payments use days × daily rate, with no PAYE or NSSF deductions.
          Existing employees with matching employee numbers will be updated to casual-worker
          records.
        </section>

        <section className="space-y-4 rounded-sm border bg-card p-5">
          <div>
            <h2 className="signage text-xl text-navy">Choose payroll file</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Excel workbook (.xlsx), CSV or tab-separated file. The importer finds the header row
              in the first worksheet, even if a title appears above it. Required columns: No, Name,
              Position, Days, Rate and Amount. Contact is optional. When the file uses a row-number
              No column, the system assigns staff numbers CAS-2026-001, CAS-2026-002, and so on.
            </p>
          </div>
          <input
            aria-label="Choose casual payroll file"
            type="file"
            accept=".xlsx,.csv,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/tab-separated-values"
            onChange={async (event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (!file) return;
              try {
                const parsed = file.name.toLowerCase().endsWith(".xlsx")
                  ? await parseCasualPayrollWorkbook(await file.arrayBuffer())
                  : parseCasualPayrollCsv(await file.text());
                setRows(parsed);
                setFileName(file.name);
                setPreviewSearch("");
                setPositionFilter("all");
                toast.success(`Validated ${parsed.length} casual payroll rows.`);
              } catch (error) {
                setRows([]);
                setFileName("");
                setPreviewSearch("");
                setPositionFilter("all");
                toast.error(
                  error instanceof Error ? error.message : "Could not read the payroll file.",
                );
              }
            }}
            className="block w-full text-sm file:mr-3 file:rounded-sm file:border-0 file:bg-primary file:px-4 file:py-2 file:font-semibold file:text-primary-foreground"
          />
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm font-semibold">
              Period starts
              <DatePicker
                ariaLabel="Payroll period start date"
                value={periodStart}
                onChange={setPeriodStart}
                className="mt-1"
              />
            </label>
            <label className="text-sm font-semibold">
              Period ends
              <DatePicker
                ariaLabel="Payroll period end date"
                value={periodEnd}
                onChange={setPeriodEnd}
                className="mt-1"
              />
            </label>
            <button
              type="button"
              onClick={() =>
                downloadCsv("casual-payroll-template.csv", [
                  ["No", "NAME", "POSITION", "DAYS", "RATE", "AMOUNT", "CONTACT"],
                  ["1", "EXAMPLE WORKER", "CASUAL WORKER", "9", "10000", "90000", "700000000"],
                ])
              }
              className="rounded-sm border px-4 py-2 text-sm font-semibold"
            >
              Download template
            </button>
          </div>
        </section>

        {rows.length > 0 && (
          <section className="overflow-hidden rounded-sm border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
              <div>
                <h2 className="signage text-xl text-navy">Import preview</h2>
                <p className="text-sm text-muted-foreground">{fileName}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">{rows.length} worker payslips</p>
                <p className="font-bold">{ugx(total)}</p>
              </div>
            </div>
            <div className="grid gap-3 border-b p-4 sm:grid-cols-2">
              <input
                aria-label="Search imported casual workers"
                placeholder="Search employee name, number, or position…"
                value={previewSearch}
                onChange={(event) => setPreviewSearch(event.target.value)}
                className={inputClass}
              />
              <StyledSelect
                ariaLabel="Filter imported workers by position"
                value={positionFilter}
                onChange={setPositionFilter}
                options={[
                  { value: "all", label: "All positions" },
                  ...positions.map((position) => ({ value: position, label: position })),
                ]}
              />
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Showing {filteredRows.length} of {rows.length} imported workers. Totals and import
                include all validated rows.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 p-4 xl:grid-cols-3">
              {filteredRows.map((row) => (
                <article key={row.employee_no} className="rounded-sm border p-3">
                  <p className="font-semibold">{row.full_name}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {row.employee_no} · {row.position}
                  </p>
                  <p className="mt-2 text-sm">
                    {row.attendance_days} days × {ugx(row.daily_rate)}
                  </p>
                  <p className="font-bold">{ugx(row.amount)}</p>
                </article>
              ))}
              {filteredRows.length === 0 && (
                <p className="rounded-sm border p-6 text-center text-sm text-muted-foreground sm:col-span-2 xl:col-span-3">
                  No imported workers match these filters.
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4">
              <p className="text-sm text-muted-foreground">
                This saves a draft payroll. Review and mark it paid only after checking the imported
                details.
              </p>
              <button
                type="button"
                onClick={() => importPayroll.mutate()}
                disabled={importPayroll.isPending}
                className="signage rounded-sm bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
              >
                {importPayroll.isPending ? "Importing…" : "Import draft payroll"}
              </button>
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
