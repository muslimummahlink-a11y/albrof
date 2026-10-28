import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MonthPicker } from "@/components/MonthPicker";
import { PdfExportDialog, type PdfExportFilters } from "@/components/PdfExportDialog";
import { StyledSelect } from "@/components/StyledSelect";
import { supabase } from "@/integrations/supabase/client";
import { downloadCsv } from "@/lib/export";
import { ugx } from "@/lib/payroll";
import type { PdfReport } from "@/lib/pdf-export";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Payroll reports · BMP Media Production" }] }),
  component: Reports,
});

function Reports() {
  const [periodFilter, setPeriodFilter] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const { data: compilations = [], isLoading } = useQuery({
    queryKey: ["payroll-reports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_compilations")
        .select(
          "*, payroll_compilation_runs(run_id, payroll_runs(period, period_start, period_end, status, payslips(*, employees(employee_no, full_name, department))))",
        )
        .order("period", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const filteredCompilations = compilations.filter((compilation) =>
    !periodFilter ? true : compilation.period === periodFilter,
  );
  const reportDepartments = [
    ...new Set(
      compilations.flatMap((compilation) =>
        compilation.payroll_compilation_runs.flatMap((link) =>
          link.payroll_runs?.status !== "cancelled"
            ? (link.payroll_runs?.payslips
                .map((payslip) => payslip.employees?.department)
                .filter((department): department is string => Boolean(department)) ?? [])
            : [],
        ),
      ),
    ),
  ].sort();
  const reportEmployees = new Map<string, string>();
  for (const compilation of compilations) {
    for (const link of compilation.payroll_compilation_runs) {
      const run = link.payroll_runs;
      if (!run || run.status === "cancelled") continue;
      for (const payslip of run.payslips) {
        const employee = payslip.employees;
        if (employee) {
          reportEmployees.set(
            payslip.employee_id,
            `${employee.employee_no} · ${employee.full_name}`,
          );
        }
      }
    }
  }
  const exportReports = (filters: PdfExportFilters): PdfReport => {
    const summaries = new Map<
      string,
      {
        period: string;
        employee_no: string;
        full_name: string;
        department: string;
        weeks: number;
        gross: number;
        paye: number;
        nssf: number;
        attendanceDays: number;
        attendanceHours: number;
        overtimeHours: number;
        net: number;
      }
    >();
    const runIds = new Set<string>();
    for (const compilation of compilations) {
      if (filters.month && compilation.period !== filters.month) continue;
      for (const link of compilation.payroll_compilation_runs) {
        const run = link.payroll_runs;
        if (!run || run.status === "cancelled") continue;
        for (const payslip of run.payslips) {
          const employee = payslip.employees;
          if (
            !employee ||
            (filters.employeeIds.length && !filters.employeeIds.includes(payslip.employee_id)) ||
            (filters.department !== "all" && employee.department !== filters.department)
          ) {
            continue;
          }
          runIds.add(run.id);
          const key = `${compilation.period}:${payslip.employee_id}`;
          const row = summaries.get(key) ?? {
            period: compilation.period,
            employee_no: employee.employee_no,
            full_name: employee.full_name,
            department: employee.department,
            weeks: 0,
            gross: 0,
            paye: 0,
            nssf: 0,
            attendanceDays: 0,
            attendanceHours: 0,
            overtimeHours: 0,
            net: 0,
          };
          row.weeks += 1;
          row.gross += Number(payslip.gross);
          row.paye += Number(payslip.paye);
          row.nssf += Number(payslip.nssf_employee);
          row.attendanceDays += Number(payslip.attendance_days);
          row.attendanceHours += Number(payslip.attendance_hours);
          row.overtimeHours += Number(payslip.overtime_hours);
          row.net += Number(payslip.net);
          summaries.set(key, row);
        }
      }
    }
    const rows = [...summaries.values()].sort(
      (a, b) => a.period.localeCompare(b.period) || a.full_name.localeCompare(b.full_name),
    );
    const totals = rows.reduce(
      (result, row) => ({
        gross: result.gross + row.gross,
        paye: result.paye + row.paye,
        nssf: result.nssf + row.nssf,
        attendanceDays: result.attendanceDays + row.attendanceDays,
        attendanceHours: result.attendanceHours + row.attendanceHours,
        overtimeHours: result.overtimeHours + row.overtimeHours,
        net: result.net + row.net,
      }),
      {
        gross: 0,
        paye: 0,
        nssf: 0,
        attendanceDays: 0,
        attendanceHours: 0,
        overtimeHours: 0,
        net: 0,
      },
    );
    return {
      title: "Monthly payroll summary report",
      subtitle: "Compiled weekly payroll runs, excluding cancelled payroll runs.",
      orientation: "landscape",
      filters: [
        ["Payroll month", filters.month || "All compiled months"],
        [
          "Employees",
          filters.employeeIds.length ? `${filters.employeeIds.length} selected` : "All employees",
        ],
        ["Department", filters.department === "all" ? "All departments" : filters.department],
      ],
      summary: [
        ["Compiled months", String(new Set(rows.map((row) => row.period)).size)],
        ["Weekly runs included", String(runIds.size)],
        ["Employee-month rows", String(rows.length)],
        ["Gross pay", ugx(totals.gross)],
        ["PAYE", ugx(totals.paye)],
        ["Employee NSSF", ugx(totals.nssf)],
        ["Attendance days", String(totals.attendanceDays)],
        ["Attendance hours", totals.attendanceHours.toFixed(2)],
        ["Overtime hours", totals.overtimeHours.toFixed(2)],
        ["Net pay", ugx(totals.net)],
      ],
      columns: [
        "Month",
        "Employee no.",
        "Employee",
        "Department",
        "Weekly runs",
        "Gross pay (UGX)",
        "PAYE (UGX)",
        "Employee NSSF (UGX)",
        "Attendance days",
        "Attendance hours",
        "Overtime hours",
        "Net pay (UGX)",
      ],
      rows: rows.map((row) => [
        row.period,
        row.employee_no,
        row.full_name,
        row.department,
        row.weeks,
        row.gross,
        row.paye,
        row.nssf,
        row.attendanceDays,
        row.attendanceHours.toFixed(2),
        row.overtimeHours.toFixed(2),
        row.net,
      ]),
    };
  };

  return (
    <AppShell title="Payroll reports">
      <div className="rounded-sm border-l-4 border-primary bg-secondary/50 p-4 text-sm">
        Monthly reports combine weekly payroll runs by the week-ending date. Compile a month-end
        summary from the Payroll page before exporting it here.
      </div>
      <div className="mt-4 flex justify-end">
        <PdfExportDialog
          title="payroll reports"
          month
          employees={[...reportEmployees].map(([id, label]) => ({ id, label }))}
          departments={reportDepartments}
          onExport={exportReports}
        />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div className="flex items-center gap-2 rounded-sm border bg-card px-3 py-2 text-sm">
          <span className="shrink-0 text-muted-foreground">Payroll month</span>
          <MonthPicker
            ariaLabel="Filter reports by month"
            value={periodFilter}
            onChange={setPeriodFilter}
            className="min-w-0 flex-1"
          />
        </div>
        <input
          aria-label="Search report employees"
          placeholder="Search employees in reports…"
          value={employeeSearch}
          onChange={(event) => setEmployeeSearch(event.target.value)}
          className="rounded-sm border bg-card px-3 py-2 text-sm"
        />
        <StyledSelect
          aria-label="Filter reports by department"
          value={departmentFilter}
          onChange={setDepartmentFilter}
          options={[
            { value: "all", label: "All departments" },
            ...reportDepartments.map((department) => ({ value: department, label: department })),
          ]}
        />
      </div>
      {isLoading && <p className="mt-5 text-sm text-muted-foreground">Loading reports…</p>}
      {!isLoading && filteredCompilations.length === 0 && (
        <p className="mt-5 rounded-sm border bg-card p-6 text-center text-sm text-muted-foreground">
          No monthly summaries match these filters.
        </p>
      )}
      <div className="mt-5 space-y-5">
        {filteredCompilations.map((compilation) => {
          const employees = new Map<
            string,
            {
              employee_no: string;
              full_name: string;
              department: string;
              gross: number;
              paye: number;
              nssf: number;
              net: number;
              attendanceDays: number;
              attendanceHours: number;
              overtimeHours: number;
              weeks: number;
            }
          >();
          let runCount = 0;

          for (const link of compilation.payroll_compilation_runs) {
            const run = link.payroll_runs;
            if (!run || run.status === "cancelled") continue;
            runCount += 1;
            for (const payslip of run.payslips) {
              const employee = payslip.employees;
              if (!employee) continue;
              const summary = employees.get(payslip.employee_id) ?? {
                employee_no: employee.employee_no,
                full_name: employee.full_name,
                department: employee.department,
                gross: 0,
                paye: 0,
                nssf: 0,
                net: 0,
                attendanceDays: 0,
                attendanceHours: 0,
                overtimeHours: 0,
                weeks: 0,
              };
              summary.gross += Number(payslip.gross);
              summary.paye += Number(payslip.paye);
              summary.nssf += Number(payslip.nssf_employee);
              summary.net += Number(payslip.net);
              summary.attendanceDays += Number(payslip.attendance_days);
              summary.attendanceHours += Number(payslip.attendance_hours);
              summary.overtimeHours += Number(payslip.overtime_hours);
              summary.weeks += 1;
              employees.set(payslip.employee_id, summary);
            }
          }

          const employeeRows = [...employees.values()].sort((a, b) =>
            a.full_name.localeCompare(b.full_name),
          );
          const filteredEmployees = employeeRows.filter(
            (row) =>
              `${row.full_name} ${row.employee_no} ${row.department}`
                .toLowerCase()
                .includes(employeeSearch.trim().toLowerCase()) &&
              (departmentFilter === "all" || row.department === departmentFilter),
          );
          const filteredTotals = filteredEmployees.reduce(
            (sum, row) => ({
              gross: sum.gross + row.gross,
              paye: sum.paye + row.paye,
              nssf: sum.nssf + row.nssf,
              net: sum.net + row.net,
              attendanceDays: sum.attendanceDays + row.attendanceDays,
              attendanceHours: sum.attendanceHours + row.attendanceHours,
              overtimeHours: sum.overtimeHours + row.overtimeHours,
            }),
            {
              gross: 0,
              paye: 0,
              nssf: 0,
              net: 0,
              attendanceDays: 0,
              attendanceHours: 0,
              overtimeHours: 0,
            },
          );
          return (
            <section key={compilation.id} className="overflow-hidden rounded-sm border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
                <div>
                  <h2 className="signage text-2xl text-navy">
                    {compilation.period} monthly summary
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {runCount} weekly payroll runs · Compiled{" "}
                    {new Date(compilation.created_at).toLocaleDateString("en-UG")}
                  </p>
                </div>
                <button
                  onClick={() =>
                    downloadCsv(`bmp-payroll-report-${compilation.period}.csv`, [
                      [
                        "Employee no.",
                        "Employee",
                        "Department",
                        "Weekly runs",
                        "Gross pay (UGX)",
                        "PAYE (UGX)",
                        "Employee NSSF (UGX)",
                        "Attendance days",
                        "Attendance hours",
                        "Approved overtime hours",
                        "Net pay (UGX)",
                      ],
                      ...filteredEmployees.map((row) => [
                        row.employee_no,
                        row.full_name,
                        row.department,
                        row.weeks,
                        row.gross,
                        row.paye,
                        row.nssf,
                        row.attendanceDays,
                        row.attendanceHours,
                        row.overtimeHours,
                        row.net,
                      ]),
                      [
                        "",
                        "TOTAL",
                        "",
                        "",
                        filteredTotals.gross,
                        filteredTotals.paye,
                        filteredTotals.nssf,
                        filteredTotals.attendanceDays,
                        filteredTotals.attendanceHours,
                        filteredTotals.overtimeHours,
                        filteredTotals.net,
                      ],
                    ])
                  }
                  className="rounded-sm border px-4 py-2 text-sm font-semibold"
                >
                  Export monthly CSV
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 border-b p-3 sm:p-5 lg:grid-cols-4">
                <Summary label="Gross pay" value={ugx(filteredTotals.gross)} />
                <Summary label="PAYE" value={ugx(filteredTotals.paye)} />
                <Summary label="Employee NSSF" value={ugx(filteredTotals.nssf)} />
                <Summary label="Net pay" value={ugx(filteredTotals.net)} />
                <Summary
                  label="Attendance / overtime hours"
                  value={`${filteredTotals.attendanceHours.toFixed(1)} / ${filteredTotals.overtimeHours.toFixed(1)}`}
                />
              </div>
              {filteredEmployees.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  No employees match this search.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-3 p-4 xl:grid-cols-3">
                  {filteredEmployees.map((row) => (
                    <article key={row.employee_no} className="rounded-sm border p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{row.full_name}</p>
                          <p className="font-mono text-xs text-muted-foreground">
                            {row.employee_no} · {row.department}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-sm bg-secondary px-2 py-1 text-xs font-semibold">
                          {row.weeks} weeks
                        </span>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3 border-t pt-3 text-sm">
                        <Summary label="Gross" value={ugx(row.gross)} />
                        <Summary label="Net" value={ugx(row.net)} />
                        <Summary label="PAYE" value={ugx(row.paye)} />
                        <Summary label="NSSF" value={ugx(row.nssf)} />
                        <Summary
                          label="Attendance"
                          value={`${row.attendanceDays} days · ${row.attendanceHours.toFixed(1)} h`}
                        />
                        <Summary label="Overtime" value={`${row.overtimeHours.toFixed(1)} h`} />
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </AppShell>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-bold text-navy">{value}</p>
    </div>
  );
}
