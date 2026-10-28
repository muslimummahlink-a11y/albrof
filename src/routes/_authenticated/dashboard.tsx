import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, Stat } from "@/components/AppShell";
import { StyledSelect } from "@/components/StyledSelect";
import { computePayslip, ugx } from "@/lib/payroll";
import { devAuthBypass } from "@/lib/dev-auth";

function formatMoney(value: number, currency = "UGX") {
  const normalized = Number.isFinite(value) ? value : 0;
  const formatted = normalized.toLocaleString("en-UG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${formatted}`;
}

function currentMonthInUganda() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  return `${year}-${month}`;
}

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Overview · BMP Media Production" }] }),
  component: Dashboard,
});

function Dashboard() {
  const [departmentSearch, setDepartmentSearch] = useState("");
  const [runSearch, setRunSearch] = useState("");
  const [runStatus, setRunStatus] = useState("all");
  const [month] = useState(currentMonthInUganda);
  const { data: financeAccess = { canView: false } } = useQuery({
    queryKey: ["dashboard-finance-access"],
    queryFn: async () => {
      if (devAuthBypass) return { canView: true };
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) return { canView: false };
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", auth.user.id);
      if (error) throw error;
      return {
        canView: (data ?? []).some((role) => role.role === "admin" || role.role === "accountant"),
      };
    },
  });
  const canViewFinance = financeAccess.canView;

  const { data: emps = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: async () =>
      (await supabase.from("employees").select("*").order("full_name")).data ?? [],
  });
  const { data: runs = [] } = useQuery({
    queryKey: ["dashboard-recent-runs"],
    queryFn: async () =>
      (await supabase.from("payroll_runs").select("*").order("period", { ascending: false }))
        .data ?? [],
  });
  const { data: financialAccounts = [] } = useQuery({
    queryKey: ["dashboard-financial-accounts"],
    enabled: canViewFinance,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_account_balances")
        .select("*")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: financialMonthlySummary = [] } = useQuery({
    queryKey: ["dashboard-financial-monthly-summary"],
    enabled: canViewFinance,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_monthly_summary")
        .select("*")
        .eq("period_start", `${month}-01`);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: pendingEmployeeApprovals = 0 } = useQuery({
    queryKey: ["dashboard-pending-employee-approvals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_requests")
        .select("id")
        .eq("status", "pending");
      if (error) throw error;
      return data.length;
    },
  });
  const { data: pendingExpenseApprovals = 0 } = useQuery({
    queryKey: ["dashboard-pending-expense-approvals"],
    enabled: canViewFinance,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expense_requests")
        .select("id")
        .eq("status", "pending");
      if (error) throw error;
      return data.length;
    },
  });
  const {
    data: invoiceSummary = { overdue: 0, overdueByCurrency: {}, count: 0, dueByCurrency: {} },
  } = useQuery({
    queryKey: ["dashboard-invoice-summary"],
    enabled: canViewFinance,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_balances")
        .select("payment_status, balance_due, currency");
      if (error) throw error;
      const balances = data ?? [];
      const outstanding = balances.filter((invoice) =>
        ["sent", "partially_paid", "overdue"].includes(invoice.payment_status ?? ""),
      );
      const overdueInvoices = outstanding.filter((invoice) => invoice.payment_status === "overdue");
      const dueByCurrency = outstanding.reduce<Record<string, number>>((totals, invoice) => {
        totals[invoice.currency] =
          (totals[invoice.currency] ?? 0) + Number(invoice.balance_due ?? 0);
        return totals;
      }, {});
      const overdueByCurrency = overdueInvoices.reduce<Record<string, number>>(
        (totals, invoice) => {
          totals[invoice.currency] =
            (totals[invoice.currency] ?? 0) + Number(invoice.balance_due ?? 0);
          return totals;
        },
        {},
      );
      return {
        overdue: overdueInvoices.length,
        overdueByCurrency,
        count: outstanding.length,
        dueByCurrency,
      };
    },
  });

  const active = emps.filter((e) => e.status === "active");
  const totals = active.reduce(
    (a, e) => {
      const p = computePayslip(e.base_salary, e.allowances);
      return {
        gross: a.gross + p.gross,
        net: a.net + p.net,
        paye: a.paye + p.paye,
        nssf: a.nssf + p.nssf_employee + p.nssf_employer,
      };
    },
    { gross: 0, net: 0, paye: 0, nssf: 0 },
  );
  const byDept = Object.entries(
    active.reduce<Record<string, number>>(
      (a, e) => ((a[e.department] = (a[e.department] ?? 0) + 1), a),
      {},
    ),
  );

  const balanceByCurrency = financialAccounts.reduce(
    (totals, account) => {
      const balance = Number(account.current_balance ?? account.opening_balance ?? 0);
      const currency = String(account.currency ?? "UGX");
      totals[currency] = (totals[currency] ?? 0) + balance;
      return totals;
    },
    { UGX: 0, USD: 0 } as Record<string, number>,
  );

  const currentMonthFinance = financialMonthlySummary.reduce(
    (total, summary) => ({
      income: total.income + Number(summary.income_ugx ?? 0),
      expenses: total.expenses + Number(summary.expense_ugx ?? 0),
    }),
    { income: 0, expenses: 0 },
  );
  const income = currentMonthFinance.income;
  const expenses = currentMonthFinance.expenses;
  const profitability = income - expenses;
  const monthLabel = new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
    timeZone: "Africa/Kampala",
  }).format(new Date());
  const pendingApprovalCount = pendingEmployeeApprovals + pendingExpenseApprovals;

  const filteredDepartments = byDept.filter(([department]) =>
    department.toLowerCase().includes(departmentSearch.trim().toLowerCase()),
  );
  const filteredRuns = runs.filter(
    (run) =>
      run.period.toLowerCase().includes(runSearch.trim().toLowerCase()) &&
      (runStatus === "all" || run.status === runStatus),
  );
  const visibleRuns =
    runSearch.trim() || runStatus !== "all" ? filteredRuns : filteredRuns.slice(0, 6);

  return (
    <AppShell title="Overview">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-6">
        {canViewFinance ? (
          <>
            <Stat
              label="Balance (UGX)"
              value={formatMoney(balanceByCurrency["UGX"] ?? 0, "UGX")}
              tone="navy"
            />
            <Stat
              label="Balance (USD)"
              value={formatMoney(balanceByCurrency["USD"] ?? 0, "USD")}
              tone="gold"
            />
            <Stat label={`${monthLabel} income`} value={ugx(income)} tone="crimson" />
            <Stat label={`${monthLabel} expenses`} value={ugx(expenses)} tone="pitch" />
            <Stat label={`${monthLabel} net`} value={ugx(profitability)} tone="navy" />
          </>
        ) : (
          <>
            <Stat label="Active staff" value={String(active.length)} />
            <Stat label="Monthly gross" value={ugx(totals.gross)} tone="crimson" />
            <Stat label="PAYE to URA" value={ugx(totals.paye)} tone="gold" />
            <Stat label="NSSF (total)" value={ugx(totals.nssf)} tone="pitch" />
          </>
        )}
        <Stat label="Pending approvals" value={String(pendingApprovalCount)} tone="gold" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.55fr_1fr]">
        {canViewFinance ? (
          <section className="rounded-sm border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="signage text-xl text-navy">Balances by account and currency</h2>
              <span className="rounded-sm bg-secondary px-2 py-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                {financialAccounts.length} accounts
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {financialAccounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No financial accounts have been created yet. Use the Finance module to add
                  balances.
                </p>
              ) : (
                financialAccounts.map((account) => (
                  <div key={account.id} className="rounded-sm border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-foreground">{account.name}</p>
                      <span className="rounded-sm bg-secondary px-2 py-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                        {account.currency}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3 text-sm text-muted-foreground">
                      <span>{account.account_type}</span>
                      <span className="font-semibold text-foreground">
                        {formatMoney(
                          Number(account.current_balance ?? account.opening_balance ?? 0),
                          account.currency || "UGX",
                        )}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        ) : (
          <section className="rounded-sm border bg-card p-5">
            <h2 className="signage text-xl text-navy">Financial overview</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Account balances and transaction totals are restricted to finance staff.
            </p>
          </section>
        )}

        <section className="rounded-sm border bg-card p-5">
          <h2 className="signage text-xl text-navy">Operational highlights</h2>
          <div className="mt-4 space-y-3">
            {canViewFinance ? (
              <>
                <div className="rounded-sm border p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    Outstanding debts
                  </p>
                  <p className="mt-2 text-sm font-semibold text-foreground">
                    UGX{" "}
                    {formatMoney(invoiceSummary.dueByCurrency["UGX"] ?? 0, "UGX").replace(
                      "UGX ",
                      "",
                    )}
                  </p>
                  <p className="text-sm font-semibold text-foreground">
                    USD{" "}
                    {formatMoney(invoiceSummary.dueByCurrency["USD"] ?? 0, "USD").replace(
                      "USD ",
                      "",
                    )}
                  </p>
                </div>
                <div className="rounded-sm border p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    Overdue invoices
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">
                    {invoiceSummary.overdue}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    UGX{" "}
                    {formatMoney(invoiceSummary.overdueByCurrency["UGX"] ?? 0, "UGX").replace(
                      "UGX ",
                      "",
                    )}
                    {" · "}
                    USD{" "}
                    {formatMoney(invoiceSummary.overdueByCurrency["USD"] ?? 0, "USD").replace(
                      "USD ",
                      "",
                    )}
                  </p>
                </div>
              </>
            ) : (
              <p className="rounded-sm border p-3 text-sm text-muted-foreground">
                Financial highlights are restricted to finance staff.
              </p>
            )}
            <div className="rounded-sm border p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Pending approvals
              </p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{pendingApprovalCount}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {pendingApprovalCount > 0
                  ? "Review employee and expense requests."
                  : "No approval queue is currently open."}
              </p>
            </div>
          </div>
        </section>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-sm border bg-card p-5">
          <h2 className="signage text-xl text-navy">Staff by department</h2>
          <input
            aria-label="Search dashboard departments"
            placeholder="Find a department…"
            value={departmentSearch}
            onChange={(event) => setDepartmentSearch(event.target.value)}
            className="mt-3 w-full rounded-sm border border-input bg-card px-3 py-2 text-sm"
          />
          <div className="mt-4 space-y-3">
            {byDept.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No staff yet.{" "}
                <Link to="/employees" className="font-semibold text-primary">
                  Add staff
                </Link>
              </p>
            )}
            {byDept.length > 0 && filteredDepartments.length === 0 && (
              <p className="text-sm text-muted-foreground">No departments match this search.</p>
            )}
            {filteredDepartments.map(([d, n]) => (
              <div key={d}>
                <div className="flex justify-between text-sm font-semibold">
                  <span>{d}</span>
                  <span>{n}</span>
                </div>
                <div className="mt-1 h-2 rounded-sm bg-secondary">
                  <div
                    className="h-2 rounded-sm bg-primary"
                    style={{ width: `${(n / active.length) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-sm border bg-card p-5">
          <h2 className="signage text-xl text-navy">Recent payroll runs</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input
              aria-label="Search dashboard payroll runs"
              placeholder="Search payroll period…"
              value={runSearch}
              onChange={(event) => setRunSearch(event.target.value)}
              className="w-full rounded-sm border border-input bg-card px-3 py-2 text-sm"
            />
            <StyledSelect
              ariaLabel="Filter dashboard payroll runs by status"
              value={runStatus}
              onChange={setRunStatus}
              options={[
                { value: "all", label: "All run statuses" },
                { value: "draft", label: "Draft" },
                { value: "paid", label: "Paid" },
                { value: "cancelled", label: "Cancelled" },
              ]}
            />
          </div>
          {runs.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No payroll runs yet.</p>
          ) : visibleRuns.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No runs match these filters.</p>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-2">
              {visibleRuns.map((run) => (
                <Link
                  key={run.id}
                  to="/payroll/$runId"
                  params={{ runId: run.id }}
                  className="flex items-center justify-between gap-3 rounded-sm border p-3 text-sm hover:bg-secondary"
                >
                  <span className="min-w-0 truncate font-semibold">{run.period}</span>
                  <span
                    className={`shrink-0 rounded-sm px-2 py-0.5 text-xs font-bold uppercase ${run.status === "paid" ? "bg-navy text-navy-foreground" : run.status === "cancelled" ? "bg-destructive/10 text-destructive" : "bg-accent text-accent-foreground"}`}
                  >
                    {run.status}
                  </span>
                </Link>
              ))}
            </div>
          )}
          <p className="mt-4 text-sm text-muted-foreground">
            Projected net pay this month: <b className="text-foreground">{ugx(totals.net)}</b>
          </p>
        </section>
      </div>
    </AppShell>
  );
}
