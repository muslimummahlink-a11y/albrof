import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { StyledSelect } from "@/components/StyledSelect";
import { supabase } from "@/integrations/supabase/client";
import { devAuthBypass } from "@/lib/dev-auth";
import type { Tables } from "@/integrations/supabase/types";

type ExpenseRequest = Tables<"expense_requests">;
type Currency = "UGX" | "USD";
type ReviewDecision = "approved" | "rejected";

const currencies: Array<{ value: Currency; label: string }> = [
  { value: "UGX", label: "UGX" },
  { value: "USD", label: "USD" },
];

function isCurrency(value: string): value is Currency {
  return value === "UGX" || value === "USD";
}

function money(value: number, currency: string) {
  return `${currency} ${Number(value).toLocaleString("en-UG", {
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

export const Route = createFileRoute("/_authenticated/expenses")({
  head: () => ({ meta: [{ title: "Expenses & approvals · BMP Media Production" }] }),
  component: ExpensesPage,
});

function ExpensesPage() {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState("");
  const [costType, setCostType] = useState<"direct" | "general">("direct");
  const [projectId, setProjectId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [currency, setCurrency] = useState<Currency>("UGX");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayInUganda);
  const [exchangeRate, setExchangeRate] = useState("");
  const [exchangeRateDate, setExchangeRateDate] = useState(todayInUganda);
  const [exchangeRateSource, setExchangeRateSource] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentReason, setPaymentReason] = useState("");
  const inputClass =
    "w-full rounded-sm border border-input bg-card px-3 py-2 text-sm text-foreground";

  const accessQuery = useQuery({
    queryKey: ["expense-access"],
    queryFn: async () => {
      if (devAuthBypass) {
        return { userId: null, canReview: true, isAdmin: true };
      }
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) return { userId: null, canReview: false, isAdmin: false };
      const { data: roles, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", auth.user.id);
      if (error) throw error;
      const roleNames = (roles ?? []).map((role) => role.role);
      return {
        userId: auth.user.id,
        canReview: roleNames.some(
          (role) => role === "admin" || role === "hr" || role === "accountant",
        ),
        isAdmin: roleNames.includes("admin"),
      };
    },
  });
  const requestsQuery = useQuery({
    queryKey: ["expense-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expense_requests")
        .select("*")
        .order("requested_at", { ascending: false });
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
  const accountsQuery = useQuery({
    queryKey: ["financial-account-balances"],
    enabled: Boolean(accessQuery.data?.isAdmin),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_account_balances")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const requests = requestsQuery.data ?? [];
  const projects = projectsQuery.data ?? [];
  const parties = partiesQuery.data ?? [];
  const accounts = accountsQuery.data ?? [];
  const currentUserId = accessQuery.data?.userId ?? null;
  const canReview = accessQuery.data?.canReview ?? false;
  const isAdmin = accessQuery.data?.isAdmin ?? false;
  const selectedRequest = requests.find((request) => request.id === selectedRequestId);
  const availableAccounts = accounts.filter(
    (account) => account.currency === selectedRequest?.currency,
  );
  const selectedAccount = accounts.find((account) => account.id === accountId);

  async function openReceipt(storageKey: string) {
    const { data, error } = await supabase.storage
      .from("expense-receipts")
      .createSignedUrl(storageKey, 60);
    if (error) {
      toast.error(`Receipt could not be opened: ${error.message}`);
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  const submitRequest = useMutation({
    mutationFn: async (formData: FormData) => {
      if (!currentUserId)
        throw new Error("Sign in with an authorised account to submit an expense.");
      const amount = Number(formData.get("amount"));
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Expense amount must be greater than zero.");
      }
      if (!category.trim()) throw new Error("Choose an expense category.");
      if (costType === "direct" && !projectId) {
        throw new Error("Choose a project for a direct project cost.");
      }
      const receiptFile = formData.get("receipt_file");
      const file = receiptFile instanceof File && receiptFile.size > 0 ? receiptFile : null;
      if (
        file &&
        (!["image/jpeg", "image/png", "application/pdf"].includes(file.type) ||
          file.size > 10 * 1024 * 1024)
      ) {
        throw new Error("Receipt must be a JPEG, PNG, or PDF no larger than 10 MB.");
      }
      const { data: request, error } = await supabase
        .from("expense_requests")
        .insert({
          project_id: costType === "direct" ? projectId : null,
          supplier_id: supplierId || null,
          category: category.trim(),
          cost_type: costType,
          description: String(formData.get("description") ?? "").trim(),
          amount,
          currency,
          expected_payment_date: String(formData.get("expected_payment_date") ?? "") || null,
          receipt_reference: file
            ? null
            : String(formData.get("receipt_reference") ?? "").trim() || null,
          requested_by: currentUserId,
          status: "pending",
        })
        .select("id")
        .single();
      if (error) throw error;
      if (file) {
        const safeName = file.name.replace(/[\\/:*?"<>|]/g, "_");
        const storageKey = `${request.id}/${crypto.randomUUID()}-${safeName}`;
        const { error: uploadError } = await supabase.storage
          .from("expense-receipts")
          .upload(storageKey, file, { contentType: file.type, upsert: false });
        if (uploadError) {
          return {
            id: request.id,
            uploadError: `Expense request was submitted, but the receipt upload failed: ${uploadError.message}`,
          };
        }
        const { error: attachError } = await supabase.rpc("attach_expense_receipt", {
          p_request_id: request.id,
          p_storage_key: storageKey,
        });
        if (attachError) {
          return {
            id: request.id,
            uploadError: `Expense request was submitted, but the receipt could not be linked: ${attachError.message}`,
          };
        }
      }
      return { id: request.id, uploadError: null };
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["expense-requests"] });
      if (result.uploadError) toast.error(result.uploadError);
      else toast.success("Expense request submitted for review.");
      document.getElementById("expense-request-form")?.querySelector("form")?.reset();
      setCategory("");
      setCostType("direct");
      setProjectId("");
      setSupplierId("");
      setCurrency("UGX");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const reviewRequest = useMutation({
    mutationFn: async ({
      requestId,
      decision,
    }: {
      requestId: string;
      decision: ReviewDecision;
    }) => {
      const note = reviewNotes[requestId]?.trim() ?? "";
      if (decision === "rejected" && !note) {
        throw new Error("Enter a reason before rejecting a request.");
      }
      const { error } = await supabase.rpc("review_expense_request", {
        p_request_id: requestId,
        p_decision: decision,
        p_manager_note: note,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["expense-requests"] });
      toast.success("Expense request reviewed.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const settleRequest = useMutation({
    mutationFn: async () => {
      if (!selectedRequest || selectedRequest.status !== "approved") {
        throw new Error("Choose an approved expense request.");
      }
      if (!selectedAccount?.id) throw new Error("Choose an account in the request currency.");
      const rate = selectedRequest.currency === "UGX" ? 1 : Number(exchangeRate);
      const rateDate = selectedRequest.currency === "UGX" ? paymentDate : exchangeRateDate;
      const rateSource =
        selectedRequest.currency === "UGX" ? "UGX base currency" : exchangeRateSource.trim();
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error("Enter a documented exchange rate greater than zero.");
      }
      if (!rateSource) throw new Error("Enter the source of the exchange rate.");
      if (!paymentReason.trim()) throw new Error("Add a payment or audit reason.");
      const { error } = await supabase.rpc("settle_expense_request", {
        p_request_id: selectedRequest.id,
        p_account_id: selectedAccount.id,
        p_payment_date: paymentDate,
        p_exchange_rate: rate,
        p_exchange_rate_date: rateDate,
        p_exchange_rate_source: rateSource,
        p_reference: paymentReference.trim() || null,
        p_reason: paymentReason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["expense-requests"] });
      await queryClient.invalidateQueries({ queryKey: ["financial-account-balances"] });
      await queryClient.invalidateQueries({ queryKey: ["financial-transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["financial-audit-log"] });
      toast.success("Expense paid and posted to the financial account.");
      setSelectedRequestId("");
      setAccountId("");
      setExchangeRate("");
      setExchangeRateSource("");
      setPaymentReference("");
      setPaymentReason("");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const errors = [
    accessQuery.error,
    requestsQuery.error,
    projectsQuery.error,
    partiesQuery.error,
    accountsQuery.error,
  ]
    .filter(Boolean)
    .map((error) => (error instanceof Error ? error.message : String(error)));

  return (
    <AppShell title="Expenses & approvals">
      <div className="space-y-6">
        <p className="rounded-sm border-l-4 border-primary bg-accent p-4 text-sm text-accent-foreground">
          Team members submit expenses with a project, category, supplier, and receipt reference.
          Reviewers cannot approve their own requests. Payments are recorded only after approval and
          post to the selected financial account.
        </p>

        {errors.length > 0 && (
          <div
            role="alert"
            className="rounded-sm border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
          >
            Expense data could not be loaded: {errors.join(" ")}
          </div>
        )}

        <section
          id="expense-request-form"
          className="space-y-4 rounded-sm border bg-card p-4 sm:p-5"
        >
          <div>
            <h2 className="signage text-xl text-navy">Submit expense request</h2>
            <p className="text-sm text-muted-foreground">
              A receipt or transaction reference can be included now; private file uploads will need
              a configured document-storage policy.
            </p>
          </div>
          <form
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
            onSubmit={(event) => {
              event.preventDefault();
              submitRequest.mutate(new FormData(event.currentTarget));
            }}
          >
            <label className="space-y-1 text-sm font-medium">
              Cost type
              <StyledSelect
                ariaLabel="Expense cost type"
                value={costType}
                onChange={(value) => {
                  if (value === "direct" || value === "general") setCostType(value);
                  if (value === "general") setProjectId("");
                }}
                options={[
                  { value: "direct", label: "Direct project cost" },
                  { value: "general", label: "General administrative" },
                ]}
                className={inputClass}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Category
              <input
                required
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className={inputClass}
                placeholder="Transport, equipment hire…"
              />
            </label>
            {costType === "direct" && (
              <label className="space-y-1 text-sm font-medium">
                Project
                <StyledSelect
                  ariaLabel="Expense project"
                  value={projectId}
                  onChange={setProjectId}
                  placeholder="Choose an open project"
                  options={projects
                    .filter((project) => !["completed", "cancelled"].includes(project.status))
                    .map((project) => ({
                      value: project.id,
                      label: `${project.project_code} · ${project.service}`,
                    }))}
                  className={inputClass}
                />
              </label>
            )}
            <label className="space-y-1 text-sm font-medium">
              Supplier (optional)
              <StyledSelect
                ariaLabel="Expense supplier"
                value={supplierId}
                onChange={setSupplierId}
                placeholder="Select supplier"
                options={parties
                  .filter((party) => party.party_type === "supplier" || party.party_type === "both")
                  .map((party) => ({ value: party.id, label: party.name }))}
                className={inputClass}
              />
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
                ariaLabel="Expense currency"
                value={currency}
                onChange={(value) => {
                  if (isCurrency(value)) setCurrency(value);
                }}
                options={currencies}
                className={inputClass}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Expected payment date
              <input name="expected_payment_date" type="date" className={inputClass} />
            </label>
            <label className="space-y-1 text-sm font-medium sm:col-span-2 xl:col-span-3">
              Description
              <textarea required name="description" rows={2} className={inputClass} />
            </label>
            <label className="space-y-1 text-sm font-medium sm:col-span-2 xl:col-span-3">
              Receipt / quote / transaction reference
              <input name="receipt_reference" className={inputClass} />
            </label>
            <label className="space-y-1 text-sm font-medium sm:col-span-2 xl:col-span-3">
              Private receipt attachment (JPEG, PNG, or PDF; up to 10 MB)
              <input
                name="receipt_file"
                type="file"
                accept="image/jpeg,image/png,application/pdf"
                className={inputClass}
              />
            </label>
            <button
              type="submit"
              disabled={submitRequest.isPending || (costType === "direct" && projects.length === 0)}
              className="rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60 sm:col-span-2 xl:col-span-3"
            >
              {submitRequest.isPending ? "Submitting…" : "Submit for approval"}
            </button>
          </form>
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="signage text-xl text-navy">Expense requests</h2>
            <p className="text-sm text-muted-foreground">
              Approval and payment status are recorded in the request audit trail.
            </p>
          </div>
          {requestsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading expense requests…</p>
          ) : requests.length === 0 ? (
            <p className="rounded-sm border bg-card p-4 text-sm text-muted-foreground">
              No expense requests yet.
            </p>
          ) : (
            <div className="space-y-3">
              {requests.map((request: ExpenseRequest) => {
                const project = projects.find((item) => item.id === request.project_id);
                const supplier = parties.find((item) => item.id === request.supplier_id);
                const isOwnRequest = request.requested_by === currentUserId;
                const receiptKey = request.receipt_reference?.startsWith(`${request.id}/`)
                  ? request.receipt_reference
                  : null;
                return (
                  <article key={request.id} className="space-y-3 rounded-sm border bg-card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{request.category}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{request.description}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {request.cost_type === "direct"
                            ? `${project?.project_code ?? "Project"} · ${project?.service ?? ""}`
                            : "General administrative"}
                          {supplier ? ` · ${supplier.name}` : ""}
                          {request.receipt_reference && !receiptKey
                            ? ` · Ref: ${request.receipt_reference}`
                            : ""}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">{money(request.amount, request.currency)}</p>
                        <span className="rounded-sm bg-secondary px-2 py-1 text-xs font-bold uppercase">
                          {request.status}
                        </span>
                      </div>
                    </div>

                    {receiptKey && (
                      <button
                        type="button"
                        onClick={() => void openReceipt(receiptKey)}
                        className="text-sm font-semibold text-primary hover:underline"
                      >
                        Open private receipt
                      </button>
                    )}
                    {request.manager_note && (
                      <p className="rounded-sm bg-secondary p-2 text-sm">
                        Review note: {request.manager_note}
                      </p>
                    )}
                    {canReview && request.status === "pending" && (
                      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                        <input
                          aria-label={`Review note for ${request.category}`}
                          placeholder="Reviewer note; required to reject"
                          className={inputClass}
                          value={reviewNotes[request.id] ?? ""}
                          onChange={(event) =>
                            setReviewNotes((current) => ({
                              ...current,
                              [request.id]: event.target.value,
                            }))
                          }
                        />
                        <button
                          type="button"
                          disabled={reviewRequest.isPending || isOwnRequest}
                          onClick={() =>
                            reviewRequest.mutate({ requestId: request.id, decision: "approved" })
                          }
                          className="rounded-sm bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={
                            reviewRequest.isPending ||
                            isOwnRequest ||
                            !reviewNotes[request.id]?.trim()
                          }
                          onClick={() =>
                            reviewRequest.mutate({ requestId: request.id, decision: "rejected" })
                          }
                          className="rounded-sm border border-destructive/40 px-3 py-2 text-sm font-semibold text-destructive disabled:opacity-50"
                        >
                          Reject
                        </button>
                        {isOwnRequest && (
                          <p className="text-xs text-muted-foreground sm:col-span-3">
                            You cannot review your own request.
                          </p>
                        )}
                      </div>
                    )}
                    {isAdmin && request.status === "approved" && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedRequestId(request.id);
                          setAccountId("");
                        }}
                        className="rounded-sm border px-3 py-2 text-sm font-semibold hover:bg-secondary"
                      >
                        {selectedRequestId === request.id
                          ? "Selected for payment"
                          : "Record payment"}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {isAdmin && selectedRequest?.status === "approved" && (
          <section className="space-y-4 rounded-sm border bg-card p-4 sm:p-5">
            <div>
              <h2 className="signage text-xl text-navy">Pay approved expense</h2>
              <p className="text-sm text-muted-foreground">
                {selectedRequest.category} ·{" "}
                {money(selectedRequest.amount, selectedRequest.currency)}
              </p>
            </div>
            <form
              className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
              onSubmit={(event) => {
                event.preventDefault();
                settleRequest.mutate();
              }}
            >
              <label className="space-y-1 text-sm font-medium">
                Paying account ({selectedRequest.currency})
                <StyledSelect
                  ariaLabel="Expense payment account"
                  value={accountId}
                  onChange={setAccountId}
                  placeholder="Choose a matching account"
                  options={availableAccounts
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
                    if (selectedRequest.currency === "UGX") {
                      setExchangeRateDate(event.target.value);
                    }
                  }}
                />
              </label>
              {selectedRequest.currency === "USD" ? (
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
                Payment reference
                <input
                  className={inputClass}
                  value={paymentReference}
                  onChange={(event) => setPaymentReference(event.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm font-medium sm:col-span-2">
                Payment reason / source
                <input
                  required
                  className={inputClass}
                  value={paymentReason}
                  onChange={(event) => setPaymentReason(event.target.value)}
                />
              </label>
              <button
                type="submit"
                disabled={settleRequest.isPending || !accountId}
                className="rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60 sm:col-span-2 xl:col-span-3"
              >
                {settleRequest.isPending ? "Paying…" : "Post payment"}
              </button>
              {selectedAccount && (
                <p className="text-xs text-muted-foreground sm:col-span-2 xl:col-span-3">
                  Payment will be posted to {selectedAccount.name}.
                </p>
              )}
            </form>
          </section>
        )}
      </div>
    </AppShell>
  );
}
