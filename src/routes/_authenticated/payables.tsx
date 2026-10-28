import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { StyledSelect } from "@/components/StyledSelect";
import { supabase } from "@/integrations/supabase/client";
import { devAuthBypass } from "@/lib/dev-auth";
import type { Tables } from "@/integrations/supabase/types";

type Currency = "UGX" | "USD";
type Bill = Tables<"vendor_bill_balances">;
const currencies: Array<{ value: Currency; label: string }> = [
  { value: "UGX", label: "UGX" },
  { value: "USD", label: "USD" },
];

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

function money(amount: number | null, currency: string) {
  return `${currency} ${Number(amount ?? 0).toLocaleString("en-UG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export const Route = createFileRoute("/_authenticated/payables")({
  head: () => ({ meta: [{ title: "Vendor bills & payables · BMP Media Production" }] }),
  component: PayablesPage,
});

function PayablesPage() {
  const queryClient = useQueryClient();
  const today = useMemo(todayInUganda, []);
  const [supplierId, setSupplierId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [costType, setCostType] = useState<"direct" | "general">("direct");
  const [currency, setCurrency] = useState<Currency>("UGX");
  const [billDate, setBillDate] = useState(today);
  const [dueDate, setDueDate] = useState(today);
  const [selectedBillId, setSelectedBillId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [paymentDate, setPaymentDate] = useState(today);
  const [exchangeRate, setExchangeRate] = useState("");
  const [exchangeRateDate, setExchangeRateDate] = useState(today);
  const [exchangeRateSource, setExchangeRateSource] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentReason, setPaymentReason] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const inputClass =
    "w-full rounded-sm border border-input bg-card px-3 py-2 text-sm text-foreground";

  const accessQuery = useQuery({
    queryKey: ["payables-access"],
    queryFn: async () => {
      if (devAuthBypass) return { canView: true, isAdmin: true, userId: null };
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) return { canView: false, isAdmin: false, userId: null };
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", auth.user.id);
      if (error) throw error;
      const roles = (data ?? []).map((row) => row.role);
      return {
        canView: roles.includes("admin") || roles.includes("accountant"),
        isAdmin: roles.includes("admin"),
        userId: auth.user.id,
      };
    },
  });
  const enabled = accessQuery.data?.canView === true;
  const billsQuery = useQuery({
    queryKey: ["vendor-bill-balances"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendor_bill_balances")
        .select("*")
        .order("bill_date", { ascending: false });
      if (error) throw error;
      return data as Bill[];
    },
  });
  const partiesQuery = useQuery({
    queryKey: ["business-parties"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("business_parties")
        .select("id, name, party_type, is_active")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });
  const projectsQuery = useQuery({
    queryKey: ["business-projects"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, project_code, service, status")
        .not("status", "in", "(completed,cancelled)")
        .order("project_code");
      if (error) throw error;
      return data;
    },
  });
  const accountsQuery = useQuery({
    queryKey: ["financial-account-balances"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_account_balances")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const bills = billsQuery.data ?? [];
  const parties = partiesQuery.data ?? [];
  const projects = projectsQuery.data ?? [];
  const accounts = accountsQuery.data ?? [];
  const selectedBill = bills.find((bill) => bill.id === selectedBillId);
  const selectedAccount = accounts.find((account) => account.id === accountId);
  const payableAccounts = accounts.filter((account) => account.currency === selectedBill?.currency);
  const suppliers = parties.filter(
    (party) => party.party_type === "supplier" || party.party_type === "both",
  );
  const projectNames = new Map(
    projects.map((project) => [project.id, `${project.project_code} · ${project.service}`]),
  );
  const errors = [
    accessQuery.error,
    billsQuery.error,
    partiesQuery.error,
    projectsQuery.error,
    accountsQuery.error,
  ].filter(Boolean);

  const createBill = useMutation({
    mutationFn: async (formData: FormData) => {
      const billNumber = String(formData.get("bill_number") ?? "").trim();
      const category = String(formData.get("category") ?? "").trim();
      const description = String(formData.get("description") ?? "").trim();
      const amount = Number(formData.get("amount"));
      if (!supplierId || !billNumber || !category || !description) {
        throw new Error("Complete the supplier, bill number, category, and description.");
      }
      if (costType === "direct" && !projectId) {
        throw new Error("Choose a project for a direct vendor cost.");
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Bill amount must be greater than zero.");
      }
      if (dueDate < billDate) throw new Error("Due date cannot be before the bill date.");
      const { error } = await supabase.rpc("create_vendor_bill", {
        p_bill_number: billNumber,
        p_supplier_id: supplierId,
        p_project_id: costType === "direct" ? projectId : null,
        p_cost_type: costType,
        p_category: category,
        p_description: description,
        p_bill_date: billDate,
        p_due_date: dueDate,
        p_currency: currency,
        p_amount: amount,
        p_notes: String(formData.get("notes") ?? "").trim(),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["vendor-bill-balances"] });
      toast.success("Vendor bill recorded as a draft for manager approval.");
      document.getElementById("vendor-bill-form")?.querySelector("form")?.reset();
      setSupplierId("");
      setProjectId("");
      setCostType("direct");
      setCurrency("UGX");
      setBillDate(today);
      setDueDate(today);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const reviewBill = useMutation({
    mutationFn: async ({
      billId,
      decision,
    }: {
      billId: string;
      decision: "approved" | "rejected";
    }) => {
      const note = reviewNotes[billId]?.trim() ?? "";
      if (decision === "rejected" && !note) {
        throw new Error("Enter a reason before rejecting a bill.");
      }
      const { error } = await supabase.rpc("review_vendor_bill", {
        p_bill_id: billId,
        p_decision: decision,
        p_manager_note: note,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["vendor-bill-balances"] });
      toast.success("Vendor bill reviewed.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const payBill = useMutation({
    mutationFn: async (formData: FormData) => {
      if (!selectedBill || selectedBill.status !== "approved") {
        throw new Error("Choose an approved vendor bill.");
      }
      if (!selectedAccount?.id) throw new Error("Choose an account in the bill currency.");
      const amount = Number(formData.get("payment_amount"));
      const rate = selectedBill.currency === "UGX" ? 1 : Number(exchangeRate);
      const rateDate = selectedBill.currency === "UGX" ? paymentDate : exchangeRateDate;
      const rateSource =
        selectedBill.currency === "UGX" ? "UGX base currency" : exchangeRateSource.trim();
      if (!Number.isFinite(amount) || amount <= 0 || amount > Number(selectedBill.balance_due)) {
        throw new Error("Payment must be positive and cannot exceed the remaining bill balance.");
      }
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error("Enter a documented exchange rate greater than zero.");
      }
      if (!rateSource || !paymentReason.trim()) {
        throw new Error("Enter the exchange-rate source and a payment reason.");
      }
      const { error } = await supabase.rpc("record_vendor_bill_payment", {
        p_bill_id: selectedBill.id,
        p_account_id: selectedAccount.id,
        p_payment_date: paymentDate,
        p_amount: amount,
        p_exchange_rate: rate,
        p_exchange_rate_date: rateDate,
        p_exchange_rate_source: rateSource,
        p_reference: paymentReference.trim() || null,
        p_reason: paymentReason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["vendor-bill-balances"] }),
        queryClient.invalidateQueries({ queryKey: ["financial-account-balances"] }),
        queryClient.invalidateQueries({ queryKey: ["financial-transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["financial-audit-log"] }),
        queryClient.invalidateQueries({ queryKey: ["financial-payables-aging"] }),
        queryClient.invalidateQueries({ queryKey: ["financial-cash-flow-forecast"] }),
      ]);
      toast.success("Vendor bill payment posted to the financial account.");
      setSelectedBillId("");
      setAccountId("");
      setPaymentReference("");
      setPaymentReason("");
      setExchangeRate("");
      setExchangeRateSource("");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <AppShell title="Vendor bills & payables">
      <div className="space-y-6">
        <p className="rounded-sm border-l-4 border-primary bg-accent p-4 text-sm text-accent-foreground">
          Record supplier bills separately from cash payments. A manager must approve each bill;
          partial payments post as immutable expenses only after approval. Balances remain separated
          by currency.
        </p>
        {accessQuery.data?.canView === false && (
          <div
            role="alert"
            className="rounded-sm border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
          >
            Verified accountant or administrator access is required.
          </div>
        )}
        {errors.length > 0 && (
          <div
            role="alert"
            className="rounded-sm border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
          >
            Payables data could not be loaded:{" "}
            {errors
              .map((error) => (error instanceof Error ? error.message : String(error)))
              .join(" ")}
          </div>
        )}

        {enabled && (
          <>
            <section
              id="vendor-bill-form"
              className="space-y-4 rounded-sm border bg-card p-4 sm:p-5"
            >
              <div>
                <h2 className="signage text-xl text-navy">Record supplier bill</h2>
                <p className="text-sm text-muted-foreground">
                  The entry is a draft until a manager approves it.
                </p>
              </div>
              <form
                className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  createBill.mutate(new FormData(event.currentTarget));
                }}
              >
                <label className="space-y-1 text-sm font-medium">
                  Supplier
                  <StyledSelect
                    ariaLabel="Vendor bill supplier"
                    value={supplierId}
                    onChange={setSupplierId}
                    placeholder="Choose a supplier"
                    options={suppliers.map((supplier) => ({
                      value: supplier.id,
                      label: supplier.name,
                    }))}
                    className={inputClass}
                  />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Supplier bill number
                  <input required name="bill_number" className={inputClass} />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Cost type
                  <StyledSelect
                    ariaLabel="Vendor bill cost type"
                    value={costType}
                    onChange={(value) => {
                      if (value === "direct" || value === "general") {
                        setCostType(value);
                        if (value === "general") setProjectId("");
                      }
                    }}
                    options={[
                      { value: "direct", label: "Direct project cost" },
                      { value: "general", label: "General cost" },
                    ]}
                    className={inputClass}
                  />
                </label>
                {costType === "direct" && (
                  <label className="space-y-1 text-sm font-medium">
                    Project
                    <StyledSelect
                      ariaLabel="Vendor bill project"
                      value={projectId}
                      onChange={setProjectId}
                      placeholder="Choose a project"
                      options={projects.map((project) => ({
                        value: project.id,
                        label: `${project.project_code} · ${project.service}`,
                      }))}
                      className={inputClass}
                    />
                  </label>
                )}
                <label className="space-y-1 text-sm font-medium">
                  Category
                  <input required name="category" className={inputClass} />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Amount
                  <input
                    required
                    name="amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    className={inputClass}
                  />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Currency
                  <StyledSelect
                    ariaLabel="Vendor bill currency"
                    value={currency}
                    onChange={(value) => {
                      if (value === "UGX" || value === "USD") setCurrency(value);
                    }}
                    options={currencies}
                    className={inputClass}
                  />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Bill date
                  <input
                    required
                    type="date"
                    value={billDate}
                    onChange={(event) => setBillDate(event.target.value)}
                    className={inputClass}
                  />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Due date
                  <input
                    required
                    type="date"
                    min={billDate}
                    value={dueDate}
                    onChange={(event) => setDueDate(event.target.value)}
                    className={inputClass}
                  />
                </label>
                <label className="space-y-1 text-sm font-medium sm:col-span-2">
                  Description
                  <input required name="description" className={inputClass} />
                </label>
                <label className="space-y-1 text-sm font-medium sm:col-span-2 xl:col-span-3">
                  Notes / source
                  <textarea name="notes" rows={2} className={inputClass} />
                </label>
                <button
                  type="submit"
                  disabled={
                    createBill.isPending ||
                    !suppliers.length ||
                    (costType === "direct" && !projects.length)
                  }
                  className="rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60 sm:col-span-2 xl:col-span-3"
                >
                  {createBill.isPending ? "Saving…" : "Create draft bill"}
                </button>
              </form>
            </section>

            {selectedBill?.status === "approved" && (
              <section className="space-y-4 rounded-sm border bg-card p-4 sm:p-5">
                <div>
                  <h2 className="signage text-xl text-navy">Record bill payment</h2>
                  <p className="text-sm text-muted-foreground">
                    {selectedBill.bill_number} · remaining{" "}
                    {money(selectedBill.balance_due, selectedBill.currency)}
                  </p>
                </div>
                <form
                  className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    payBill.mutate(new FormData(event.currentTarget));
                  }}
                >
                  <label className="space-y-1 text-sm font-medium">
                    Account
                    <StyledSelect
                      ariaLabel="Vendor bill payment account"
                      value={accountId}
                      onChange={setAccountId}
                      placeholder={`Choose ${selectedBill.currency} account`}
                      options={payableAccounts.map((account) => ({
                        value: account.id ?? "",
                        label: `${account.name} · ${account.currency}`,
                      }))}
                      className={inputClass}
                    />
                  </label>
                  <label className="space-y-1 text-sm font-medium">
                    Payment date
                    <input
                      required
                      type="date"
                      value={paymentDate}
                      onChange={(event) => setPaymentDate(event.target.value)}
                      className={inputClass}
                    />
                  </label>
                  <label className="space-y-1 text-sm font-medium">
                    Amount ({selectedBill.currency})
                    <input
                      required
                      name="payment_amount"
                      type="number"
                      min="0.01"
                      max={selectedBill.balance_due ?? undefined}
                      step="0.01"
                      className={inputClass}
                    />
                  </label>
                  {selectedBill.currency === "USD" && (
                    <>
                      <label className="space-y-1 text-sm font-medium">
                        UGX per USD
                        <input
                          required
                          type="number"
                          min="0.00000001"
                          step="0.00000001"
                          value={exchangeRate}
                          onChange={(event) => setExchangeRate(event.target.value)}
                          className={inputClass}
                        />
                      </label>
                      <label className="space-y-1 text-sm font-medium">
                        Exchange-rate date
                        <input
                          required
                          type="date"
                          value={exchangeRateDate}
                          onChange={(event) => setExchangeRateDate(event.target.value)}
                          className={inputClass}
                        />
                      </label>
                      <label className="space-y-1 text-sm font-medium">
                        Exchange-rate source
                        <input
                          required
                          value={exchangeRateSource}
                          onChange={(event) => setExchangeRateSource(event.target.value)}
                          className={inputClass}
                        />
                      </label>
                    </>
                  )}
                  <label className="space-y-1 text-sm font-medium">
                    Payment reference
                    <input
                      value={paymentReference}
                      onChange={(event) => setPaymentReference(event.target.value)}
                      className={inputClass}
                    />
                  </label>
                  <label className="space-y-1 text-sm font-medium sm:col-span-2">
                    Payment reason
                    <input
                      required
                      value={paymentReason}
                      onChange={(event) => setPaymentReason(event.target.value)}
                      className={inputClass}
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={payBill.isPending || !accountId}
                    className="rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                  >
                    {payBill.isPending ? "Posting…" : "Post payment"}
                  </button>
                </form>
              </section>
            )}

            <section className="space-y-3">
              <h2 className="signage text-xl text-navy">Supplier bills and balances</h2>
              {billsQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading supplier bills…</p>
              ) : bills.length === 0 ? (
                <p className="rounded-sm border bg-card p-4 text-sm text-muted-foreground">
                  No supplier bills recorded.
                </p>
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {bills.map((bill) => {
                    const supplier = parties.find((party) => party.id === bill.supplier_id);
                    const isOwn = bill.requested_by === accessQuery.data?.userId;
                    return (
                      <article key={bill.id} className="space-y-3 rounded-sm border bg-card p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="font-semibold">
                              {bill.bill_number} · {supplier?.name ?? "Supplier"}
                            </h3>
                            <p className="text-sm text-muted-foreground">
                              {bill.category} · Due {bill.due_date}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {bill.project_id
                                ? (projectNames.get(bill.project_id) ?? "Project")
                                : "General"}
                            </p>
                          </div>
                          <span className="rounded-sm bg-secondary px-2 py-1 text-xs font-bold uppercase">
                            {bill.payment_status ?? bill.status}
                          </span>
                        </div>
                        <p className="text-sm">{bill.description}</p>
                        <div className="grid grid-cols-3 gap-2 text-sm">
                          <p>Total: {money(bill.total_amount, bill.currency)}</p>
                          <p>Paid: {money(bill.amount_paid, bill.currency)}</p>
                          <p>Due: {money(bill.balance_due, bill.currency)}</p>
                        </div>
                        {bill.status === "draft" && accessQuery.data?.isAdmin && !isOwn && (
                          <div className="space-y-2 border-t pt-3">
                            <input
                              aria-label={`Review note for ${bill.bill_number}`}
                              value={reviewNotes[bill.id] ?? ""}
                              onChange={(event) =>
                                setReviewNotes((current) => ({
                                  ...current,
                                  [bill.id]: event.target.value,
                                }))
                              }
                              placeholder="Required if rejecting"
                              className={inputClass}
                            />
                            <div className="flex gap-2">
                              {(["approved", "rejected"] as const).map((decision) => (
                                <button
                                  key={decision}
                                  type="button"
                                  disabled={reviewBill.isPending || isOwn}
                                  onClick={() => reviewBill.mutate({ billId: bill.id, decision })}
                                  className="rounded-sm border px-3 py-2 text-xs font-semibold capitalize hover:bg-secondary disabled:opacity-50"
                                >
                                  {decision}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        {bill.manager_note && (
                          <p className="rounded-sm bg-secondary p-2 text-sm">
                            Review note: {bill.manager_note}
                          </p>
                        )}
                        {bill.status === "approved" && Number(bill.balance_due) > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedBillId(bill.id);
                              setAccountId("");
                            }}
                            className="rounded-sm border px-3 py-2 text-xs font-semibold hover:bg-secondary"
                          >
                            Pay / record partial payment
                          </button>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
