import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { StyledSelect } from "@/components/StyledSelect";
import { supabase } from "@/integrations/supabase/client";

type TransactionType =
  | "income"
  | "expense"
  | "transfer"
  | "refund"
  | "advance"
  | "employee_advance"
  | "owner_contribution"
  | "loan"
  | "correction";

const transactionTypes: Array<{ value: TransactionType; label: string }> = [
  { value: "income", label: "Income" },
  { value: "expense", label: "Expense" },
  { value: "transfer", label: "Internal transfer" },
  { value: "refund", label: "Refund" },
  { value: "advance", label: "Advance" },
  { value: "employee_advance", label: "Employee advance" },
  { value: "owner_contribution", label: "Owner contribution" },
  { value: "loan", label: "Loan" },
  { value: "correction", label: "Correction" },
];

const accountTypes = [
  { value: "cash", label: "Cash" },
  { value: "bank", label: "Bank" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "other", label: "Other" },
] as const;
type AccountType = (typeof accountTypes)[number]["value"];
const currencies = ["UGX", "USD"] as const;
type Currency = (typeof currencies)[number];

function isAccountType(value: string): value is AccountType {
  return accountTypes.some((option) => option.value === value);
}

function isCurrency(value: string): value is Currency {
  return currencies.some((currency) => currency === value);
}

function isTransactionType(value: string): value is TransactionType {
  return transactionTypes.some((option) => option.value === value);
}

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

