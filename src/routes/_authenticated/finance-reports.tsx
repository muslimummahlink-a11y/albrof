import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { StyledSelect } from "@/components/StyledSelect";
import { supabase } from "@/integrations/supabase/client";
import { devAuthBypass } from "@/lib/dev-auth";
import { downloadCsv } from "@/lib/export";
import type { Tables } from "@/integrations/supabase/types";

type Currency = "UGX" | "USD";
type BudgetActual = Tables<"financial_budget_vs_actual">;
type MonthlySummary = Tables<"financial_monthly_summary">;
type ProjectProfitability = Tables<"financial_project_profitability">;
type Commitment = Tables<"financial_upcoming_commitments">;
type ReceivableAging = Tables<"financial_receivables_aging">;
type PayableAging = Tables<"financial_payables_aging">;
type CashFlowItem = Tables<"financial_cash_flow_forecast">;

const currencies: Array<{ value: Currency; label: string }> = [
  { value: "UGX", label: "UGX" },
  { value: "USD", label: "USD" },
];

function currentMonth() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}`;
}

function money(amount: number | null | undefined, currency = "UGX") {
  return `${currency} ${Number(amount ?? 0).toLocaleString("en-UG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export const Route = createFileRoute("/_authenticated/finance-reports")({
  head: () => ({ meta: [{ title: "Finance reports & budgets · BMP Media Production" }] }),
  component: FinanceReports,
});

