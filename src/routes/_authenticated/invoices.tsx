import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { StyledSelect } from "@/components/StyledSelect";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

type Invoice = Tables<"invoice_balances">;
type Party = Tables<"business_parties">;
type Project = Tables<"projects">;
type FinancialAccount = Tables<"financial_account_balances">;
type Currency = "UGX" | "USD";
type LineInput = { description: string; quantity: string; unitPrice: string };

const currencies: Array<{ value: Currency; label: string }> = [
  { value: "UGX", label: "UGX" },
  { value: "USD", label: "USD" },
];

function isCurrency(value: string): value is Currency {
  return value === "UGX" || value === "USD";
}

function money(value: number | null, currency: string) {
  return `${currency} ${Number(value ?? 0).toLocaleString("en-UG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function todayInUganda() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export const Route = createFileRoute("/_authenticated/invoices")({
  head: () => ({ meta: [{ title: "Invoices & collections · BMP Media Production" }] }),
  component: InvoicesPage,
});

function InvoicesPage() {
  const queryClient = useQueryClient();
  const today = useMemo(todayInUganda, []);
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [currency, setCurrency] = useState<Currency>("UGX");
  const [issueDate, setIssueDate] = useState(today);
  const [dueDate, setDueDate] = useState(today);
  const [lines, setLines] = useState<LineInput[]>([
    { description: "", quantity: "1", unitPrice: "" },
  ]);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [paymentDate, setPaymentDate] = useState(today);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");
  const [exchangeRateDate, setExchangeRateDate] = useState(today);
  const [exchangeRateSource, setExchangeRateSource] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentReason, setPaymentReason] = useState("");
  const inputClass =
    "w-full rounded-sm border border-input bg-card px-3 py-2 text-sm text-foreground";

  const invoicesQuery = useQuery({
    queryKey: ["invoice-balances"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_balances")
        .select("*")
        .order("issue_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const partiesQuery = useQuery({
    queryKey: ["business-parties"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("business_parties")
        .select("*")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });
  const projectsQuery = useQuery({
    queryKey: ["business-projects"],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("*").order("project_code");
      if (error) throw error;
      return data;
    },
  });
  const accountsQuery = useQuery({
    queryKey: ["financial-account-balances"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_account_balances")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
  });
  const paymentsQuery = useQuery({
    queryKey: ["invoice-payments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_payments")
        .select("*")
        .order("payment_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const invoices = invoicesQuery.data ?? [];
  const parties = partiesQuery.data ?? [];
  const projects = projectsQuery.data ?? [];
  const accounts = accountsQuery.data ?? [];
  const payments = paymentsQuery.data ?? [];
  const selectedInvoice = invoices.find((invoice) => invoice.id === selectedInvoiceId);
  const selectedPaymentAccount = accounts.find((account) => account.id === paymentAccountId);
  const selectedInvoiceClient = selectedInvoice
    ? parties.find((party) => party.id === selectedInvoice.client_id)
    : undefined;
  const availableClients = parties.filter(
    (party) => party.party_type === "client" || party.party_type === "both",
  );
  const availableProjects = projects.filter((project) => project.client_id === clientId);
  const availablePaymentAccounts = accounts.filter(
    (account) => account.currency === selectedInvoice?.currency,
  );

  const createInvoice = useMutation({
    mutationFn: async (formData: FormData) => {
      const invoiceNumber = String(formData.get("invoice_number") ?? "").trim();
      const taxAmount = Number(formData.get("tax_amount") ?? 0);
      if (!clientId) throw new Error("Choose an invoice client.");
      if (!invoiceNumber) throw new Error("Enter an invoice number.");
      if (dueDate < issueDate) throw new Error("Due date cannot be before the issue date.");
      if (!Number.isFinite(taxAmount) || taxAmount < 0)
        throw new Error("Tax must be zero or more.");
      const lineItems = lines.map((line) => ({
        description: line.description.trim(),
        quantity: Number(line.quantity),
        unit_price: Number(line.unitPrice),
      }));
      if (
        lineItems.some(
          (line) =>
            !line.description ||
            !Number.isFinite(line.quantity) ||
            line.quantity <= 0 ||
            !Number.isFinite(line.unit_price) ||
            line.unit_price < 0,
        )
      ) {
        throw new Error(
          "Each invoice line needs a description, positive quantity, and valid price.",
        );
      }

      const { error } = await supabase.rpc("create_sales_invoice", {
        p_invoice_number: invoiceNumber,
        p_client_id: clientId,
        p_project_id: projectId || null,
        p_issue_date: issueDate,
        p_due_date: dueDate,
        p_currency: currency,
        p_tax_amount: taxAmount,
        p_notes: String(formData.get("notes") ?? "").trim(),
        p_line_items: lineItems,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["invoice-balances"] });
      await queryClient.invalidateQueries({ queryKey: ["invoice-payments"] });
      toast.success("Draft invoice created.");
      document.getElementById("invoice-create-form")?.querySelector("form")?.reset();
      setClientId("");
      setProjectId("");
      setCurrency("UGX");
      setIssueDate(today);
      setDueDate(today);
      setLines([{ description: "", quantity: "1", unitPrice: "" }]);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const issueInvoice = useMutation({
    mutationFn: async (invoiceId: string) => {
      const { error } = await supabase.rpc("mark_sales_invoice_sent", {
        p_invoice_id: invoiceId,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["invoice-balances"] });
      toast.success("Invoice issued.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const addPayment = useMutation({
    mutationFn: async () => {
      if (!selectedInvoice) throw new Error("Select an issued invoice.");
      if (!selectedPaymentAccount?.id)
        throw new Error("Choose an account in the invoice currency.");
      const rate = selectedInvoice.currency === "UGX" ? 1 : Number(exchangeRate);
      const rateDate = selectedInvoice.currency === "UGX" ? paymentDate : exchangeRateDate;
      const rateSource =
        selectedInvoice.currency === "UGX" ? "UGX base currency" : exchangeRateSource.trim();
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error("Enter a documented exchange rate greater than zero.");
      }
      if (!rateSource) throw new Error("Enter the source of the exchange rate.");
      const amount = Number(paymentAmount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a payment amount.");
      if (!paymentReason.trim()) throw new Error("Add a reason or payment source.");

      const { error } = await supabase.rpc("add_sales_invoice_payment", {
        p_invoice_id: selectedInvoice.id,
        p_account_id: selectedPaymentAccount.id,
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
      await queryClient.invalidateQueries({ queryKey: ["invoice-balances"] });
      await queryClient.invalidateQueries({ queryKey: ["invoice-payments"] });
      await queryClient.invalidateQueries({ queryKey: ["financial-account-balances"] });
      await queryClient.invalidateQueries({ queryKey: ["financial-transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["financial-audit-log"] });
      toast.success("Payment recorded and posted to the financial account.");
      setPaymentAmount("");
      setExchangeRate("");
      setExchangeRateSource("");
      setPaymentReference("");
      setPaymentReason("");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const queryErrors = [
    invoicesQuery.error,
    partiesQuery.error,
    projectsQuery.error,
    accountsQuery.error,
    paymentsQuery.error,
  ]
    .filter(Boolean)
    .map((error) => (error instanceof Error ? error.message : String(error)));

  return (
    <AppShell title="Invoices & collections">
      <div className="space-y-6">
        <p className="rounded-sm border-l-4 border-primary bg-accent p-4 text-sm text-accent-foreground">
          Create draft invoices, issue them when ready, and record partial or final payments.
          Collections are posted to the selected financial account in the invoice currency, with a
          recorded exchange rate for USD receipts.
        </p>

        {queryErrors.length > 0 && (
          <div
            role="alert"
            className="rounded-sm border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
          >
            Invoice data could not be loaded: {queryErrors.join(" ")}
          </div>
        )}

        <section
          id="invoice-create-form"
          className="space-y-4 rounded-sm border bg-card p-4 sm:p-5"
        >
          <div>
            <h2 className="signage text-xl text-navy">Create invoice</h2>
            <p className="text-sm text-muted-foreground">
              Issued invoices retain their line items; corrections should be documented rather than
              silently overwriting posted amounts.
            </p>
          </div>
          <form
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
            onSubmit={(event) => {
              event.preventDefault();
              createInvoice.mutate(new FormData(event.currentTarget));
            }}
          >
            <label className="space-y-1 text-sm font-medium">
              Invoice number
              <input
                required
                name="invoice_number"
                className={inputClass}
                placeholder="BMP-INV-001"
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Client
              <StyledSelect
                ariaLabel="Invoice client"
                value={clientId}
                onChange={(value) => {
                  setClientId(value);
                  setProjectId("");
                }}
                placeholder="Choose a client"
                options={availableClients.map((party) => ({ value: party.id, label: party.name }))}
                className={inputClass}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Project (optional)
              <StyledSelect
                ariaLabel="Invoice project"
                value={projectId}
                onChange={setProjectId}
                placeholder="No project selected"
                options={availableProjects.map((project) => ({
                  value: project.id,
                  label: `${project.project_code} · ${project.service}`,
                }))}
                className={inputClass}
                disabled={!clientId}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Issue date
              <input
                required
                type="date"
                className={inputClass}
                value={issueDate}
                onChange={(event) => {
                  setIssueDate(event.target.value);
                  if (dueDate < event.target.value) setDueDate(event.target.value);
                }}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Due date
              <input
                required
                type="date"
                min={issueDate}
                className={inputClass}
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Currency
              <StyledSelect
                ariaLabel="Invoice currency"
                value={currency}
                onChange={(value) => {
                  if (isCurrency(value)) setCurrency(value);
                }}
                options={currencies}
                className={inputClass}
              />
            </label>

            <div className="space-y-3 sm:col-span-2 xl:col-span-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold">Line items</h3>
                <button
                  type="button"
                  onClick={() =>
                    setLines((current) => [
                      ...current,
                      { description: "", quantity: "1", unitPrice: "" },
                    ])
                  }
                  className="rounded-sm border px-3 py-1.5 text-sm font-semibold hover:bg-secondary"
                >
                  Add line
                </button>
              </div>
              {lines.map((line, index) => (
                <div key={index} className="grid gap-2 sm:grid-cols-[1fr_120px_160px_auto]">
                  <label className="space-y-1 text-xs font-medium text-muted-foreground">
                    Description
                    <input
                      required
                      value={line.description}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, description: event.target.value }
                              : item,
                          ),
                        )
                      }
                      className={inputClass}
                    />
                  </label>
                  <label className="space-y-1 text-xs font-medium text-muted-foreground">
                    Quantity
                    <input
                      required
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={line.quantity}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, quantity: event.target.value } : item,
                          ),
                        )
                      }
                      className={inputClass}
                    />
                  </label>
                  <label className="space-y-1 text-xs font-medium text-muted-foreground">
                    Unit price ({currency})
                    <input
                      required
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.unitPrice}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, unitPrice: event.target.value } : item,
                          ),
                        )
                      }
                      className={inputClass}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={lines.length === 1}
                    onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                    className="self-end rounded-sm border px-3 py-2 text-sm font-semibold text-destructive disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <label className="space-y-1 text-sm font-medium">
              Tax amount
              <input
                name="tax_amount"
                type="number"
                min="0"
                step="0.01"
                defaultValue="0"
                className={inputClass}
              />
            </label>
            <label className="space-y-1 text-sm font-medium sm:col-span-2">
              Notes
              <input name="notes" className={inputClass} />
            </label>
            <button
              type="submit"
              disabled={createInvoice.isPending || availableClients.length === 0}
              className="rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60 sm:col-span-2 xl:col-span-3"
            >
              {createInvoice.isPending ? "Saving…" : "Create draft invoice"}
            </button>
            {availableClients.length === 0 && (
              <p className="text-xs text-muted-foreground sm:col-span-2 xl:col-span-3">
                Add a client on the Projects & partners page before creating invoices.
              </p>
            )}
          </form>
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="signage text-xl text-navy">Invoices and receivables</h2>
            <p className="text-sm text-muted-foreground">
              Invoice balances are calculated from line items and recorded payments. Amounts remain
              separated by currency.
            </p>
          </div>
          {invoicesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading invoices…</p>
          ) : invoices.length === 0 ? (
            <p className="rounded-sm border bg-card p-4 text-sm text-muted-foreground">
              No invoices have been created.
            </p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {invoices.map((invoice: Invoice) => {
                const client = parties.find((party) => party.id === invoice.client_id);
                const project = projects.find((item) => item.id === invoice.project_id);
                const isSelected = selectedInvoiceId === invoice.id;
                return (
                  <article
                    key={invoice.id}
                    className={`space-y-3 rounded-sm border bg-card p-4 ${
                      isSelected ? "border-primary" : ""
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-bold">{invoice.invoice_number}</p>
                        <p className="text-sm text-muted-foreground">
                          {client?.name ?? "Unknown client"}
                          {project ? ` · ${project.project_code}` : ""}
                        </p>
                      </div>
                      <span className="rounded-sm bg-secondary px-2 py-1 text-xs font-bold uppercase">
                        {invoice.payment_status}
                      </span>
                    </div>
                    <div className="grid gap-2 text-sm sm:grid-cols-2">
                      <p>
                        <span className="text-muted-foreground">Issued / due: </span>
                        {invoice.issue_date} / {invoice.due_date}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Total: </span>
                        {money(invoice.total_amount, invoice.currency)}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Paid: </span>
                        {money(invoice.amount_paid, invoice.currency)}
                      </p>
                      <p className="font-semibold">
                        <span className="text-muted-foreground">Balance: </span>
                        {money(invoice.balance_due, invoice.currency)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 border-t pt-3">
                      {invoice.status === "draft" && (
                        <button
                          type="button"
                          disabled={issueInvoice.isPending}
                          onClick={() => issueInvoice.mutate(invoice.id)}
                          className="rounded-sm bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                        >
                          Issue invoice
                        </button>
                      )}
                      {invoice.status === "sent" && Number(invoice.balance_due) > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedInvoiceId(invoice.id);
                            setPaymentAccountId("");
                          }}
                          className="rounded-sm border px-3 py-2 text-sm font-semibold hover:bg-secondary"
                        >
                          {isSelected ? "Selected for payment" : "Record payment"}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {selectedInvoice && selectedInvoice.status === "sent" && (
          <section className="space-y-4 rounded-sm border bg-card p-4 sm:p-5">
            <div>
              <h2 className="signage text-xl text-navy">
                Record payment · {selectedInvoice.invoice_number}
              </h2>
              <p className="text-sm text-muted-foreground">
                Remaining balance: {money(selectedInvoice.balance_due, selectedInvoice.currency)} ·{" "}
                {selectedInvoiceClient?.name}
              </p>
            </div>
            <form
              className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
              onSubmit={(event) => {
                event.preventDefault();
                addPayment.mutate();
              }}
            >
              <label className="space-y-1 text-sm font-medium">
                Receiving account ({selectedInvoice.currency})
                <StyledSelect
                  ariaLabel="Invoice payment account"
                  value={paymentAccountId}
                  onChange={setPaymentAccountId}
                  placeholder="Choose a matching account"
                  options={availablePaymentAccounts
                    .filter((account) => account.id)
                    .map((account) => ({
                      value: account.id!,
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
                  className={inputClass}
                  value={paymentDate}
                  onChange={(event) => {
                    setPaymentDate(event.target.value);
                    if (selectedInvoice.currency === "UGX") {
                      setExchangeRateDate(event.target.value);
                    }
                  }}
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Amount ({selectedInvoice.currency})
                <input
                  required
                  type="number"
                  min="0.01"
                  max={Number(selectedInvoice.balance_due ?? 0)}
                  step="0.01"
                  className={inputClass}
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                />
              </label>
              {selectedInvoice.currency === "USD" ? (
                <>
                  <label className="space-y-1 text-sm font-medium">
                    UGX per USD
                    <input
                      required
                      type="number"
                      min="0.00000001"
                      step="0.00000001"
                      className={inputClass}
                      value={exchangeRate}
                      onChange={(event) => setExchangeRate(event.target.value)}
                    />
                  </label>
                  <label className="space-y-1 text-sm font-medium">
                    Exchange rate date
                    <input
                      required
                      type="date"
                      className={inputClass}
                      value={exchangeRateDate}
                      onChange={(event) => setExchangeRateDate(event.target.value)}
                    />
                  </label>
                  <label className="space-y-1 text-sm font-medium">
                    Exchange rate source
                    <input
                      required
                      className={inputClass}
                      value={exchangeRateSource}
                      onChange={(event) => setExchangeRateSource(event.target.value)}
                      placeholder="Bank statement or payment provider"
                    />
                  </label>
                </>
              ) : (
                <p className="self-end rounded-sm bg-secondary p-3 text-xs text-muted-foreground">
                  UGX uses rate 1 and the payment date.
                </p>
              )}
              <label className="space-y-1 text-sm font-medium">
                Receipt / transaction reference
                <input
                  className={inputClass}
                  value={paymentReference}
                  onChange={(event) => setPaymentReference(event.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm font-medium sm:col-span-2">
                Payment source / audit reason
                <input
                  required
                  className={inputClass}
                  value={paymentReason}
                  onChange={(event) => setPaymentReason(event.target.value)}
                  placeholder="Bank deposit, mobile money receipt, etc."
                />
              </label>
              <button
                type="submit"
                disabled={addPayment.isPending || !paymentAccountId}
                className="rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60 sm:col-span-2 xl:col-span-3"
              >
                {addPayment.isPending ? "Recording…" : "Record collection"}
              </button>
            </form>
          </section>
        )}

        <section className="space-y-3">
          <div>
            <h2 className="signage text-xl text-navy">Recent receipts</h2>
            <p className="text-sm text-muted-foreground">
              Each recorded collection is also posted as an income transaction to its financial
              account.
            </p>
          </div>
          {paymentsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading receipts…</p>
          ) : payments.length === 0 ? (
            <p className="rounded-sm border bg-card p-4 text-sm text-muted-foreground">
              No invoice payments recorded.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-sm border bg-card">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="bg-secondary text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="p-3">Date / invoice</th>
                    <th className="p-3">Client</th>
                    <th className="p-3">Account</th>
                    <th className="p-3">Amount</th>
                    <th className="p-3">Reference / reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {payments.map((payment) => {
                    const invoice = invoices.find((item) => item.id === payment.invoice_id);
                    const client = parties.find((item) => item.id === invoice?.client_id);
                    const account: FinancialAccount | undefined = accounts.find(
                      (item) => item.id === payment.account_id,
                    );
                    return (
                      <tr key={payment.id}>
                        <td className="p-3">
                          <span className="block">{payment.payment_date}</span>
                          <span className="text-xs text-muted-foreground">
                            {invoice?.invoice_number ?? "Invoice"}
                          </span>
                        </td>
                        <td className="p-3">{client?.name ?? "—"}</td>
                        <td className="p-3">{account?.name ?? "—"}</td>
                        <td className="p-3">{money(payment.amount, account?.currency ?? "")}</td>
                        <td className="p-3">
                          <span className="block">{payment.reference || "No reference"}</span>
                          <span className="text-xs text-muted-foreground">{payment.reason}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