function money(amount: number | null, currency: string | null) {
  return `${currency ?? ""} ${Number(amount ?? 0).toLocaleString("en-UG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export const Route = createFileRoute("/_authenticated/finance")({
  head: () => ({ meta: [{ title: "Treasury & Accounts · BMP Media Production" }] }),
  component: Finance,
});

function Finance() {
  const queryClient = useQueryClient();
  const {
    data: ledgerAccounts = [],
    isError: ledgerAccountsFailed,
    error: ledgerAccountsError,
  } = useQuery({
    queryKey: ["accounting-account-balances"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounting_account_balances")
        .select("*")
        .order("account_code");
      if (error) throw error;
      return data;
    },
  });
  const {
    data: journalEntries = [],
    isError: journalEntriesFailed,
    error: journalEntriesError,
  } = useQuery({
    queryKey: ["accounting-journal-summary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounting_journal_summary")
        .select("*")
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return data;
    },
  });
  const [accountName, setAccountName] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("bank");
  const [provider, setProvider] = useState("");
  const [accountCurrency, setAccountCurrency] = useState<Currency>("UGX");
  const [openingBalance, setOpeningBalance] = useState("0");
  const [openingDate, setOpeningDate] = useState(todayInUganda);
  const [accountReason, setAccountReason] = useState("");

  const [transactionAccount, setTransactionAccount] = useState("");
  const [transactionType, setTransactionType] = useState<TransactionType>("income");
  const [direction, setDirection] = useState<"inflow" | "outflow">("inflow");
  const [transactionDate, setTransactionDate] = useState(todayInUganda);
  const [amount, setAmount] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");
  const [exchangeRateDate, setExchangeRateDate] = useState(todayInUganda);
  const [exchangeRateSource, setExchangeRateSource] = useState("");
  const [category, setCategory] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
  const [transferToAccount, setTransferToAccount] = useState("");
  const [transferDestinationAmount, setTransferDestinationAmount] = useState("");
  const [transferDestinationRate, setTransferDestinationRate] = useState("");
  const [transferDestinationRateDate, setTransferDestinationRateDate] = useState(todayInUganda);
  const [transferDestinationRateSource, setTransferDestinationRateSource] = useState("");
  const [transferFee, setTransferFee] = useState("");
  const [transactionProject, setTransactionProject] = useState("");
  const [expenseCostType, setExpenseCostType] = useState<"direct" | "general">("general");
  const [reconciliationAccount, setReconciliationAccount] = useState("");
  const [reconciliationStart, setReconciliationStart] = useState(todayInUganda);
  const [reconciliationEnd, setReconciliationEnd] = useState(todayInUganda);
  const [statementOpening, setStatementOpening] = useState("");
  const [statementClosing, setStatementClosing] = useState("");
  const [reconciliationNotes, setReconciliationNotes] = useState("");
  const [selectedReconciliationId, setSelectedReconciliationId] = useState("");

  const {
    data: accounts = [],
    isLoading: loadingAccounts,
    isError: accountsFailed,
    error: accountsError,
  } = useQuery({
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
  const {
    data: projects = [],
    isError: projectsFailed,
    error: projectsError,
  } = useQuery({
    queryKey: ["business-projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, project_code, service, status")
        .neq("status", "cancelled")
        .order("project_code");
      if (error) throw error;
      return data;
    },
  });
  const {
    data: reconciliations = [],
    isLoading: loadingReconciliations,
    isError: reconciliationsFailed,
    error: reconciliationsError,
  } = useQuery({
    queryKey: ["financial-reconciliations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_reconciliations")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const selectedReconciliation =
    reconciliations.find((item) => item.id === selectedReconciliationId) ?? null;
  const {
    data: reconciliationItems = [],
    isLoading: loadingReconciliationItems,
    isError: reconciliationItemsFailed,
    error: reconciliationItemsError,
  } = useQuery({
    queryKey: ["financial-reconciliation-items", selectedReconciliationId],
    enabled: Boolean(selectedReconciliationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_reconciliation_items")
        .select("*")
        .eq("reconciliation_id", selectedReconciliationId);
      if (error) throw error;
      return data;
    },
  });
  const {
    data: reconciliationTransactions = [],
    isLoading: loadingReconciliationTransactions,
    isError: reconciliationTransactionsFailed,
    error: reconciliationTransactionsError,
  } = useQuery({
    queryKey: [
      "financial-reconciliation-transactions",
      selectedReconciliation?.account_id,
      selectedReconciliation?.period_start,
      selectedReconciliation?.period_end,
    ],
    enabled: Boolean(selectedReconciliation),
    queryFn: async () => {
      if (!selectedReconciliation) return [];
      const { data, error } = await supabase
        .from("financial_transactions")
        .select("*")
        .gte("transaction_date", selectedReconciliation.period_start)
        .lte("transaction_date", selectedReconciliation.period_end)
        .or(
          `account_id.eq.${selectedReconciliation.account_id},transfer_to_account_id.eq.${selectedReconciliation.account_id}`,
        )
        .order("transaction_date", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
  const {
    data: transactions = [],
    isLoading: loadingTransactions,
    isError: transactionsFailed,
    error: transactionsError,
  } = useQuery({
    queryKey: ["financial-transactions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_transactions")
        .select("*")
        .order("transaction_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });
  const {
    data: auditEntries = [],
    isLoading: loadingAudit,
    isError: auditFailed,
    error: auditError,
  } = useQuery({
    queryKey: ["financial-audit-log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_audit_log")
        .select("*")
        .order("changed_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data;
    },
  });

  const createAccount = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("financial_accounts").insert({
        name: accountName.trim(),
        account_type: accountType,
        provider: provider.trim() || null,
        currency: accountCurrency,
        opening_balance: Number(openingBalance),
        opening_balance_date: openingDate,
        notes: accountReason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setAccountName("");
      setProvider("");
      setOpeningBalance("0");
      setAccountReason("");
      await queryClient.invalidateQueries({ queryKey: ["financial-account-balances"] });
      await queryClient.invalidateQueries({ queryKey: ["financial-audit-log"] });
      toast.success("Account created and recorded in the audit log.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const recordTransaction = useMutation({
    mutationFn: async () => {
      const sourceAccount = accounts.find((item) => item.id === transactionAccount);
      if (!sourceAccount?.id || !sourceAccount.currency) {
        throw new Error("Choose an active financial account.");
      }
      const isTransfer = transactionType === "transfer";
      if (transactionType === "expense" && expenseCostType === "direct" && !transactionProject) {
        throw new Error("Choose a project for a direct expense.");
      }
      const targetAccount = isTransfer
        ? accounts.find((item) => item.id === transferToAccount)
        : undefined;
      if (isTransfer && !targetAccount?.id) {
        throw new Error("Choose a destination account.");
      }
      const rate = sourceAccount.currency === "UGX" ? 1 : Number(exchangeRate);
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error("Enter a documented exchange rate greater than zero.");
      }

      if (isTransfer) {
        const destinationAccount = targetAccount;
        if (!destinationAccount?.id) {
          throw new Error("Choose a destination account.");
        }
        const destinationRate =
          destinationAccount.currency === "UGX"
            ? 1
            : destinationAccount.currency === sourceAccount.currency
              ? rate
              : Number(transferDestinationRate);
        const destinationAmount =
          sourceAccount.currency === destinationAccount.currency
            ? Number(amount)
            : Number(transferDestinationAmount);
        if (!Number.isFinite(destinationAmount) || destinationAmount <= 0) {
          throw new Error("Enter a destination amount greater than zero.");
        }
        if (!Number.isFinite(destinationRate) || destinationRate <= 0) {
          throw new Error("Enter the destination account's documented UGX exchange rate.");
        }
        const fee = transferFee.trim() ? Number(transferFee) : 0;
        if (!Number.isFinite(fee) || fee < 0) {
          throw new Error("Transfer fee cannot be negative.");
        }
        if (
          sourceAccount.currency === destinationAccount.currency &&
          destinationAmount !== Number(amount)
        ) {
          throw new Error(
            "Same-currency transfers must use the same source and destination amount.",
          );
        }
        const { error } = await supabase.rpc("post_cross_currency_transfer", {
          p_source_account_id: sourceAccount.id,
          p_destination_account_id: destinationAccount.id,
          p_transfer_date: transactionDate,
          p_source_amount: Number(amount),
          p_destination_amount: destinationAmount,
          p_source_exchange_rate: rate,
          p_source_exchange_rate_date:
            sourceAccount.currency === "UGX" ? transactionDate : exchangeRateDate,
          p_source_exchange_rate_source:
            sourceAccount.currency === "UGX" ? "UGX base currency" : exchangeRateSource.trim(),
          p_destination_exchange_rate: destinationRate,
          p_destination_exchange_rate_date:
            destinationAccount.currency === "UGX"
              ? transactionDate
              : sourceAccount.currency === destinationAccount.currency
                ? exchangeRateDate
                : transferDestinationRateDate,
          p_destination_exchange_rate_source:
            destinationAccount.currency === "UGX"
              ? "UGX base currency"
              : sourceAccount.currency === destinationAccount.currency
                ? exchangeRateSource.trim()
                : transferDestinationRateSource.trim(),
          p_fee_amount: fee,
          p_reference: reference.trim() || null,
          p_description: description.trim(),
          p_reason: reason.trim(),
        });
        if (error) throw error;
        return;
      }

      const { error } = await supabase.from("financial_transactions").insert({
        account_id: sourceAccount.id,
        transfer_to_account_id: targetAccount?.id ?? null,
        transaction_date: transactionDate,
        transaction_type: transactionType,
        direction: isTransfer ? "outflow" : direction,
        amount: Number(amount),
        currency: sourceAccount.currency,
        exchange_rate: rate,
        exchange_rate_date: sourceAccount.currency === "UGX" ? transactionDate : exchangeRateDate,
        exchange_rate_source:
          sourceAccount.currency === "UGX" ? "UGX base currency" : exchangeRateSource.trim(),
        category: category.trim(),
        counterparty: counterparty.trim() || null,
        reference: reference.trim() || null,
        description: description.trim(),
        reason: reason.trim(),
        project_id: isTransfer
          ? null
          : transactionType === "expense"
            ? expenseCostType === "direct"
              ? transactionProject
              : null
            : transactionProject || null,
        cost_type: transactionType === "expense" ? expenseCostType : null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setAmount("");
      setCategory("");
      setCounterparty("");
      setReference("");
      setDescription("");
      setReason("");
      setExchangeRate("");
      setExchangeRateSource("");
      setTransferToAccount("");
      setTransferDestinationAmount("");
      setTransferDestinationRate("");
      setTransferDestinationRateDate(todayInUganda());
      setTransferDestinationRateSource("");
      setTransferFee("");
      setTransactionProject("");
      await queryClient.invalidateQueries({ queryKey: ["financial-account-balances"] });
      await queryClient.invalidateQueries({ queryKey: ["financial-transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["financial-audit-log"] });
      toast.success("Transaction recorded. Posted entries cannot be edited or deleted.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const createReconciliation = useMutation({
    mutationFn: async () => {
      if (!reconciliationAccount) throw new Error("Choose an account to reconcile.");
      const { data, error } = await supabase
        .from("financial_reconciliations")
        .insert({
          account_id: reconciliationAccount,
          period_start: reconciliationStart,
          period_end: reconciliationEnd,
          statement_opening_balance: Number(statementOpening),
          statement_closing_balance: Number(statementClosing),
          notes: reconciliationNotes.trim(),
        })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async (created) => {
      setSelectedReconciliationId(created.id);
      setStatementOpening("");
      setStatementClosing("");
      setReconciliationNotes("");
      await queryClient.invalidateQueries({ queryKey: ["financial-reconciliations"] });
      toast.success("Statement period created. Match its transactions to continue.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const matchReconciliationTransaction = useMutation({
    mutationFn: async (transactionId: string) => {
      if (!selectedReconciliation) throw new Error("Choose an open reconciliation.");
      const transaction = reconciliationTransactions.find((item) => item.id === transactionId);
      if (!transaction) throw new Error("Transaction is no longer available for matching.");
      const amount =
        transaction.transfer_to_account_id === selectedReconciliation.account_id
          ? Number(transaction.transfer_to_amount ?? transaction.amount)
          : transaction.direction === "inflow"
            ? Number(transaction.amount)
            : -Number(transaction.amount);
      const { error } = await supabase.from("financial_reconciliation_items").insert({
        reconciliation_id: selectedReconciliation.id,
        transaction_id: transaction.id,
        statement_reference: transaction.reference,
        statement_date: transaction.transaction_date,
        statement_amount: amount,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["financial-reconciliation-items", selectedReconciliationId],
      });
      toast.success("Transaction matched to the statement.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeReconciliationMatch = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase
        .from("financial_reconciliation_items")
        .delete()
        .eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["financial-reconciliation-items", selectedReconciliationId],
      });
      toast.success("Match removed from the open reconciliation.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const finalizeReconciliation = useMutation({
    mutationFn: async () => {
      if (!selectedReconciliation) throw new Error("Choose an open reconciliation.");
      const { error } = await supabase.rpc("finalize_financial_reconciliation", {
        p_reconciliation_id: selectedReconciliation.id,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["financial-reconciliations"] });
      toast.success("Reconciliation finalized and locked.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const inputClass =
    "w-full rounded-sm border border-input bg-card px-3 py-2 text-sm text-foreground";
  const selectedAccount = accounts.find((account) => account.id === transactionAccount);
  const transferAccounts = accounts.filter((account) => account.id !== transactionAccount);
  const selectedTransferAccount = accounts.find((account) => account.id === transferToAccount);
  const isTransfer = transactionType === "transfer";
  const matchedIds = new Set(reconciliationItems.map((item) => item.transaction_id));
  const unmatchedReconciliationTransactions = reconciliationTransactions.filter(
    (transaction) => !matchedIds.has(transaction.id),
  );
  const matchedStatementMovement = reconciliationItems.reduce(
    (total, item) => total + Number(item.statement_amount),
    0,
  );
  const reconciliationDifference = selectedReconciliation
    ? Number(selectedReconciliation.statement_closing_balance) -
      Number(selectedReconciliation.statement_opening_balance) -
      matchedStatementMovement
    : 0;

  return (
    <AppShell title="Treasury & Accounts">
      <div className="space-y-6">
        <p className="rounded-sm border-l-4 border-primary bg-accent p-4 text-sm text-accent-foreground">
          Account balances are kept separate by currency. USD entries require the actual exchange
          rate, date, and source; no rate is assumed. Transactions and their audit records are
          append-only. Internal transfers may cross currencies only when the received amount and
          documented exchange-rate sources are supplied; fees are recorded separately. Match posted
          transactions to bank or mobile-money statements before finalizing a reconciliation.
        </p>

        {(accountsFailed ||
          transactionsFailed ||
          projectsFailed ||
          auditFailed ||
          ledgerAccountsFailed ||
          journalEntriesFailed ||
          reconciliationsFailed ||
          reconciliationItemsFailed ||
          reconciliationTransactionsFailed) && (
          <div
            role="alert"
            className="rounded-sm border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
          >
            Treasury data could not be loaded:{" "}
            {[
              accountsError,
              transactionsError,
              projectsError,
              auditError,
              ledgerAccountsError,
              journalEntriesError,
              reconciliationsError,
              reconciliationItemsError,
              reconciliationTransactionsError,
            ]
              .filter(Boolean)
              .map((error) => (error instanceof Error ? error.message : String(error)))
              .join(" ")}
          </div>
        )}

        <section className="space-y-3">
          <div>
            <h2 className="signage text-xl text-navy">Accounts</h2>
            <p className="text-sm text-muted-foreground">
              Cash on hand, bank accounts, MTN Mobile Money, and Airtel Money balances by currency.
            </p>
          </div>
          {loadingAccounts ? (
            <p className="text-sm text-muted-foreground">Loading accounts…</p>
          ) : accounts.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {accounts.map((account) => (
                <article key={account.id} className="rounded-sm border bg-card p-4">
                  <p className="font-semibold">{account.name}</p>
                  <p className="mt-1 text-xs capitalize text-muted-foreground">
                    {account.account_type.replace("_", " ")}
                    {account.provider ? ` · ${account.provider}` : ""}
                  </p>
                  <p className="signage mt-3 text-2xl text-navy">
                    {money(account.current_balance, account.currency)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Opening balance {money(account.opening_balance, account.currency)} as of{" "}
                    {account.opening_balance_date}
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <p className="rounded-sm border bg-card p-4 text-sm text-muted-foreground">
              No accounts yet. Add the opening account balances after checking them against approved
              statements.
            </p>
          )}
        </section>

        <div className="grid gap-6 xl:grid-cols-2">
          <section className="space-y-4 rounded-sm border bg-card p-4 sm:p-5">
            <div>
              <h2 className="signage text-xl text-navy">Add account</h2>
              <p className="text-sm text-muted-foreground">
                Account creation and opening balances are recorded in the audit trail.
              </p>
            </div>
            <form
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                createAccount.mutate();
              }}
            >
              <label className="space-y-1 text-sm font-medium">
                Account name
                <input
                  required
                  className={inputClass}
                  value={accountName}
                  onChange={(event) => setAccountName(event.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Account type
                <StyledSelect
                  ariaLabel="Account type"
                  value={accountType}
                  onChange={(value) => {
                    if (isAccountType(value)) setAccountType(value);
                  }}
                  options={[...accountTypes]}
                  className={inputClass}
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Currency
                <StyledSelect
                  ariaLabel="Account currency"
                  value={accountCurrency}
                  onChange={(value) => {
                    if (isCurrency(value)) setAccountCurrency(value);
                  }}
                  options={currencies.map((currency) => ({ value: currency, label: currency }))}
                  className={inputClass}
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Institution / provider
                <input
                  className={inputClass}
                  value={provider}
                  onChange={(event) => setProvider(event.target.value)}
                  list="treasury-providers"
                  placeholder="Bank, MTN Mobile Money, Airtel Money…"
                />
                <datalist id="treasury-providers">
                  <option value="MTN Mobile Money" />
                  <option value="Airtel Money" />
                </datalist>
              </label>
              <label className="space-y-1 text-sm font-medium">
                Opening balance
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  className={inputClass}
                  value={openingBalance}
                  onChange={(event) => setOpeningBalance(event.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Opening balance date
                <input
                  required
                  type="date"
                  className={inputClass}
                  value={openingDate}
                  onChange={(event) => setOpeningDate(event.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm font-medium sm:col-span-2">
                Reason / source for opening balance
                <input
                  required
                  className={inputClass}
                  value={accountReason}
                  onChange={(event) => setAccountReason(event.target.value)}
                />
              </label>
              <button
                type="submit"
                disabled={createAccount.isPending}
                className="rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60 sm:col-span-2"
              >
                {createAccount.isPending ? "Saving…" : "Add account"}
              </button>
            </form>
          </section>

          <section className="space-y-4 rounded-sm border bg-card p-4 sm:p-5">
            <div>
              <h2 className="signage text-xl text-navy">Record transaction</h2>
              <p className="text-sm text-muted-foreground">
                New posted transactions are immutable; use a correction entry if needed.
              </p>
            </div>
            <form
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                recordTransaction.mutate();
              }}
            >
              <label className="space-y-1 text-sm font-medium">
                Transaction type
                <StyledSelect
                  ariaLabel="Transaction type"
                  value={transactionType}
                  onChange={(value) => {
                    if (!isTransactionType(value)) return;
                    const nextType = value;
                    setTransactionType(nextType);
                    if (nextType === "transfer") setDirection("outflow");
                    if (nextType !== "expense") setTransactionProject("");
                  }}
                  options={transactionTypes}
                  className={inputClass}
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                {isTransfer ? "Source account" : "Account"}
                <StyledSelect
                  ariaLabel={isTransfer ? "Source account" : "Account"}
                  value={transactionAccount}
                  onChange={(value) => {
                    setTransactionAccount(value);
                    setTransferToAccount("");
                  }}
                  placeholder="Choose an account"
                  options={accounts
                    .filter((account) => account.id && account.currency)
                    .map((account) => ({
                      value: account.id!,
                      label: `${account.name} · ${account.currency}`,
                    }))}
                  className={inputClass}
                />
              </label>
              {isTransfer && (
                <label className="space-y-1 text-sm font-medium">
                  Destination account
                  <StyledSelect
                    ariaLabel="Destination account"
                    value={transferToAccount}
                    onChange={(value) => {
                      setTransferToAccount(value);
                      setTransferDestinationAmount("");
                      setTransferDestinationRate("");
                      setTransferDestinationRateSource("");
                    }}
                    placeholder="Choose an account"
                    options={transferAccounts
                      .filter((account) => account.id)
                      .map((account) => ({
                        value: account.id!,
                        label: `${account.name} · ${account.currency}`,
                      }))}
                    className={inputClass}
                  />
                </label>
              )}
              {isTransfer && selectedTransferAccount?.currency !== selectedAccount?.currency && (
                <label className="space-y-1 text-sm font-medium">
                  Amount received ({selectedTransferAccount?.currency ?? "destination currency"})
                  <input
                    required
                    type="number"
                    min="0.01"
                    step="0.01"
                    className={inputClass}
                    value={transferDestinationAmount}
                    onChange={(event) => setTransferDestinationAmount(event.target.value)}
                  />
                </label>
              )}
              {isTransfer && (
                <label className="space-y-1 text-sm font-medium">
                  Transfer fee ({selectedAccount?.currency ?? "source currency"})
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className={inputClass}
                    value={transferFee}
                    onChange={(event) => setTransferFee(event.target.value)}
                    placeholder="0.00"
                  />
                </label>
              )}
              {!isTransfer && (
                <label className="space-y-1 text-sm font-medium">
                  Direction
                  <StyledSelect
                    ariaLabel="Transaction direction"
                    value={direction}
                    onChange={(value) => setDirection(value as "inflow" | "outflow")}
                    options={[
                      { value: "inflow", label: "Money in" },
                      { value: "outflow", label: "Money out" },
                    ]}
                    className={inputClass}
                  />
                </label>
              )}
              {!isTransfer && transactionType === "expense" && (
                <label className="space-y-1 text-sm font-medium">
                  Expense classification
                  <StyledSelect
                    ariaLabel="Expense classification"
                    value={expenseCostType}
                    onChange={(value) => {
                      if (value === "direct" || value === "general") {
                        setExpenseCostType(value);
                        if (value === "general") setTransactionProject("");
                      }
                    }}
                    options={[
                      { value: "direct", label: "Direct project cost" },
                      { value: "general", label: "General cost" },
                    ]}
                    className={inputClass}
                  />
                </label>
              )}
              {!isTransfer && (transactionType !== "expense" || expenseCostType === "direct") && (
                <label className="space-y-1 text-sm font-medium">
                  {transactionType === "expense" ? "Direct cost project" : "Project (optional)"}
                  <StyledSelect
                    ariaLabel={transactionType === "expense" ? "Direct cost project" : "Project"}
                    value={transactionProject}
                    onChange={setTransactionProject}
                    placeholder="Choose a project"
                    options={projects
                      .filter((project) => project.id)
                      .map((project) => ({
                        value: project.id,
                        label: `${project.project_code} · ${project.service}`,
                      }))}
                    className={inputClass}
                  />
                </label>
              )}
              <label className="space-y-1 text-sm font-medium">
                Date
                <input
                  required
                  type="date"
                  className={inputClass}
                  value={transactionDate}
                  onChange={(event) => {
                    setTransactionDate(event.target.value);
                    if (selectedAccount?.currency === "UGX")
                      setExchangeRateDate(event.target.value);
                  }}
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Amount {selectedAccount?.currency ? `(${selectedAccount.currency})` : ""}
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  className={inputClass}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Category
                <input
                  required
                  className={inputClass}
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  placeholder="e.g. Production costs"
                />
              </label>
              {selectedAccount?.currency === "USD" ? (
                <>
                  <label className="space-y-1 text-sm font-medium">
                    UGX per USD exchange rate
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
                    Exchange-rate date
                    <input
                      required
                      type="date"
                      className={inputClass}
                      value={exchangeRateDate}
                      onChange={(event) => setExchangeRateDate(event.target.value)}
                    />
                  </label>
                  <label className="space-y-1 text-sm font-medium sm:col-span-2">
                    Exchange-rate source
                    <input
                      required
                      className={inputClass}
                      value={exchangeRateSource}
                      onChange={(event) => setExchangeRateSource(event.target.value)}
                      placeholder="Bank statement, payment provider, or approved policy"
                    />
                  </label>
                </>
              ) : (
                <p className="self-end rounded-sm bg-secondary p-2 text-xs text-muted-foreground">
                  UGX is the functional currency; no conversion rate is applied.
                </p>
              )}
              {isTransfer &&
                selectedTransferAccount?.currency === "USD" &&
                selectedTransferAccount.currency !== selectedAccount?.currency && (
                  <>
                    <label className="space-y-1 text-sm font-medium">
                      Destination UGX per USD exchange rate
                      <input
                        required
                        type="number"
                        min="0.00000001"
                        step="0.00000001"
                        className={inputClass}
                        value={transferDestinationRate}
                        onChange={(event) => setTransferDestinationRate(event.target.value)}
                      />
                    </label>
                    <label className="space-y-1 text-sm font-medium">
                      Destination rate date
                      <input
                        required
                        type="date"
                        className={inputClass}
                        value={transferDestinationRateDate}
                        onChange={(event) => setTransferDestinationRateDate(event.target.value)}
                      />
                    </label>
                    <label className="space-y-1 text-sm font-medium sm:col-span-2">
                      Destination rate source
                      <input
                        required
                        className={inputClass}
                        value={transferDestinationRateSource}
                        onChange={(event) => setTransferDestinationRateSource(event.target.value)}
                        placeholder="Receiving bank statement or approved rate source"
                      />
                    </label>
                  </>
                )}
              <label className="space-y-1 text-sm font-medium">
                Counterparty
                <input
                  className={inputClass}
                  value={counterparty}
                  onChange={(event) => setCounterparty(event.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Reference
                <input
                  className={inputClass}
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm font-medium sm:col-span-2">
                Description
                <input
                  required
                  className={inputClass}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm font-medium sm:col-span-2">
                Audit reason / source
                <input
                  required
                  className={inputClass}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <button
                type="submit"
                disabled={
                  recordTransaction.isPending ||
                  !accounts.length ||
                  !transactionAccount ||
                  (isTransfer && !transferToAccount) ||
                  (isTransfer &&
                    selectedTransferAccount?.currency !== selectedAccount?.currency &&
                    !transferDestinationAmount) ||
                  (transactionType === "expense" &&
                    expenseCostType === "direct" &&
                    !transactionProject)
                }
                className="rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60 sm:col-span-2"
              >
                {recordTransaction.isPending ? "Saving…" : "Post transaction"}
              </button>
            </form>
          </section>
        </div>

        <section className="space-y-4 rounded-sm border bg-card p-4 sm:p-5">
          <div>
            <h2 className="signage text-xl text-navy">Double-entry ledger</h2>
            <p className="text-sm text-muted-foreground">
              Posted cash movements create balanced, immutable journal entries. Ledger balances
              remain separated by currency; USD is not added to UGX without a documented conversion.
            </p>
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            <div className="space-y-2">
              <h3 className="font-semibold">Chart of accounts</h3>
              {ledgerAccounts.length === 0 ? (
                <p className="rounded-sm border p-3 text-sm text-muted-foreground">
                  Chart accounts are created as financial accounts and transaction categories are
                  posted.
                </p>
              ) : (
                <div className="max-h-80 overflow-auto rounded-sm border">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-secondary text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="p-2">Code</th>
                        <th className="p-2">Account</th>
                        <th className="p-2">Type</th>
                        <th className="p-2 text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledgerAccounts.map((account) => (
                        <tr key={account.id} className="border-t">
                          <td className="p-2 font-mono">{account.account_code}</td>
                          <td className="p-2">{account.name}</td>
                          <td className="p-2 capitalize">{account.account_type}</td>
                          <td className="p-2 text-right font-medium">
                            {money(account.balance, account.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <h3 className="font-semibold">Recent journal entries</h3>
              {journalEntries.length === 0 ? (
                <p className="rounded-sm border p-3 text-sm text-muted-foreground">
                  New financial transactions will appear here after the accounting migration is
                  applied.
                </p>
              ) : (
                <div className="max-h-80 overflow-auto rounded-sm border">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-secondary text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="p-2">Date / description</th>
                        <th className="p-2">Source</th>
                        <th className="p-2 text-right">Debit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {journalEntries.map((entry) => (
                        <tr key={entry.id} className="border-t">
                          <td className="p-2">
                            <span className="block">{entry.entry_date}</span>
                            <span className="text-xs text-muted-foreground">
                              {entry.description}
                            </span>
                          </td>
                          <td className="p-2 capitalize">
                            {entry.source_type.replaceAll("_", " ")}
                          </td>
                          <td className="p-2 text-right font-medium">
                            {money(entry.total_debits, entry.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-sm border bg-card p-4 sm:p-5">
          <div>
            <h2 className="signage text-xl text-navy">Settlements & statement reconciliation</h2>
            <p className="text-sm text-muted-foreground">
              Reconcile cashbooks, bank statements, and mobile-money statements by account and
              period. A reconciliation locks only when every posted account movement is matched and
              the statement closing balance agrees. Record missing statement fees or other unmatched
              lines as transactions first; differences must not be hidden with a forced adjustment.
            </p>
          </div>

          <form
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
            onSubmit={(event) => {
              event.preventDefault();
              createReconciliation.mutate();
            }}
          >
            <label className="space-y-1 text-sm font-medium">
              Account
              <StyledSelect
                ariaLabel="Reconciliation account"
                value={reconciliationAccount}
                onChange={setReconciliationAccount}
                placeholder="Choose an account"
                options={accounts
                  .filter((account) => account.id)
                  .map((account) => ({
                    value: account.id!,
                    label: `${account.name} · ${account.currency}`,
                  }))}
                className={inputClass}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Statement period start
              <input
                required
                type="date"
                className={inputClass}
                value={reconciliationStart}
                onChange={(event) => setReconciliationStart(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Statement period end
              <input
                required
                type="date"
                min={reconciliationStart}
                className={inputClass}
                value={reconciliationEnd}
                onChange={(event) => setReconciliationEnd(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Statement opening balance
              <input
                required
                type="number"
                min="0"
                step="0.01"
                className={inputClass}
                value={statementOpening}
                onChange={(event) => setStatementOpening(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Statement closing balance
              <input
                required
                type="number"
                min="0"
                step="0.01"
                className={inputClass}
                value={statementClosing}
                onChange={(event) => setStatementClosing(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Statement source / note
              <input
                required
                className={inputClass}
                value={reconciliationNotes}
                onChange={(event) => setReconciliationNotes(event.target.value)}
                placeholder="e.g. bank statement number or wallet report"
              />
            </label>
            <button
              type="submit"
              disabled={
                createReconciliation.isPending ||
                !reconciliationAccount ||
                reconciliationEnd < reconciliationStart
              }
              className="rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60 sm:col-span-2 xl:col-span-3"
            >
              {createReconciliation.isPending ? "Saving…" : "Start reconciliation"}
            </button>
          </form>

          {loadingReconciliations ? (
            <p className="text-sm text-muted-foreground">Loading reconciliation history…</p>
          ) : reconciliations.length ? (
            <div className="flex flex-wrap gap-2">
              {reconciliations.map((item) => {
                const account = accounts.find((candidate) => candidate.id === item.account_id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedReconciliationId(item.id)}
                    className={`rounded-sm border px-3 py-2 text-left text-sm ${
                      selectedReconciliationId === item.id
                        ? "border-primary bg-accent"
                        : "hover:bg-secondary"
                    }`}
                  >
                    <span className="block font-semibold">
                      {account?.name ?? "Account"} · {item.period_start} – {item.period_end}
                    </span>
                    <span className="text-xs capitalize text-muted-foreground">
                      {item.status} · {item.notes}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No statement reconciliations yet.</p>
          )}

          {selectedReconciliation && (
            <div className="space-y-4 rounded-sm border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">
                    {accounts.find((item) => item.id === selectedReconciliation.account_id)?.name ??
                      "Account"}{" "}
                    · {selectedReconciliation.period_start} – {selectedReconciliation.period_end}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Opening{" "}
                    {money(
                      selectedReconciliation.statement_opening_balance,
                      accounts.find((item) => item.id === selectedReconciliation.account_id)
                        ?.currency ?? null,
                    )}
                    {" · "}Statement closing{" "}
                    {money(
                      selectedReconciliation.statement_closing_balance,
                      accounts.find((item) => item.id === selectedReconciliation.account_id)
                        ?.currency ?? null,
                    )}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selectedReconciliation.notes}
                  </p>
                </div>
                <div className="text-right text-sm">
                  <p>
                    {reconciliationItems.length} matched ·{" "}
                    {unmatchedReconciliationTransactions.length} unmatched
                  </p>
                  <p
                    className={
                      reconciliationDifference === 0
                        ? "font-semibold text-green-700"
                        : "font-semibold text-destructive"
                    }
                  >
                    Difference{" "}
                    {money(
                      reconciliationDifference,
                      accounts.find((item) => item.id === selectedReconciliation.account_id)
                        ?.currency ?? null,
                    )}
                  </p>
                </div>
              </div>
              {loadingReconciliationItems || loadingReconciliationTransactions ? (
                <p className="text-sm text-muted-foreground">Loading statement transactions…</p>
              ) : reconciliationTransactions.length ? (
                <div className="overflow-x-auto rounded-sm border">
                  <table className="w-full min-w-[700px] text-left text-sm">
                    <thead className="bg-secondary text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="p-3">Date</th>
                        <th className="p-3">Transaction</th>
                        <th className="p-3">Reference / details</th>
                        <th className="p-3">Statement movement</th>
                        <th className="p-3">Match</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {reconciliationTransactions.map((transaction) => {
                        const matched = reconciliationItems.find(
                          (item) => item.transaction_id === transaction.id,
                        );
                        const incomingTransfer =
                          transaction.transfer_to_account_id === selectedReconciliation.account_id;
                        const signedAmount =
                          incomingTransfer || transaction.direction === "inflow"
                            ? incomingTransfer
                              ? Number(transaction.transfer_to_amount ?? transaction.amount)
                              : Number(transaction.amount)
                            : -Number(transaction.amount);
                        return (
                          <tr key={transaction.id}>
                            <td className="p-3">{transaction.transaction_date}</td>
                            <td className="p-3 capitalize">
                              {transaction.transaction_type.replace("_", " ")}
                            </td>
                            <td className="p-3">
                              <span className="block">
                                {transaction.reference || "No reference"}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {transaction.description}
                              </span>
                            </td>
                            <td className="p-3">
                              {money(
                                signedAmount,
                                accounts.find(
                                  (item) => item.id === selectedReconciliation.account_id,
                                )?.currency ?? null,
                              )}
                            </td>
                            <td className="p-3">
                              {matched ? (
                                selectedReconciliation.status === "open" ? (
                                  <button
                                    type="button"
                                    disabled={removeReconciliationMatch.isPending}
                                    onClick={() => removeReconciliationMatch.mutate(matched.id)}
                                    className="font-semibold text-primary hover:underline disabled:opacity-60"
                                  >
                                    Matched · Remove
                                  </button>
                                ) : (
                                  <span className="font-semibold text-green-700">Matched</span>
                                )
                              ) : (
                                <button
                                  type="button"
                                  disabled={
                                    selectedReconciliation.status !== "open" ||
                                    matchReconciliationTransaction.isPending
                                  }
                                  onClick={() =>
                                    matchReconciliationTransaction.mutate(transaction.id)
                                  }
                                  className="font-semibold text-primary hover:underline disabled:opacity-60"
                                >
                                  Match
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No posted transactions fall within this statement period.
                </p>
              )}
              {selectedReconciliation.status === "open" && (
                <button
                  type="button"
                  disabled={
                    finalizeReconciliation.isPending ||
                    unmatchedReconciliationTransactions.length > 0 ||
                    reconciliationDifference !== 0 ||
                    reconciliationItemsFailed ||
                    reconciliationTransactionsFailed
                  }
                  onClick={() => finalizeReconciliation.mutate()}
                  className="rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {finalizeReconciliation.isPending ? "Finalizing…" : "Finalize and lock"}
                </button>
              )}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="signage text-xl text-navy">Recent transactions</h2>
            <p className="text-sm text-muted-foreground">
              Latest 50 entries. Amounts are shown in original currency; the UGX equivalent is
              recorded alongside each transaction.
            </p>
          </div>
          {loadingTransactions ? (
            <p className="text-sm text-muted-foreground">Loading transactions…</p>
          ) : transactions.length ? (
            <div className="overflow-x-auto rounded-sm border bg-card">
              <table className="w-full min-w-[780px] text-left text-sm">
                <thead className="bg-secondary text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="p-3">Date / Type</th>
                    <th className="p-3">Account</th>
                    <th className="p-3">Category / Details</th>
                    <th className="p-3">Original amount</th>
                    <th className="p-3">UGX equivalent</th>
                    <th className="p-3">FX source</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {transactions.map((transaction) => {
                    const account = accounts.find((item) => item.id === transaction.account_id);
                    const destination = accounts.find(
                      (item) => item.id === transaction.transfer_to_account_id,
                    );
                    return (
                      <tr key={transaction.id}>
                        <td className="p-3">
                          <span className="block">{transaction.transaction_date}</span>
                          <span className="text-xs capitalize text-muted-foreground">
                            {transaction.transaction_type.replace("_", " ")} ·{" "}
                            {transaction.direction}
                          </span>
                        </td>
                        <td className="p-3">
                          {account?.name ?? "Unknown account"}
                          {destination ? ` → ${destination.name}` : ""}
                        </td>
                        <td className="p-3">
                          <span className="block">{transaction.category}</span>
                          <span className="text-xs text-muted-foreground">
                            {transaction.description}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className="block">
                            {money(transaction.amount, transaction.currency)}
                          </span>
                          {destination && (
                            <span className="block text-xs text-muted-foreground">
                              Received:{" "}
                              {money(
                                transaction.transfer_to_amount ?? transaction.amount,
                                destination.currency,
                              )}
                            </span>
                          )}
                        </td>
                        <td className="p-3">{money(transaction.amount_ugx, "UGX")}</td>
                        <td className="p-3 text-xs">
                          {transaction.exchange_rate_source}
                          {transaction.currency === "USD" && (
                            <span className="block text-muted-foreground">
                              {transaction.exchange_rate} · {transaction.exchange_rate_date}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rounded-sm border bg-card p-4 text-sm text-muted-foreground">
              No transactions have been posted.
            </p>
          )}
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="signage text-xl text-navy">Audit trail</h2>
            <p className="text-sm text-muted-foreground">
              Account and transaction creation events include the user, time, values, and reason.
            </p>
          </div>
          {loadingAudit ? (
            <p className="text-sm text-muted-foreground">Loading audit trail…</p>
          ) : auditEntries.length ? (
            <div className="divide-y rounded-sm border bg-card">
              {auditEntries.map((entry) => (
                <article key={entry.id} className="grid gap-1 p-3 text-sm sm:grid-cols-[1fr_auto]">
                  <div>
                    <p className="font-semibold">
                      {entry.table_name === "financial_accounts"
                        ? "Financial account created"
                        : "Transaction posted"}
                    </p>
                    <p className="text-muted-foreground">{entry.reason}</p>
                    <p className="text-xs text-muted-foreground">Record {entry.record_id}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(entry.changed_at).toLocaleString("en-UG", {
                      timeZone: "Africa/Kampala",
                    })}
                    <span className="block">User {entry.changed_by}</span>
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <p className="rounded-sm border bg-card p-4 text-sm text-muted-foreground">
              No audit events have been recorded.
            </p>
          )}
        </section>
      </div>
    </AppShell>
  );
}
