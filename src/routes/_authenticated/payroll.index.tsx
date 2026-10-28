import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DatePicker } from "@/components/DatePicker";
import { MonthPicker } from "@/components/MonthPicker";
import { StyledSelect } from "@/components/StyledSelect";
import { PdfExportDialog, type PdfExportFilters } from "@/components/PdfExportDialog";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import {
  computeCasualOvertimeAmount,
  computeCasualPayslip,
  computeWeeklyPayslip,
  ugx,
} from "@/lib/payroll";
import { summarizeAttendance } from "@/lib/attendance";
import type { PdfReport } from "@/lib/pdf-export";

export const Route = createFileRoute("/_authenticated/payroll/")({
  head: () => ({ meta: [{ title: "Weekly payroll · BMP Media Production" }] }),
  component: Payroll,
});

function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function mondayOf(date: Date): string {
  const monday = new Date(date);
  monday.setHours(12, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return localDate(monday);
}

function addDays(date: string, days: number): string {
  const result = new Date(`${date}T12:00:00`);
  result.setDate(result.getDate() + days);
  return localDate(result);
}

function weekLabel(start: string, end: string): string {
  return `${start} to ${end}`;
}

function Payroll() {
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [month, setMonth] = useState(() => localDate(new Date()).slice(0, 7));
  const [runSearch, setRunSearch] = useState("");
  const [runStatus, setRunStatus] = useState("all");
  const [runFromDate, setRunFromDate] = useState("");
  const [runToDate, setRunToDate] = useState("");

  const { data: runs = [] } = useQuery({
    queryKey: ["payroll-weekly-runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_runs")
        .select("*, payslips(*, employees(id, employee_no, full_name, department))")
        .eq("run_type", "weekly")
        .order("period_start", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: olderMonthlyRuns = [] } = useQuery({
    queryKey: ["legacy-monthly-runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_runs")
        .select("*, payslips(*, employees(id, employee_no, full_name, department))")
        .eq("run_type", "monthly")
        .order("period", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const { data: casualRuns = [] } = useQuery({
    queryKey: ["casual-payroll-runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_runs")
        .select("*, payslips(*, employees(id, employee_no, full_name, department))")
        .eq("run_type", "ad_hoc")
        .order("period_start", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: compilations = [] } = useQuery({
    queryKey: ["payroll-compilations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_compilations")
        .select("*, payroll_compilation_runs(run_id)")
        .order("period", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const { data: payrollEmployees = [] } = useQuery({
    queryKey: ["payroll-export-employees"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, employee_no, full_name")
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });
  const matchesRunFilters = (run: (typeof runs)[number]) => {
    const label =
      run.period_start && run.period_end ? weekLabel(run.period_start, run.period_end) : run.period;
    const periodDate = run.period_start ?? run.period.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
    return (
      label.toLowerCase().includes(runSearch.toLowerCase()) &&
      (runStatus === "all" || run.status === runStatus) &&
      (!runFromDate || (periodDate && periodDate >= runFromDate)) &&
      (!runToDate || (periodDate && periodDate <= runToDate))
    );
  };
  const filteredRuns = runs.filter(matchesRunFilters);
  const filteredMonthlyRuns = olderMonthlyRuns.filter(matchesRunFilters);
  const filteredCasualRuns = casualRuns.filter(matchesRunFilters);
  const exportPayroll = (filters: PdfExportFilters): PdfReport => {
    const allRuns = [...runs, ...olderMonthlyRuns, ...casualRuns];
    const chosenRuns = allRuns.filter((run) => {
      const start = run.period_start ?? run.period.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
      const end = run.period_end ?? start;
      return (
        (filters.status === "all" || run.status === filters.status) &&
        (!filters.fromDate || (end && end >= filters.fromDate)) &&
        (!filters.toDate || (start && start <= filters.toDate))
      );
    });
    const rows = chosenRuns.flatMap((run) =>
      run.payslips
        .filter(
          (slip) => !filters.employeeIds.length || filters.employeeIds.includes(slip.employee_id),
        )
        .map((slip) => ({
          run,
          slip,
        })),
    );
    const activeRows = rows.filter(({ run }) => run.status !== "cancelled");
    const totals = activeRows.reduce(
      (result, { slip }) => ({
        gross: result.gross + Number(slip.gross),
        paye: result.paye + Number(slip.paye),
        employeeNssf: result.employeeNssf + Number(slip.nssf_employee),
        employerNssf: result.employerNssf + Number(slip.nssf_employer),
        overtime: result.overtime + Number(slip.overtime_pay),
        net: result.net + Number(slip.net),
      }),
      { gross: 0, paye: 0, employeeNssf: 0, employerNssf: 0, overtime: 0, net: 0 },
    );
    return {
      title: "Payroll detail report",
      subtitle: "Payroll run and payslip details for the selected dates, employees, and status.",
      orientation: "landscape",
      filters: [
        ["Period", `${filters.fromDate || "Earliest"} to ${filters.toDate || "Latest"}`],
        [
          "Employees",
          filters.employeeIds.length ? `${filters.employeeIds.length} selected` : "All employees",
        ],
        ["Run status", filters.status === "all" ? "All statuses" : filters.status],
      ],
      summary: [
        ["Payslip records", String(rows.length)],
        ["Payroll runs", String(new Set(rows.map(({ run }) => run.id)).size)],
        ["Cancelled payslips", String(rows.filter(({ run }) => run.status === "cancelled").length)],
        ["Gross (non-cancelled)", ugx(totals.gross)],
        ["PAYE", ugx(totals.paye)],
        ["Employee NSSF", ugx(totals.employeeNssf)],
        ["Employer NSSF", ugx(totals.employerNssf)],
        ["Overtime pay", ugx(totals.overtime)],
        ["Net pay (non-cancelled)", ugx(totals.net)],
      ],
      columns: [
        "Payroll period",
        "Run type",
        "Run status",
        "Employee no.",
        "Employee",
        "Department",
        "Attendance days",
        "Attendance hours",
        "Basic pay (UGX)",
        "Allowances (UGX)",
        "Overtime (UGX)",
        "Gross (UGX)",
        "PAYE (UGX)",
        "Employee NSSF (UGX)",
        "Employer NSSF (UGX)",
        "Net (UGX)",
      ],
      rows: rows.map(({ run, slip }) => [
        run.period_start && run.period_end
          ? `${run.period_start} to ${run.period_end}`
          : run.period,
        run.run_type,
        run.status,
        slip.employees?.employee_no ?? "—",
        slip.employees?.full_name ?? "Unknown staff",
        slip.employees?.department ?? "—",
        slip.attendance_days,
        Number(slip.attendance_hours).toFixed(2),
        slip.basic_pay ?? 0,
        slip.allowances ?? 0,
        slip.overtime_pay,
        slip.gross,
        slip.paye,
        slip.nssf_employee,
        slip.nssf_employer,
        slip.net,
      ]),
    };
  };

  const createWeekly = useMutation({
    mutationFn: async () => {
      const weekEnd = addDays(weekStart, 6);
      const startDay = new Date(`${weekStart}T12:00:00`).getDay();
      if (!weekStart || startDay !== 1) {
        throw new Error("Choose a Monday as the start of the payroll week.");
      }

      const { data: employees, error: employeeError } = await supabase
        .from("employees")
        .select("*")
        .eq("status", "active")
        .order("full_name");
      if (employeeError) throw employeeError;
      if (!employees?.length) throw new Error("Add active staff before running payroll.");
      const workerMissingRate = employees.find(
        (employee) => employee.employment_type === "casual" && Number(employee.daily_rate) <= 0,
      );
      if (workerMissingRate) {
        throw new Error(`Set a daily rate for casual worker ${workerMissingRate.full_name} first.`);
      }

      const weekStartTimestamp = new Date(`${weekStart}T00:00:00+03:00`).toISOString();
      const weekEndExclusive = new Date(`${addDays(weekEnd, 1)}T00:00:00+03:00`).toISOString();
      const [
        { data: logs, error: attendanceError },
        { data: overtime, error: overtimeError },
        { data: overtimeEntries, error: overtimeEntriesError },
      ] = await Promise.all([
        supabase
          .from("attendance_logs")
          .select("employee_id, occurred_at, event_type")
          .is("cancelled_at", null)
          .gte("occurred_at", weekStartTimestamp)
          .lt("occurred_at", weekEndExclusive),
        supabase
          .from("employee_requests")
          .select("employee_id, hours")
          .eq("request_type", "overtime")
          .eq("status", "approved")
          .gte("start_date", weekStart)
          .lte("start_date", weekEnd),
        supabase
          .from("casual_overtime_entries")
          .select("employee_id, method, overtime_hours, hourly_rate, amount")
          .gte("work_date", weekStart)
          .lte("work_date", weekEnd),
      ]);
      if (attendanceError) throw attendanceError;
      if (overtimeError) throw overtimeError;
      if (overtimeEntriesError) throw overtimeEntriesError;

      const employeeNumbers = new Map(
        employees.map((employee) => [employee.id, employee.employee_no]),
      );
      const employeeIds = new Map(employees.map((employee) => [employee.employee_no, employee.id]));
      const attendance = summarizeAttendance(
        (logs ?? []).flatMap((log) => {
          const employee_no = employeeNumbers.get(log.employee_id);
          return employee_no ? [{ ...log, employee_no }] : [];
        }),
        employeeIds,
      );
      const overtimeByEmployee = new Map<string, number>();
      const overtimePayByEmployee = new Map<string, number>();
      for (const request of overtime ?? []) {
        overtimeByEmployee.set(
          request.employee_id,
          (overtimeByEmployee.get(request.employee_id) ?? 0) + Number(request.hours ?? 0),
        );
      }
      for (const entry of overtimeEntries ?? []) {
        const amount = computeCasualOvertimeAmount({
          method: entry.method as "direct_amount" | "hours_rate" | "special_day_bonus",
          amount: entry.amount ?? undefined,
          hours: entry.overtime_hours ?? undefined,
          hourlyRate: entry.hourly_rate ?? undefined,
        });
        overtimePayByEmployee.set(
          entry.employee_id,
          (overtimePayByEmployee.get(entry.employee_id) ?? 0) + amount,
        );
        if (entry.overtime_hours) {
          overtimeByEmployee.set(
            entry.employee_id,
            (overtimeByEmployee.get(entry.employee_id) ?? 0) + Number(entry.overtime_hours),
          );
        }
      }

      const label = weekLabel(weekStart, weekEnd);
      const { data: run, error: runError } = await supabase
        .from("payroll_runs")
        .insert({
          period: label,
          period_start: weekStart,
          period_end: weekEnd,
          run_type: "weekly",
        })
        .select()
        .single();
      if (runError) {
        throw new Error(
          runError.code === "23505"
            ? "A payroll run already exists for this week."
            : runError.message,
        );
      }

      const slips = employees.map((employee) => {
        const attendanceSummary = attendance.get(employee.id);
        const attendanceDays = attendanceSummary?.attendance_days ?? 0;
        const overtimePay = overtimePayByEmployee.get(employee.id) ?? 0;
        const pay =
          employee.employment_type === "casual"
            ? computeCasualPayslip(Number(employee.daily_rate), attendanceDays, overtimePay)
            : computeWeeklyPayslip(employee.base_salary, employee.allowances);
        return {
          run_id: run.id,
          employee_id: employee.id,
          ...pay,
          attendance_days: attendanceDays,
          attendance_hours: attendanceSummary?.attendance_hours ?? 0,
          overtime_hours: overtimeByEmployee.get(employee.id) ?? 0,
          overtime_pay: overtimePay,
          rate_used: employee.employment_type === "casual" ? employee.daily_rate : null,
        };
      });

      const { error: payslipError } = await supabase.from("payslips").insert(slips);
      if (payslipError) {
        const { error: cleanupError } = await supabase
          .from("payroll_runs")
          .delete()
          .eq("id", run.id);
        if (cleanupError) {
          throw new Error(
            `Payslips could not be saved: ${payslipError.message}. The empty payroll run also could not be removed: ${cleanupError.message}.`,
          );
        }
        throw new Error(`Payslips could not be saved: ${payslipError.message}`);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll-weekly-runs"] });
      qc.invalidateQueries({ queryKey: ["dashboard-recent-runs"] });
      qc.invalidateQueries({ queryKey: ["payroll-compilations"] });
      toast.success("Weekly payroll run created");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const compileMonth = useMutation({
    mutationFn: async () => {
      if (!month) throw new Error("Choose a month to compile.");
      const firstDay = `${month}-01`;
      const nextMonth = new Date(`${firstDay}T12:00:00`);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      const nextMonthStart = localDate(nextMonth);
      if (nextMonthStart > localDate(new Date())) {
        throw new Error("Compile a month-end summary after the month has ended.");
      }
      const [{ data: monthRuns, error: runsError }, { data: existing, error: compilationError }] =
        await Promise.all([
          supabase
            .from("payroll_runs")
            .select("id, period")
            .eq("run_type", "weekly")
            .neq("status", "cancelled")
            .gte("period_end", firstDay)
            .lt("period_end", nextMonthStart),
          supabase.from("payroll_compilations").select("id").eq("period", month).maybeSingle(),
        ]);
      if (runsError) throw runsError;
      if (compilationError) throw compilationError;
      if (existing) throw new Error(`Payroll for ${month} has already been compiled.`);
      if (!monthRuns?.length)
        throw new Error("There are no weekly payroll runs to compile for this month.");

      const alreadyCompiled = new Set(
        compilations.flatMap((compilation) =>
          compilation.payroll_compilation_runs.map((link) => link.run_id),
        ),
      );
      const eligibleRuns = monthRuns.filter((run) => !alreadyCompiled.has(run.id));
      if (eligibleRuns.length !== monthRuns.length) {
        throw new Error(
          "One or more weekly runs have already been included in another monthly compilation.",
        );
      }

      const { data: compilation, error: createError } = await supabase
        .from("payroll_compilations")
        .insert({ period: month })
        .select()
        .single();
      if (createError) {
        throw new Error(
          createError.code === "23505"
            ? `Payroll for ${month} has already been compiled.`
            : createError.message,
        );
      }

      const { error: linkError } = await supabase
        .from("payroll_compilation_runs")
        .insert(eligibleRuns.map((run) => ({ compilation_id: compilation.id, run_id: run.id })));
      if (linkError) {
        const { error: cleanupError } = await supabase
          .from("payroll_compilations")
          .delete()
          .eq("id", compilation.id);
        if (cleanupError) {
          throw new Error(
            `Weekly runs could not be compiled: ${linkError.message}. The empty compilation could not be removed: ${cleanupError.message}.`,
          );
        }
        throw new Error(`Weekly runs could not be compiled: ${linkError.message}`);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll-compilations"] });
      toast.success("Monthly payroll summary compiled");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <AppShell title="Weekly payroll">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Create weekly salaried payroll, compile month-end totals, or import casual-worker pay.
        </p>
        <div className="flex flex-wrap gap-2">
          <PdfExportDialog
            title="payroll"
            dateRange
            employees={payrollEmployees.map((employee) => ({
              id: employee.id,
              label: `${employee.employee_no} · ${employee.full_name}`,
            }))}
            statuses={[
              { value: "all", label: "All statuses" },
              { value: "draft", label: "Draft" },
              { value: "paid", label: "Paid" },
              { value: "cancelled", label: "Cancelled" },
            ]}
            onExport={exportPayroll}
          />
          <Link
            to="/casual-payroll-import"
            className="rounded-sm border bg-card px-4 py-2 text-sm font-semibold hover:bg-secondary"
          >
            Import casual payroll
          </Link>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-sm border bg-card p-5">
          <h2 className="signage text-xl text-navy">Create a weekly payroll run</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Runs cover Monday to Sunday. Attendance and approved overtime are shown on each payslip;
            attendance is not used to make automatic deductions.
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-sm font-semibold">
              Week starts (Monday)
              <DatePicker
                value={weekStart}
                onChange={setWeekStart}
                ariaLabel="Week starts Monday"
                className="mt-1"
              />
            </label>
            <button
              onClick={() => createWeekly.mutate()}
              disabled={createWeekly.isPending}
              className="signage rounded-sm bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
            >
              {createWeekly.isPending ? "Creating…" : "Run weekly payroll"}
            </button>
          </div>
          {weekStart && (
            <p className="mt-3 text-sm text-muted-foreground">
              Payroll period: {weekLabel(weekStart, addDays(weekStart, 6))}
            </p>
          )}
        </section>

        <section className="rounded-sm border bg-card p-5">
          <h2 className="signage text-xl text-navy">Compile month-end summary</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            After the month ends, compile the weekly runs ending in that month into one summary.
            Each weekly run can only be included once.
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-sm font-semibold">
              Payroll month
              <MonthPicker
                ariaLabel="Payroll month"
                value={month}
                onChange={setMonth}
                className="mt-1"
              />
            </label>
            <button
              onClick={() => compileMonth.mutate()}
              disabled={compileMonth.isPending || month >= localDate(new Date()).slice(0, 7)}
              className="signage rounded-sm bg-navy px-4 py-2 text-navy-foreground disabled:opacity-60"
            >
              {compileMonth.isPending ? "Compiling…" : "Compile month"}
            </button>
          </div>
          {compilations.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {compilations.map((compilation) => (
                <li key={compilation.id} className="flex justify-between border-t pt-2">
                  <span>
                    {compilation.period} · {compilation.payroll_compilation_runs.length} weekly runs
                  </span>
                  <span className="font-semibold text-primary">Compiled</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="mb-3 mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <input
          aria-label="Search payroll runs"
          placeholder="Search payroll period…"
          value={runSearch}
          onChange={(event) => setRunSearch(event.target.value)}
          className="rounded-sm border border-input bg-card px-3 py-2 text-sm"
        />
        <StyledSelect
          aria-label="Filter payroll runs by status"
          value={runStatus}
          onChange={setRunStatus}
          options={[
            { value: "all", label: "All run statuses" },
            { value: "draft", label: "Draft" },
            { value: "paid", label: "Paid" },
            { value: "cancelled", label: "Cancelled" },
          ]}
          className="rounded-sm border border-input bg-card px-3 py-2 text-sm"
        />
        <DatePicker
          ariaLabel="Filter payroll runs from date"
          placeholder="Runs from date"
          value={runFromDate}
          onChange={setRunFromDate}
          clearable
        />
        <DatePicker
          ariaLabel="Filter payroll runs to date"
          placeholder="Runs to date"
          value={runToDate}
          onChange={setRunToDate}
          clearable
        />
      </div>
      <h2 className="signage mb-3 text-xl text-navy">Weekly runs</h2>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        {filteredRuns.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {runs.length ? "No weekly runs match these filters." : "No weekly runs yet."}
          </p>
        )}
        {filteredRuns.map((run) => {
          const net = run.payslips.reduce((total, payslip) => total + Number(payslip.net), 0);
          const attendanceDays = run.payslips.reduce(
            (total, payslip) => total + Number(payslip.attendance_days),
            0,
          );
          return (
            <Link
              key={run.id}
              to="/payroll/$runId"
              params={{ runId: run.id }}
              className="overflow-hidden rounded-sm border bg-card transition hover:shadow-lg"
            >
              <div className="diamond-lattice h-4" />
              <div className="p-5">
                <div className="flex items-center justify-between gap-2">
                  <p className="signage text-xl text-navy">
                    {run.period_start && run.period_end
                      ? weekLabel(run.period_start, run.period_end)
                      : run.period}
                  </p>
                  <span className="rounded-sm bg-secondary px-2 py-0.5 text-xs font-bold uppercase">
                    {run.status}
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {run.payslips.length} payslips · {attendanceDays} total attendance days
                </p>
                <p className="mt-1 font-semibold">Net pay: {ugx(net)}</p>
              </div>
            </Link>
          );
        })}
      </div>
      {filteredMonthlyRuns.length > 0 && (
        <>
          <h2 className="signage mb-3 mt-8 text-xl text-navy">Earlier monthly runs</h2>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
            {filteredMonthlyRuns.map((run) => {
              const net = run.payslips.reduce((total, payslip) => total + Number(payslip.net), 0);
              return (
                <Link
                  key={run.id}
                  to="/payroll/$runId"
                  params={{ runId: run.id }}
                  className="rounded-sm border bg-card p-5 hover:shadow-lg"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="signage text-2xl text-navy">{run.period}</p>
                    <span className="rounded-sm bg-secondary px-2 py-0.5 text-xs font-bold uppercase">
                      {run.status}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {run.payslips.length} payslips
                  </p>
                  <p className="mt-1 font-semibold">Net: {ugx(net)}</p>
                </Link>
              );
            })}
          </div>
        </>
      )}
      <h2 className="signage mb-3 mt-8 text-xl text-navy">Casual and one-off runs</h2>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        {filteredCasualRuns.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {casualRuns.length ? "No casual runs match these filters." : "No casual runs yet."}
          </p>
        ) : (
          filteredCasualRuns.map((run) => {
            const gross = run.payslips.reduce((total, payslip) => total + Number(payslip.gross), 0);
            const net = run.payslips.reduce((total, payslip) => total + Number(payslip.net), 0);
            const overtime = run.payslips.reduce(
              (total, payslip) => total + Number(payslip.overtime_pay),
              0,
            );
            return (
              <Link
                key={run.id}
                to="/payroll/$runId"
                params={{ runId: run.id }}
                className="rounded-sm border bg-card p-5 hover:shadow-lg"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="signage text-xl text-navy">{run.period}</p>
                  <span className="rounded-sm bg-secondary px-2 py-0.5 text-xs font-bold uppercase">
                    {run.status}
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {run.payslips.length} payslips · Casual
                </p>
                <p className="mt-1 text-sm">Gross: {ugx(gross)}</p>
                <p className="font-semibold">Net: {ugx(net)}</p>
                {overtime > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">Overtime: {ugx(overtime)}</p>
                )}
              </Link>
            );
          })
        )}
      </div>
    </AppShell>
  );
}
