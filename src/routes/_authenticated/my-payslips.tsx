import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MonthPicker } from "@/components/MonthPicker";
import { PdfExportDialog, type PdfExportFilters } from "@/components/PdfExportDialog";
import { StyledSelect } from "@/components/StyledSelect";
import { supabase } from "@/integrations/supabase/client";
import { ugx } from "@/lib/payroll";
import type { PdfReport } from "@/lib/pdf-export";

export const Route = createFileRoute("/_authenticated/my-payslips")({
  head: () => ({ meta: [{ title: "My payslips · BMP Media Production" }] }),
  component: MyPayslips,
});

function MyPayslips() {
  const [printId, setPrintId] = useState<string | null>(null);
  const [periodFilter, setPeriodFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const { data, isLoading } = useQuery({
    queryKey: ["my-payslips"],
    queryFn: async () => {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) throw new Error("Sign in to view your payslips.");

      const { data: employee, error: employeeError } = await supabase
        .from("employees")
        .select("id, full_name, employee_no, department, position, base_salary, allowances")
        .eq("auth_user_id", auth.user.id)
        .maybeSingle();
      if (employeeError) throw employeeError;
      if (!employee) return { employee: null, payslips: [] };

      const { data: payslips, error: payslipsError } = await supabase
        .from("payslips")
        .select("*, payroll_runs(period, period_start, period_end, run_type, status)")
        .eq("employee_id", employee.id)
        .order("created_at", { ascending: false });
      if (payslipsError) throw payslipsError;
      return { employee, payslips: payslips ?? [] };
    },
  });

  const printable = data?.payslips.find(
    (payslip) => payslip.id === printId && payslip.payroll_runs?.status !== "cancelled",
  );
  const filteredPayslips =
    data?.payslips.filter((payslip) => {
      const run = payslip.payroll_runs;
      if (run?.status === "cancelled") return false;
      const period = run?.period_start?.slice(0, 7) ?? run?.period?.slice(0, 7) ?? "";
      return (
        (!periodFilter || period === periodFilter) &&
        (statusFilter === "all" || run?.status === statusFilter)
      );
    }) ?? [];
  const exportPayslips = (filters: PdfExportFilters): PdfReport => {
    const slips = (data?.payslips ?? []).filter((slip) => {
      const run = slip.payroll_runs;
      if (run?.status === "cancelled") return false;
      const period = run?.period_start?.slice(0, 7) ?? run?.period?.slice(0, 7) ?? "";
      return (
        (!filters.month || period === filters.month) &&
        (filters.status === "all" || run?.status === filters.status) &&
        (!filters.employeeIds.length || filters.employeeIds.includes(slip.employee_id))
      );
    });
    const totals = slips.reduce(
      (result, slip) => ({
        gross: result.gross + Number(slip.gross),
        paye: result.paye + Number(slip.paye),
        employeeNssf: result.employeeNssf + Number(slip.nssf_employee),
        employerNssf: result.employerNssf + Number(slip.nssf_employer),
        overtimePay: result.overtimePay + Number(slip.overtime_pay),
        net: result.net + Number(slip.net),
        attendanceDays: result.attendanceDays + Number(slip.attendance_days),
        attendanceHours: result.attendanceHours + Number(slip.attendance_hours),
        overtimeHours: result.overtimeHours + Number(slip.overtime_hours),
      }),
      {
        gross: 0,
        paye: 0,
        employeeNssf: 0,
        employerNssf: 0,
        overtimePay: 0,
        net: 0,
        attendanceDays: 0,
        attendanceHours: 0,
        overtimeHours: 0,
      },
    );
    return {
      title: "Employee payslips",
      subtitle: data?.employee
        ? `${data.employee.full_name} · ${data.employee.employee_no} · ${data.employee.position} · ${data.employee.department}`
        : "Employee payroll statements",
      orientation: "landscape",
      filters: [
        ["Payroll month", filters.month || "All months"],
        ["Status", filters.status === "all" ? "All statuses" : filters.status],
      ],
      summary: [
        ["Payslips", String(slips.length)],
        ["Gross pay", ugx(totals.gross)],
        ["Overtime pay", ugx(totals.overtimePay)],
        ["PAYE", ugx(totals.paye)],
        ["Employee NSSF", ugx(totals.employeeNssf)],
        ["Employer NSSF", ugx(totals.employerNssf)],
        [
          "Attendance",
          `${totals.attendanceDays} days · ${totals.attendanceHours.toFixed(2)} hours`,
        ],
        ["Approved overtime", `${totals.overtimeHours.toFixed(2)} hours`],
        ["Net pay", ugx(totals.net)],
      ],
      columns: [
        "Payroll period",
        "Status",
        "Basic pay (UGX)",
        "Allowances (UGX)",
        "Overtime pay (UGX)",
        "Gross pay (UGX)",
        "PAYE (UGX)",
        "Employee NSSF (UGX)",
        "Employer NSSF (UGX)",
        "Attendance days",
        "Attendance hours",
        "Overtime hours",
        "Net pay (UGX)",
      ],
      rows: slips.map((slip) => {
        const run = slip.payroll_runs;
        return [
          run?.period_start && run.period_end
            ? `${run.period_start} to ${run.period_end}`
            : (run?.period ?? "Payroll"),
          run?.status ?? "—",
          slip.basic_pay ?? data?.employee?.base_salary ?? 0,
          slip.allowances ?? data?.employee?.allowances ?? 0,
          slip.overtime_pay,
          slip.gross,
          slip.paye,
          slip.nssf_employee,
          slip.nssf_employer,
          slip.attendance_days,
          Number(slip.attendance_hours).toFixed(2),
          Number(slip.overtime_hours).toFixed(2),
          slip.net,
        ];
      }),
    };
  };

  return (
    <AppShell title="My payslips">
      <style>{`
        @media print {
          @page { size: A4; margin: 16mm; }
          body * { visibility: hidden !important; }
          .my-slip-print, .my-slip-print * { visibility: visible !important; }
          .my-slip-print {
            display: block !important; position: fixed; top: 0; left: 0; width: 100%;
            border: 1px solid #d9dfe5; padding: 12mm; color: #1a2a3a; font-family: Arial, sans-serif;
          }
        }
      `}</style>
      {isLoading && <p className="text-sm text-muted-foreground">Loading your payslips…</p>}
      {!isLoading && !data?.employee && (
        <div className="rounded-sm border-l-4 border-gold bg-accent p-5 text-sm text-accent-foreground">
          Your login is not yet linked to an employee record. Ask the BMP payroll administrator
          to link your account.
        </div>
      )}
      {data?.employee && (
        <>
          <div className="mb-5 rounded-sm border bg-card p-4">
            <p className="font-semibold">{data.employee.full_name}</p>
            <p className="text-sm text-muted-foreground">
              {data.employee.position} · {data.employee.department} · {data.employee.employee_no}
            </p>
          </div>
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 rounded-sm border bg-card px-3 py-2 text-sm">
              <span className="shrink-0 text-muted-foreground">Payroll month</span>
              <MonthPicker
                ariaLabel="Filter payslips by month"
                value={periodFilter}
                onChange={setPeriodFilter}
                className="min-w-0 flex-1"
              />
            </label>
            <StyledSelect
              aria-label="Filter payslips by status"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all", label: "All payroll statuses" },
                { value: "draft", label: "Draft" },
                { value: "paid", label: "Paid" },
              ]}
              className="rounded-sm border bg-card px-3 py-2 text-sm"
            />
          </div>
          <div className="mb-4 flex justify-end">
            <PdfExportDialog
              title="payslips"
              month
              employees={[
                {
                  id: data.employee.id,
                  label: `${data.employee.employee_no} · ${data.employee.full_name}`,
                },
              ]}
              statuses={[
                { value: "all", label: "All statuses" },
                { value: "draft", label: "Draft" },
                { value: "paid", label: "Paid" },
              ]}
              onExport={exportPayslips}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
            {filteredPayslips.map((slip) => {
              const run = slip.payroll_runs;
              const period =
                run?.period_start && run.period_end
                  ? `${run.period_start} to ${run.period_end}`
                  : (run?.period ?? "Payroll");
              return (
                <article key={slip.id} className="rounded-sm border bg-card">
                  <div className="flex items-center justify-between border-b p-4">
                    <div>
                      <h2 className="signage text-xl text-navy">{period}</h2>
                      <p className="text-xs capitalize text-muted-foreground">
                        {run?.run_type} payroll · {run?.status}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setPrintId(slip.id);
                        window.setTimeout(() => window.print(), 50);
                      }}
                      className="rounded-sm border px-3 py-1.5 text-sm font-semibold"
                    >
                      Print
                    </button>
                  </div>
                  <dl className="divide-y px-4 text-sm">
                    <PayslipRow
                      label={
                        Number(slip.rate_used) > 0
                          ? `Basic pay (${slip.attendance_days} days × ${ugx(Number(slip.rate_used))})`
                          : "Basic pay"
                      }
                      value={ugx(slip.basic_pay ?? data.employee.base_salary)}
                    />
                    {Number(slip.overtime_pay) > 0 && (
                      <PayslipRow label="Overtime pay" value={ugx(slip.overtime_pay)} />
                    )}
                    <PayslipRow
                      label="Allowances"
                      value={ugx(slip.allowances ?? data.employee.allowances)}
                    />
                    <PayslipRow label="Gross pay" value={ugx(slip.gross)} />
                    <PayslipRow label="PAYE" value={ugx(slip.paye)} />
                    <PayslipRow label="Employee NSSF" value={ugx(slip.nssf_employee)} />
                    <PayslipRow label="Employer NSSF" value={ugx(slip.nssf_employer)} />
                    <div className="flex justify-between py-3 text-base font-bold">
                      <dt>Net pay</dt>
                      <dd className="text-primary">{ugx(slip.net)}</dd>
                    </div>
                  </dl>
                  <p className="border-t px-4 py-3 text-xs text-muted-foreground">
                    Attendance: {slip.attendance_days} days ·{" "}
                    {Number(slip.attendance_hours).toFixed(2)} hours · Approved overtime:{" "}
                    {Number(slip.overtime_hours).toFixed(2)} hours
                  </p>
                  {printable?.id === slip.id && (
                    <div className="my-slip-print hidden">
                      <p className="text-sm font-bold tracking-wide">HOIMA STADIUM · PAYSLIP</p>
                      <h1 className="mt-3 text-2xl font-bold">{period}</h1>
                      <p className="mt-2">
                        {data.employee.full_name} · {data.employee.employee_no}
                      </p>
                      <p className="text-sm">
                        {data.employee.position} · {data.employee.department}
                      </p>
                      <hr className="my-5" />
                      <p>Basic pay: {ugx(slip.basic_pay ?? data.employee.base_salary)}</p>
                      {Number(slip.overtime_pay) > 0 && (
                        <p>Overtime pay: {ugx(slip.overtime_pay)}</p>
                      )}
                      <p>Allowances: {ugx(slip.allowances ?? data.employee.allowances)}</p>
                      <p>Gross pay: {ugx(slip.gross)}</p>
                      <p>PAYE: {ugx(slip.paye)}</p>
                      <p>Employee NSSF: {ugx(slip.nssf_employee)}</p>
                      <p>Employer NSSF: {ugx(slip.nssf_employer)}</p>
                      <p className="mt-3 text-lg font-bold">Net pay: {ugx(slip.net)}</p>
                      <p className="mt-5 text-sm">
                        Attendance: {slip.attendance_days} days ·{" "}
                        {Number(slip.attendance_hours).toFixed(2)} hours
                      </p>
                      <p className="text-sm">
                        Approved overtime: {Number(slip.overtime_hours).toFixed(2)} hours
                      </p>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          {filteredPayslips.length === 0 && (
            <p className="rounded-sm border bg-card p-6 text-center text-sm text-muted-foreground">
              {data.payslips.length
                ? "No payslips match these filters."
                : "Your payslips will appear here when a payroll run is completed."}
            </p>
          )}
        </>
      )}
    </AppShell>
  );
}

function PayslipRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-2">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