function FinanceReports() {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState(currentMonth);
  const [currency, setCurrency] = useState<Currency | "all">("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [budgetCategory, setBudgetCategory] = useState("");
  const [budgetProject, setBudgetProject] = useState("");
  const [budgetCurrency, setBudgetCurrency] = useState<Currency>("UGX");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [budgetNotes, setBudgetNotes] = useState("");
  const inputClass =
    "w-full rounded-sm border border-input bg-card px-3 py-2 text-sm text-foreground";

  const accessQuery = useQuery({
    queryKey: ["finance-report-access"],
    queryFn: async () => {
      if (devAuthBypass) return { canView: true };
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) return { canView: false };
      const { data: roles, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", auth.user.id);
      if (error) throw error;
      return {
        canView: (roles ?? []).some((role) => role.role === "admin" || role.role === "accountant"),
      };
    },
  });
  const canLoad = accessQuery.data?.canView === true;
  const budgetsQuery = useQuery({
    queryKey: ["financial-budget-vs-actual"],
    enabled: canLoad,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_budget_vs_actual")
        .select("*")
        .order("period_start", { ascending: false });
      if (error) throw error;
      return data as BudgetActual[];
    },
  });
  const monthlyQuery = useQuery({
    queryKey: ["financial-monthly-summary"],
    enabled: canLoad,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_monthly_summary")
        .select("*")
        .order("period_start", { ascending: false });
      if (error) throw error;
      return data as MonthlySummary[];
    },
  });
  const projectsQuery = useQuery({
    queryKey: ["financial-project-profitability"],
    enabled: canLoad,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_project_profitability")
        .select("*")
        .order("project_code");
      if (error) throw error;
      return data as ProjectProfitability[];
    },
  });
  const commitmentsQuery = useQuery({
    queryKey: ["financial-upcoming-commitments"],
    enabled: canLoad,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_upcoming_commitments")
        .select("*")
        .order("expected_payment_date");
      if (error) throw error;
      return data as Commitment[];
    },
  });
  const projectListQuery = useQuery({
    queryKey: ["business-projects"],
    enabled: canLoad,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, project_code, service, status")
        .order("project_code");
      if (error) throw error;
      return data;
    },
  });
  const receivablesAgingQuery = useQuery({
    queryKey: ["financial-receivables-aging"],
    enabled: canLoad,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_receivables_aging")
        .select("*")
        .order("due_date");
      if (error) throw error;
      return data as ReceivableAging[];
    },
  });
  const payablesAgingQuery = useQuery({
    queryKey: ["financial-payables-aging"],
    enabled: canLoad,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_payables_aging")
        .select("*")
        .order("due_date");
      if (error) throw error;
      return data as PayableAging[];
    },
  });
  const cashFlowQuery = useQuery({
    queryKey: ["financial-cash-flow-forecast"],
    enabled: canLoad,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_cash_flow_forecast")
        .select("*")
        .order("expected_date");
      if (error) throw error;
      return data as CashFlowItem[];
    },
  });
  const partiesQuery = useQuery({
    queryKey: ["business-parties"],
    enabled: canLoad,
    queryFn: async () => {
      const { data, error } = await supabase.from("business_parties").select("id, name");
      if (error) throw error;
      return data;
    },
  });

  const budgets = budgetsQuery.data ?? [];
  const monthlySummaries = monthlyQuery.data ?? [];
  const projectProfitability = projectsQuery.data ?? [];
  const commitments = commitmentsQuery.data ?? [];
  const projects = projectListQuery.data ?? [];
  const receivablesAging = receivablesAgingQuery.data ?? [];
  const payablesAging = payablesAgingQuery.data ?? [];
  const cashFlowItems = cashFlowQuery.data ?? [];
  const parties = partiesQuery.data ?? [];
  const projectNames = new Map(
    projects.map((project) => [project.id, `${project.project_code} · ${project.service}`]),
  );
  const partyNames = new Map(parties.map((party) => [party.id, party.name]));
  const filteredBudgets = budgets.filter(
    (budget) =>
      (!period || budget.period_start.startsWith(period)) &&
      (currency === "all" || budget.currency === currency) &&
      (projectFilter === "all" ||
        (projectFilter === "general" ? !budget.project_id : budget.project_id === projectFilter)),
  );
  const filteredMonthly = monthlySummaries.filter(
    (summary) =>
      (!period || summary.period_start.startsWith(period)) &&
      (currency === "all" || summary.currency === currency),
  );
  const filteredProjects = projectProfitability.filter(
    (project) => projectFilter === "all" || project.project_id === projectFilter,
  );
  const filteredCommitments = commitments.filter(
    (commitment) =>
      (currency === "all" || commitment.currency === currency) &&
      (projectFilter === "all" ||
        (projectFilter === "general"
          ? !commitment.project_id
          : commitment.project_id === projectFilter)),
  );
  const filteredReceivables = receivablesAging.filter(
    (item) =>
      (currency === "all" || item.currency === currency) &&
      (projectFilter === "all" ||
        (projectFilter === "general" ? !item.project_id : item.project_id === projectFilter)),
  );
  const filteredPayables = payablesAging.filter(
    (item) =>
      (currency === "all" || item.currency === currency) &&
      (projectFilter === "all" ||
        (projectFilter === "general" ? !item.project_id : item.project_id === projectFilter)),
  );
  const filteredCashFlow = cashFlowItems.filter(
    (item) =>
      (currency === "all" || item.currency === currency) &&
      (projectFilter === "all" ||
        (projectFilter === "general" ? !item.project_id : item.project_id === projectFilter)),
  );

  const createBudget = useMutation({
    mutationFn: async () => {
      const amount = Number(budgetAmount);
      if (!budgetCategory.trim()) throw new Error("Enter a budget category.");
      if (!/^\d{4}-\d{2}$/.test(period)) throw new Error("Choose a valid budget month.");
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Budget amount must be greater than zero.");
      }
      const { error } = await supabase.from("financial_budgets").insert({
        period_start: `${period}-01`,
        category: budgetCategory.trim(),
        project_id: budgetProject || null,
        currency: budgetCurrency,
        planned_amount: amount,
        notes: budgetNotes.trim(),
        status: "draft",
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setBudgetCategory("");
      setBudgetProject("");
      setBudgetAmount("");
      setBudgetNotes("");
      await queryClient.invalidateQueries({ queryKey: ["financial-budget-vs-actual"] });
      toast.success("Draft budget created.");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const approveBudget = useMutation({
    mutationFn: async (budgetId: string) => {
      const { error } = await supabase.rpc("approve_financial_budget", {
        p_budget_id: budgetId,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["financial-budget-vs-actual"] });
      toast.success("Budget approved.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const errors = [
    accessQuery.error,
    budgetsQuery.error,
    monthlyQuery.error,
    projectsQuery.error,
    commitmentsQuery.error,
    projectListQuery.error,
    receivablesAgingQuery.error,
    payablesAgingQuery.error,
    cashFlowQuery.error,
    partiesQuery.error,
  ].filter(Boolean);
  const isLoading =
    accessQuery.isLoading ||
    (canLoad &&
      (budgetsQuery.isLoading ||
        monthlyQuery.isLoading ||
        projectsQuery.isLoading ||
        commitmentsQuery.isLoading ||
        projectListQuery.isLoading ||
        receivablesAgingQuery.isLoading ||
        payablesAgingQuery.isLoading ||
        cashFlowQuery.isLoading ||
        partiesQuery.isLoading));

  function exportReport() {
    const rows: Array<Array<string | number | null | undefined>> = [
      ["Finance report", "BMP Media Production"],
      ["Month filter", period || "All"],
      ["Currency filter", currency],
      ["Project filter", projectFilter],
      [],
      ["Budget vs actual"],
      ["Month", "Category", "Project", "Currency", "Planned", "Actual", "Remaining", "Status"],
      ...filteredBudgets.map((budget) => [
        budget.period_start,
        budget.category,
        budget.project_id ? (projectNames.get(budget.project_id) ?? budget.project_id) : "General",
        budget.currency,
        budget.planned_amount,
        budget.actual_amount,
        budget.remaining_amount,
        budget.status,
      ]),
      [],
      ["Monthly income and expense"],
      ["Month", "Currency", "Income", "Expenses", "Net UGX"],
      ...filteredMonthly.map((summary) => [
        summary.period_start,
        summary.currency,
        summary.income_amount,
        summary.expense_amount,
        summary.net_ugx,
      ]),
      [],
      ["Project profitability (UGX functional currency)"],
      [
        "Project",
        "Service",
        "Status",
        "Contract",
        "Contract currency",
        "Collected revenue UGX",
        "Direct costs UGX",
        "Collected margin UGX",
      ],
      ...filteredProjects.map((project) => [
        project.project_code,
        project.service,
        project.status,
        project.contract_value,
        project.contract_currency,
        project.collected_revenue_ugx,
        project.direct_cost_ugx,
        project.collected_margin_ugx,
      ]),
      [],
      ["Approved upcoming expenses (next 90 days)"],
      ["Expected date", "Category", "Project", "Currency", "Amount", "Description"],
      ...filteredCommitments.map((item) => [
        item.expected_payment_date,
        item.category,
        item.project_id ? (projectNames.get(item.project_id) ?? item.project_id) : "General",
        item.currency,
        item.amount,
        item.description,
      ]),
      [],
      ["Accounts receivable aging"],
      ["Invoice", "Client", "Due date", "Age bucket", "Currency", "Amount"],
      ...filteredReceivables.map((item) => [
        item.invoice_number,
        partyNames.get(item.client_id) ?? item.client_id,
        item.due_date,
        item.aging_bucket,
        item.currency,
        item.amount_due,
      ]),
      [],
      ["Accounts payable aging"],
      ["Vendor bill", "Supplier", "Due date", "Age bucket", "Currency", "Amount"],
      ...filteredPayables.map((item) => [
        item.bill_number,
        partyNames.get(item.supplier_id) ?? item.supplier_id,
        item.due_date,
        item.aging_bucket,
        item.currency,
        item.amount_due,
      ]),
      [],
      ["Cash-flow forecast (next 90 days)"],
      ["Expected date", "Type", "Reference", "Direction", "Currency", "Amount"],
      ...filteredCashFlow.map((item) => [
        item.expected_date,
        item.source_type,
        item.reference,
        item.direction,
        item.currency,
        item.amount,
      ]),
    ];
    downloadCsv(`bmp-finance-report-${period || "all"}.csv`, rows);
  }

  return (
    <AppShell
      title="Finance reports & budgets"
      actions={
        <button
          type="button"
          onClick={exportReport}
          disabled={!canLoad || isLoading}
          className="rounded-sm border px-3 py-2 text-sm font-semibold hover:bg-secondary disabled:opacity-50"
        >
          Export CSV
        </button>
      }
    >
      <div className="space-y-6">
        <p className="rounded-sm border-l-4 border-primary bg-accent p-4 text-sm text-accent-foreground">
          Reports retain UGX and USD separately. Project profitability and unified monthly net are
          shown in UGX using the documented transaction exchange rates.
        </p>
        {accessQuery.data && !canLoad && (
          <div
            role="alert"
            className="rounded-sm border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
          >
            Accountant or administrator access is required to view finance reports and budgets.
          </div>
        )}
        {errors.length > 0 && (
          <div
            role="alert"
            className="rounded-sm border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
          >
            Finance report data could not be loaded:{" "}
            {errors
              .map((error) => (error instanceof Error ? error.message : String(error)))
              .join(" ")}
          </div>
        )}
        {isLoading && <p className="text-sm text-muted-foreground">Loading financial reports…</p>}

        {canLoad && (
          <>
            <section className="grid gap-3 rounded-sm border bg-card p-4 sm:grid-cols-3">
              <label className="space-y-1 text-sm font-medium">
                Month
                <input
                  type="month"
                  className={inputClass}
                  value={period}
                  onChange={(event) => setPeriod(event.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Currency
                <StyledSelect
                  ariaLabel="Report currency"
                  value={currency}
                  onChange={(value) => {
                    if (value === "all" || value === "UGX" || value === "USD") setCurrency(value);
                  }}
                  options={[{ value: "all", label: "All currencies" }, ...currencies]}
                  className={inputClass}
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Project
                <StyledSelect
                  ariaLabel="Report project"
                  value={projectFilter}
                  onChange={setProjectFilter}
                  options={[
                    { value: "all", label: "All projects" },
                    { value: "general", label: "General / unassigned" },
                    ...projects
                      .filter((project) => project.id)
                      .map((project) => ({
                        value: project.id,
                        label: `${project.project_code} · ${project.service}`,
                      })),
                  ]}
                  className={inputClass}
                />
              </label>
            </section>

            <section className="space-y-4 rounded-sm border bg-card p-4 sm:p-5">
              <div>
                <h2 className="signage text-xl text-navy">Create monthly budget</h2>
                <p className="text-sm text-muted-foreground">
                  Budgets start as drafts and require administrator approval before becoming
                  approved plans.
                </p>
              </div>
              <form
                className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  createBudget.mutate();
                }}
              >
                <label className="space-y-1 text-sm font-medium">
                  Month
                  <input
                    required
                    type="month"
                    className={inputClass}
                    value={period}
                    onChange={(event) => setPeriod(event.target.value)}
                  />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Category
                  <input
                    required
                    className={inputClass}
                    value={budgetCategory}
                    onChange={(event) => setBudgetCategory(event.target.value)}
                  />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Project (optional)
                  <StyledSelect
                    ariaLabel="Budget project"
                    value={budgetProject}
                    onChange={setBudgetProject}
                    placeholder="General / unassigned"
                    options={[
                      { value: "", label: "General / unassigned" },
                      ...projects
                        .filter((project) => project.id)
                        .map((project) => ({
                          value: project.id,
                          label: `${project.project_code} · ${project.service}`,
                        })),
                    ]}
                    className={inputClass}
                  />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Currency
                  <StyledSelect
                    ariaLabel="Budget currency"
                    value={budgetCurrency}
                    onChange={(value) => {
                      if (value === "UGX" || value === "USD") setBudgetCurrency(value);
                    }}
                    options={currencies}
                    className={inputClass}
                  />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Planned amount
                  <input
                    required
                    type="number"
                    min="0.01"
                    step="0.01"
                    className={inputClass}
                    value={budgetAmount}
                    onChange={(event) => setBudgetAmount(event.target.value)}
                  />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Notes
                  <input
                    className={inputClass}
                    value={budgetNotes}
                    onChange={(event) => setBudgetNotes(event.target.value)}
                  />
                </label>
                <button
                  type="submit"
                  disabled={createBudget.isPending}
                  className="rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60 sm:col-span-2 xl:col-span-3"
                >
                  {createBudget.isPending ? "Saving…" : "Create draft budget"}
                </button>
              </form>
            </section>

            <section className="space-y-3">
              <h2 className="signage text-xl text-navy">Budget vs actual</h2>
              <div className="overflow-x-auto rounded-sm border bg-card">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-secondary text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="p-3">Month / category</th>
                      <th className="p-3">Project</th>
                      <th className="p-3">Planned</th>
                      <th className="p-3">Actual</th>
                      <th className="p-3">Remaining</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBudgets.map((budget) => (
                      <tr
                        key={
                          budget.id ??
                          `${budget.period_start}-${budget.category}-${budget.project_id ?? "general"}-${budget.currency}`
                        }
                        className="border-t"
                      >
                        <td className="p-3">
                          <div>
                            {budget.period_start} · {budget.category}
                          </div>
                          <div className="text-xs text-muted-foreground">{budget.currency}</div>
                        </td>
                        <td className="p-3">
                          {budget.project_id
                            ? (projectNames.get(budget.project_id) ?? "Project")
                            : "General"}
                        </td>
                        <td className="p-3">
                          {budget.planned_amount === null
                            ? "N/A"
                            : money(budget.planned_amount, budget.currency)}
                        </td>
                        <td className="p-3">{money(budget.actual_amount, budget.currency)}</td>
                        <td className="p-3">
                          {budget.remaining_amount === null
                            ? "N/A"
                            : money(budget.remaining_amount, budget.currency)}
                        </td>
                        <td className="p-3 capitalize">{budget.status ?? "unbudgeted"}</td>
                        <td className="p-3">
                          {budget.status === "draft" && budget.id && (
                            <button
                              type="button"
                              disabled={approveBudget.isPending}
                              onClick={() => {
                                if (budget.id) approveBudget.mutate(budget.id);
                              }}
                              className="rounded-sm border px-3 py-1.5 text-xs font-semibold hover:bg-secondary disabled:opacity-50"
                            >
                              Approve
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!filteredBudgets.length && (
                      <tr>
                        <td className="p-4 text-muted-foreground" colSpan={7}>
                          No budgets match these filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="signage text-xl text-navy">Monthly income and expenses</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {filteredMonthly.map((summary) => (
                  <article
                    key={`${summary.period_start}-${summary.currency}`}
                    className="space-y-2 rounded-sm border bg-card p-4"
                  >
                    <h3 className="font-semibold">
                      {summary.period_start} · {summary.currency}
                    </h3>
                    <p className="text-sm">
                      Income: {money(summary.income_amount, summary.currency)}
                    </p>
                    <p className="text-sm">
                      Expenses: {money(summary.expense_amount, summary.currency)}
                    </p>
                    <p className="text-sm font-semibold">Net (UGX): {money(summary.net_ugx)}</p>
                  </article>
                ))}
                {!filteredMonthly.length && (
                  <p className="rounded-sm border bg-card p-4 text-sm text-muted-foreground">
                    No monthly activity matches these filters.
                  </p>
                )}
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="signage text-xl text-navy">Project profitability</h2>
              <div className="grid gap-3 lg:grid-cols-2">
                {filteredProjects.map((project) => (
                  <article
                    key={project.project_id}
                    className="space-y-2 rounded-sm border bg-card p-4"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="font-semibold">
                        {project.project_code} · {project.service}
                      </h3>
                      <span className="text-xs capitalize text-muted-foreground">
                        {project.status}
                      </span>
                    </div>
                    <p className="text-sm">
                      Contract: {money(project.contract_value, project.contract_currency)}
                    </p>
                    <p className="text-sm">
                      Collected revenue: {money(project.collected_revenue_ugx)}
                    </p>
                    <p className="text-sm">Direct costs: {money(project.direct_cost_ugx)}</p>
                    <p className="text-sm font-semibold">
                      Collected margin: {money(project.collected_margin_ugx)}
                    </p>
                  </article>
                ))}
                {!filteredProjects.length && (
                  <p className="rounded-sm border bg-card p-4 text-sm text-muted-foreground">
                    No project data matches this filter.
                  </p>
                )}
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="signage text-xl text-navy">
                Approved expenses due in the next 90 days
              </h2>
              <div className="overflow-x-auto rounded-sm border bg-card">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="bg-secondary text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="p-3">Expected date</th>
                      <th className="p-3">Expense</th>
                      <th className="p-3">Project</th>
                      <th className="p-3">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCommitments.map((commitment) => (
                      <tr key={commitment.id} className="border-t">
                        <td className="p-3">{commitment.expected_payment_date}</td>
                        <td className="p-3">
                          {commitment.category}
                          <div className="text-xs text-muted-foreground">
                            {commitment.description}
                          </div>
                        </td>
                        <td className="p-3">
                          {commitment.project_id
                            ? (projectNames.get(commitment.project_id) ?? "Project")
                            : "General"}
                        </td>
                        <td className="p-3">{money(commitment.amount, commitment.currency)}</td>
                      </tr>
                    ))}
                    {!filteredCommitments.length && (
                      <tr>
                        <td className="p-4 text-muted-foreground" colSpan={4}>
                          No upcoming approved expenses match these filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="grid gap-6 xl:grid-cols-2">
              <div className="space-y-3">
                <h2 className="signage text-xl text-navy">Accounts receivable aging</h2>
                <div className="overflow-x-auto rounded-sm border bg-card">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead className="bg-secondary text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="p-3">Invoice / client</th>
                        <th className="p-3">Due</th>
                        <th className="p-3">Age</th>
                        <th className="p-3">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredReceivables.map((item) => (
                        <tr key={item.id} className="border-t">
                          <td className="p-3">
                            {item.invoice_number}
                            <div className="text-xs text-muted-foreground">
                              {partyNames.get(item.client_id) ?? "Client"}
                            </div>
                          </td>
                          <td className="p-3">{item.due_date}</td>
                          <td className="p-3">{item.aging_bucket}</td>
                          <td className="p-3">{money(item.amount_due, item.currency)}</td>
                        </tr>
                      ))}
                      {!filteredReceivables.length && (
                        <tr>
                          <td colSpan={4} className="p-4 text-muted-foreground">
                            No outstanding customer invoices match these filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="space-y-3">
                <h2 className="signage text-xl text-navy">Accounts payable aging</h2>
                <div className="overflow-x-auto rounded-sm border bg-card">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead className="bg-secondary text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="p-3">Bill / supplier</th>
                        <th className="p-3">Due</th>
                        <th className="p-3">Age</th>
                        <th className="p-3">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPayables.map((item) => (
                        <tr key={item.id} className="border-t">
                          <td className="p-3">
                            {item.bill_number}
                            <div className="text-xs text-muted-foreground">
                              {partyNames.get(item.supplier_id) ?? "Supplier"}
                            </div>
                          </td>
                          <td className="p-3">{item.due_date}</td>
                          <td className="p-3">{item.aging_bucket}</td>
                          <td className="p-3">{money(item.amount_due, item.currency)}</td>
                        </tr>
                      ))}
                      {!filteredPayables.length && (
                        <tr>
                          <td colSpan={4} className="p-4 text-muted-foreground">
                            No outstanding supplier bills match these filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="signage text-xl text-navy">Expected cash flow · next 90 days</h2>
              <div className="overflow-x-auto rounded-sm border bg-card">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="bg-secondary text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="p-3">Expected date</th>
                      <th className="p-3">Source / reference</th>
                      <th className="p-3">Project</th>
                      <th className="p-3">Direction</th>
                      <th className="p-3">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCashFlow.map((item) => (
                      <tr key={`${item.source_type}-${item.source_id}`} className="border-t">
                        <td className="p-3">{item.expected_date}</td>
                        <td className="p-3">
                          <span className="capitalize">{item.source_type.replace("_", " ")}</span>
                          <div className="text-xs text-muted-foreground">{item.reference}</div>
                        </td>
                        <td className="p-3">
                          {item.project_id
                            ? (projectNames.get(item.project_id) ?? "Project")
                            : "General"}
                        </td>
                        <td className="p-3 capitalize">{item.direction}</td>
                        <td className="p-3">{money(item.amount, item.currency)}</td>
                      </tr>
                    ))}
                    {!filteredCashFlow.length && (
                      <tr>
                        <td colSpan={5} className="p-4 text-muted-foreground">
                          No receivables or approved expenses are scheduled within the next 90 days.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
