import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, Stat } from "@/components/AppShell";
import { StyledSelect } from "@/components/StyledSelect";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ugx } from "@/lib/payroll";
import { downloadCsv } from "@/lib/export";

function todayInUganda() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((value) => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export const Route = createFileRoute("/_authenticated/payroll/$runId")({
  head: () => ({ meta: [{ title: "Payroll run · BMP Media Production" }] }),
  component: RunDetail,
});

function RunDetail() {
  const { runId } = Route.useParams();
  const qc = useQueryClient();
  const [slipId, setSlipId] = useState<string | null>(null);
  const [staffSearch, setStaffSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayInUganda);
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentReason, setPaymentReason] = useState("");
  const { data: isAdmin = false } = useQuery({
    queryKey: ["payroll-admin-access"],
    queryFn: async () => {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) return false;
      const { data, error } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", auth.user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
  });
  const { data: payrollAccounts = [] } = useQuery({
    queryKey: ["payroll-payment-accounts"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_account_balances")
        .select("id, name, currency")
        .eq("currency", "UGX")
        .order("name");
      if (error) throw error;
      return data;
    },
  });
  const { data } = useQuery({
    queryKey: ["run", runId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_runs")
        .select("*, payslips(*, employees(*))")
        .eq("id", runId)
        .single();
      if (error) throw error;
      return data;
    },
  });
  const markPaid = useMutation({
    mutationFn: async () => {
      if (!paymentAccountId) throw new Error("Choose the account used to pay this payroll run.");
      if (!paymentReason.trim()) throw new Error("Enter an audit reason for this payment.");
      const { error } = await supabase.rpc("post_payroll_run", {
        p_run_id: runId,
        p_financial_account_id: paymentAccountId,
        p_payment_date: paymentDate,
        p_reference: paymentReference.trim() || null,
        p_reason: paymentReason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setPayDialogOpen(false);
      setPaymentAccountId("");
      setPaymentReference("");
      setPaymentReason("");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["run", runId] }),
        qc.invalidateQueries({ queryKey: ["financial-account-balances"] }),
        qc.invalidateQueries({ queryKey: ["financial-transactions"] }),
        qc.invalidateQueries({ queryKey: ["financial-monthly-summary"] }),
        qc.invalidateQueries({ queryKey: ["financial-budget-vs-actual"] }),
        qc.invalidateQueries({ queryKey: ["financial-audit-log"] }),
        qc.invalidateQueries({ queryKey: ["accounting-account-balances"] }),
        qc.invalidateQueries({ queryKey: ["accounting-journal-summary"] }),
      ]);
      toast.success("Payroll paid and posted to the financial ledger.");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const cancelRun = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("admin_cancel_payroll_run", { p_run_id: runId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["run", runId] });
      qc.invalidateQueries({ queryKey: ["payroll-weekly-runs"] });
      qc.invalidateQueries({ queryKey: ["legacy-monthly-runs"] });
      qc.invalidateQueries({ queryKey: ["casual-payroll-runs"] });
      qc.invalidateQueries({ queryKey: ["dashboard-recent-runs"] });
      qc.invalidateQueries({ queryKey: ["payroll-reports"] });
      toast.success("Payroll run cancelled. Its record is retained for audit.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const slips = data?.payslips ?? [];
  const filteredSlips = slips.filter((item) => {
    const searchValue =
      `${item.employees?.full_name ?? ""} ${item.employees?.employee_no ?? ""} ${item.employees?.department ?? ""}`.toLowerCase();
    return (
      searchValue.includes(staffSearch.toLowerCase()) &&
      (departmentFilter === "all" || item.employees?.department === departmentFilter)
    );
  });
  const departments = [...new Set(slips.map((item) => item.employees?.department).filter(Boolean))];
  const sum = (k: "gross" | "paye" | "nssf_employee" | "nssf_employer" | "net") =>
    slips.reduce((a, s) => a + Number(s[k]), 0);
  const slip = slips.find((s) => s.id === slipId);
  const range =
    data?.period_start && data.period_end
      ? `${data.period_start} to ${data.period_end}`
      : (data?.period ?? "");

  return (
    <AppShell
      title={`Payroll ${range}`}
      actions={
        data && (
          <div className="flex gap-2">
            <button
              onClick={() =>
                downloadCsv(`bmp-payslips-${data.period_start ?? data.period}.csv`, [
                  [
                    "Employee no.",
                    "Employee",
                    "Department",
                    "Basic pay (UGX)",
                    "Allowances (UGX)",
                    "Gross (UGX)",
                    "PAYE (UGX)",
                    "Employee NSSF (UGX)",
                    "Employer NSSF (UGX)",
                    "Attendance days",
                    "Attendance hours",
                    "Overtime hours",
                    "Overtime pay (UGX)",
                    "Net pay (UGX)",
                  ],
                  ...filteredSlips.map((s) => [
                    s.employees?.employee_no,
                    s.employees?.full_name,
                    s.employees?.department,
                    s.basic_pay ?? s.employees?.base_salary,
                    s.allowances ?? s.employees?.allowances,
                    s.gross,
                    s.paye,
                    s.nssf_employee,
                    s.nssf_employer,
                    s.attendance_days,
                    s.attendance_hours,
                    s.overtime_hours,
                    s.overtime_pay,
                    s.net,
                  ]),
                ])
              }
              className="rounded-sm border px-3 py-2 text-sm font-semibold"
            >
              Export CSV
            </button>
            {isAdmin && data.status !== "cancelled" && (
              <button
                onClick={() =>
                  confirm(
                    data.status === "paid"
                      ? "Cancel this paid payroll run? This records the cancellation but does not reverse any bank or cash payments already made."
                      : "Cancel this payroll run? Its record will be retained for audit.",
                  ) && cancelRun.mutate()
                }
                disabled={cancelRun.isPending}
                className="inline-flex items-center gap-1 rounded-sm border px-3 py-2 text-sm font-semibold text-destructive disabled:opacity-50"
              >
                <X className="h-4 w-4" />
                {cancelRun.isPending ? "Cancelling…" : "Cancel run"}
              </button>
            )}
            {data.status === "cancelled" && (
              <span className="rounded-sm bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
                Cancelled
              </span>
            )}
            {data.status === "draft" && (
              <button
                onClick={() => setPayDialogOpen(true)}
                className="signage rounded-sm bg-primary px-4 py-2 text-primary-foreground"
              >
                Pay & post
              </button>
            )}
          </div>
        )
      }
    >
      {data?.run_type === "weekly" && (
        <p className="mb-4 text-sm text-muted-foreground">
          Weekly payroll is based on monthly salary rates prorated over 52 weeks. Attendance and
          approved overtime are shown for review; no attendance deductions or overtime pay are
          applied automatically.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label="Gross" value={ugx(sum("gross"))} />
        <Stat label="PAYE" value={ugx(sum("paye"))} tone="gold" />
        <Stat
          label="NSSF (5% + 10%)"
          value={ugx(sum("nssf_employee") + sum("nssf_employer"))}
          tone="pitch"
        />
        <Stat label="Net pay" value={ugx(sum("net"))} tone="crimson" />
        <Stat
          label="Attendance days"
          value={String(slips.reduce((total, item) => total + item.attendance_days, 0))}
        />
        <Stat
          label="Work hours"
          value={String(slips.reduce((total, item) => total + Number(item.attendance_hours), 0))}
        />
        <Stat
          label="Approved OT hours"
          value={String(slips.reduce((total, item) => total + Number(item.overtime_hours), 0))}
        />
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <input
          aria-label="Search payslips in payroll run"
          placeholder="Search employee or number…"
          value={staffSearch}
          onChange={(event) => setStaffSearch(event.target.value)}
          className="rounded-sm border border-input bg-card px-3 py-2 text-sm"
        />
        <StyledSelect
          ariaLabel="Filter payroll run by department"
          value={departmentFilter}
          onChange={setDepartmentFilter}
          options={[
            { value: "all", label: "All departments" },
            ...departments.map((department) => ({
              value: department ?? "",
              label: department ?? "Unassigned",
            })),
          ]}
          className="rounded-sm border border-input bg-card px-3 py-2 text-sm"
        />
      </div>
      {filteredSlips.length === 0 ? (
        <p className="mt-3 rounded-sm border bg-card p-8 text-center text-sm text-muted-foreground">
          No payslips match these filters.
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-3">
          {filteredSlips.map((item) => (
            <article key={item.id} className="rounded-sm border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{item.employees?.full_name}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {item.employees?.employee_no} · {item.employees?.department}
                  </p>
                </div>
                <button
                  onClick={() => setSlipId(item.id)}
                  className="shrink-0 rounded-sm border px-3 py-1.5 text-sm font-semibold text-primary"
                >
                  Payslip
                </button>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 border-t pt-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Gross</p>
                  <p className="mt-1 font-semibold">{ugx(item.gross)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Net pay</p>
                  <p className="mt-1 font-bold text-primary">{ugx(item.net)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">PAYE</p>
                  <p className="mt-1">{ugx(item.paye)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Employee NSSF</p>
                  <p className="mt-1">{ugx(item.nssf_employee)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Overtime pay</p>
                  <p className="mt-1">{ugx(item.overtime_pay)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Attendance</p>
                  <p className="mt-1">{item.attendance_days} days</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Work / OT hours</p>
                  <p className="mt-1">
                    {Number(item.attendance_hours).toFixed(1)} /{" "}
                    {Number(item.overtime_hours).toFixed(1)}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <Dialog open={!!slip} onOpenChange={(o) => !o && setSlipId(null)}>
        <DialogContent className="max-w-md overflow-hidden p-0">
          {slip && (
            <div id="payslip">
              <div className="diamond-lattice px-6 py-5 text-navy-foreground">
                <p className="signage text-2xl leading-none">BMP Media Production</p>
                <p className="signage text-sm text-gold">Payslip · {data?.period}</p>
              </div>
              <div className="facade-stripe" />
              <div className="space-y-4 p-6 text-sm">
                <div>
                  <p className="signage text-xl text-navy">{slip.employees?.full_name}</p>
                  <p className="text-muted-foreground">
                    {slip.employees?.position} · {slip.employees?.department} · #
                    {slip.employees?.employee_no}
                  </p>
                </div>
                <dl className="divide-y">
                  {[
                    ["Basic pay", slip.basic_pay ?? slip.employees?.base_salary],
                    ["Allowances", slip.allowances ?? slip.employees?.allowances],
                    ...(Number(slip.rate_used) > 0
                      ? [["Daily rate", slip.rate_used] as [string, number]]
                      : []),
                    ["Gross pay", slip.gross],
                    ...(Number(slip.overtime_pay) > 0
                      ? [["Overtime pay", slip.overtime_pay] as [string, number]]
                      : []),
                    ["PAYE", -slip.paye],
                    ["NSSF (5%)", -slip.nssf_employee],
                  ].map(([k, v]) => (
                    <div key={k as string} className="flex justify-between py-2">
                      <dt>{k}</dt>
                      <dd>{ugx(v as number)}</dd>
                    </div>
                  ))}
                  <div className="flex justify-between py-3 text-base font-bold">
                    <dt>Net pay</dt>
                    <dd className="text-primary">{ugx(slip.net)}</dd>
                  </div>
                </dl>
                {data?.run_type === "weekly" && (
                  <p className="text-xs text-muted-foreground">
                    Attendance: {slip.attendance_days} days ·{" "}
                    {Number(slip.attendance_hours).toFixed(2)} hours · Approved overtime:{" "}
                    {Number(slip.overtime_hours).toFixed(2)} hours
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Employer NSSF (10%): {ugx(slip.nssf_employer)} · Bank:{" "}
                  {slip.employees?.bank_name || "—"} {slip.employees?.account_no}
                </p>
                <button
                  onClick={() => window.print()}
                  className="signage w-full rounded-sm bg-navy py-2 text-navy-foreground"
                >
                  Print
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={payDialogOpen} onOpenChange={setPayDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="signage text-2xl text-navy">Pay and post payroll</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This records the net payment from a UGX account and posts gross pay, PAYE, and NSSF to
            the ledger. The operation is atomic and cannot be repeated.
          </p>
          <div className="space-y-3">
            <label className="block space-y-1 text-sm font-medium">
              UGX payment account
              <StyledSelect
                ariaLabel="Payroll payment account"
                value={paymentAccountId}
                onChange={setPaymentAccountId}
                placeholder="Choose an account"
                options={payrollAccounts.flatMap((account) =>
                  account.id
                    ? [
                        {
                          value: account.id,
                          label: `${account.name} · ${account.currency}`,
                        },
                      ]
                    : [],
                )}
                className="w-full rounded-sm border border-input bg-card px-3 py-2 text-sm"
              />
            </label>
            <label className="block space-y-1 text-sm font-medium">
              Payment date
              <input
                className="w-full rounded-sm border border-input bg-card px-3 py-2 text-sm"
                type="date"
                required
                value={paymentDate}
                onChange={(event) => setPaymentDate(event.target.value)}
              />
            </label>
            <label className="block space-y-1 text-sm font-medium">
              Bank or payment reference
              <input
                className="w-full rounded-sm border border-input bg-card px-3 py-2 text-sm"
                value={paymentReference}
                onChange={(event) => setPaymentReference(event.target.value)}
              />
            </label>
            <label className="block space-y-1 text-sm font-medium">
              Audit reason
              <input
                className="w-full rounded-sm border border-input bg-card px-3 py-2 text-sm"
                required
                value={paymentReason}
                onChange={(event) => setPaymentReason(event.target.value)}
              />
            </label>
            <button
              className="w-full rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              disabled={
                markPaid.isPending ||
                !paymentAccountId ||
                !paymentDate ||
                !paymentReason.trim()
              }
              onClick={() => markPaid.mutate()}
              type="button"
            >
              {markPaid.isPending ? "Posting…" : `Confirm payment · ${ugx(sum("net"))}`}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
