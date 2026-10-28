import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { StyledSelect } from "@/components/StyledSelect";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

type Quotation = Tables<"quotation_totals">;
type Party = Tables<"business_parties">;
type Project = Tables<"projects">;
type QuotationLine = Tables<"quotation_line_items">;
type Currency = "UGX" | "USD";
type LineInput = { description: string; quantity: string; unitPrice: string };
type QuotationPreview = {
  quotationNumber: string;
  clientName: string;
  contactPerson: string | null;
  billingAddress: string | null;
  email: string | null;
  phone: string | null;
  projectLabel: string | null;
  issueDate: string;
  validUntil: string;
  currency: Currency;
  taxAmount: number;
  notes: string;
  lines: Array<{
    description: string;
    quantity: number | null;
    unitPrice: number | null;
    lineTotal: number | null;
  }>;
};

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

export const Route = createFileRoute("/_authenticated/quotations")({
  head: () => ({ meta: [{ title: "Quotations · BMP Media Production" }] }),
  component: QuotationsPage,
});

function QuotationsPage() {
  const queryClient = useQueryClient();
  const today = useMemo(todayInUganda, []);
  const createFormRef = useRef<HTMLFormElement>(null);
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [currency, setCurrency] = useState<Currency>("UGX");
  const [issueDate, setIssueDate] = useState(today);
  const [validUntil, setValidUntil] = useState(today);
  const [lines, setLines] = useState<LineInput[]>([
    { description: "", quantity: "1", unitPrice: "" },
  ]);
  const [selectedQuotationId, setSelectedQuotationId] = useState("");
  const [statusReason, setStatusReason] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceIssueDate, setInvoiceIssueDate] = useState(today);
  const [invoiceDueDate, setInvoiceDueDate] = useState(today);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [quotationPreview, setQuotationPreview] = useState<QuotationPreview | null>(null);
  const inputClass =
    "w-full rounded-sm border border-input bg-card px-3 py-2 text-sm text-foreground";

  const quotationsQuery = useQuery({
    queryKey: ["quotation-totals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotation_totals")
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
  const quotations = quotationsQuery.data ?? [];
  const parties = partiesQuery.data ?? [];
  const projects = projectsQuery.data ?? [];
  const selectedQuotation = quotations.find((item) => item.id === selectedQuotationId);
  const availableClients = parties.filter(
    (party) => party.party_type === "client" || party.party_type === "both",
  );
  const availableProjects = projects.filter((project) => project.client_id === clientId);
  const quotationClient = availableClients.find((party) => party.id === clientId);
  const quotationProject = availableProjects.find((project) => project.id === projectId);
  const selectedClient = parties.find((party) => party.id === selectedQuotation?.client_id);
  const selectedProject = projects.find((project) => project.id === selectedQuotation?.project_id);

  const lineItemsQuery = useQuery({
    queryKey: ["quotation-line-items", selectedQuotationId],
    enabled: Boolean(selectedQuotationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotation_line_items")
        .select("*")
        .eq("quotation_id", selectedQuotationId);
      if (error) throw error;
      return data;
    },
  });

  const createQuotation = useMutation({
    mutationFn: async (formData: FormData) => {
      const quotationNumber = String(formData.get("quotation_number") ?? "").trim();
      const taxAmount = Number(formData.get("tax_amount") ?? 0);
      if (!clientId) throw new Error("Choose a quotation client.");
      if (!quotationNumber) throw new Error("Enter a quotation number.");
      if (validUntil < issueDate) throw new Error("Validity date cannot be before the issue date.");
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
          "Each quotation line needs a description, positive quantity, and valid price.",
        );
      }

      const { error } = await supabase.rpc("create_sales_quotation", {
        p_quotation_number: quotationNumber,
        p_client_id: clientId,
        p_project_id: projectId || null,
        p_issue_date: issueDate,
        p_valid_until: validUntil,
        p_currency: currency,
        p_tax_amount: taxAmount,
        p_notes: String(formData.get("notes") ?? "").trim(),
        p_line_items: lineItems,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["quotation-totals"] });
      toast.success("Draft quotation created.");
      document.getElementById("quotation-create-form")?.querySelector("form")?.reset();
      setClientId("");
      setProjectId("");
      setCurrency("UGX");
      setIssueDate(today);
      setValidUntil(today);
      setLines([{ description: "", quantity: "1", unitPrice: "" }]);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ quotationId, status }: { quotationId: string; status: string }) => {
      if (!statusReason.trim()) throw new Error("Enter a status note for the quotation audit log.");
      const { error } = await supabase.rpc("update_sales_quotation_status", {
        p_quotation_id: quotationId,
        p_status: status,
        p_reason: statusReason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["quotation-totals"] });
      setStatusReason("");
      toast.success("Quotation status updated.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const convertToInvoice = useMutation({
    mutationFn: async () => {
      if (!selectedQuotation) throw new Error("Select an accepted quotation.");
      if (!invoiceNumber.trim()) throw new Error("Enter an invoice number.");
      if (invoiceDueDate < invoiceIssueDate)
        throw new Error("Invoice due date cannot be before its issue date.");
      const { data, error } = await supabase.rpc("convert_sales_quotation_to_invoice", {
        p_quotation_id: selectedQuotation.id,
        p_invoice_number: invoiceNumber.trim(),
        p_issue_date: invoiceIssueDate,
        p_due_date: invoiceDueDate,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["quotation-totals"] }),
        queryClient.invalidateQueries({ queryKey: ["invoice-balances"] }),
      ]);
      setInvoiceNumber("");
      toast.success("Accepted quotation converted to a draft invoice.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function requestStatusChange(quotationId: string, status: string) {
    if (selectedQuotationId !== quotationId) {
      setSelectedQuotationId(quotationId);
      setStatusReason("");
      toast.info("Open this quotation's details, enter a status note, then confirm the status.");
      return;
    }
    updateStatus.mutate({ quotationId, status });
  }

  const queryError = quotationsQuery.error ?? partiesQuery.error ?? projectsQuery.error;

  return (
    <AppShell title="Quotations">
      <div className="mx-auto max-w-6xl space-y-6">
        <section
          id="quotation-create-form"
          className="space-y-4 rounded-sm border bg-card p-4 sm:p-5"
        >
          <div>
            <h2 className="signage text-xl text-navy">Create a quotation</h2>
            <p className="text-sm text-muted-foreground">
              Prepare an itemized offer in UGX or USD. Sent quotations can be marked accepted or
              rejected, and an accepted, unexpired quotation can be converted into a draft invoice.
            </p>
          </div>
          <form
            ref={createFormRef}
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
            onSubmit={(event) => {
              event.preventDefault();
              createQuotation.mutate(new FormData(event.currentTarget));
            }}
          >
            <label className="space-y-1 text-sm font-medium">
              Quotation number
              <input
                required
                name="quotation_number"
                className={inputClass}
                placeholder="BMP-QT-001"
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Client
              <StyledSelect
                ariaLabel="Quotation client"
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
                ariaLabel="Quotation project"
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
                  if (validUntil < event.target.value) setValidUntil(event.target.value);
                }}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Valid until
              <input
                required
                type="date"
                min={issueDate}
                className={inputClass}
                value={validUntil}
                onChange={(event) => setValidUntil(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Currency
              <StyledSelect
                ariaLabel="Quotation currency"
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
              Notes and terms
              <input name="notes" className={inputClass} />
            </label>
            <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-3">
              <button
                type="button"
                onClick={() => {
                  const formData = createFormRef.current
                    ? new FormData(createFormRef.current)
                    : null;
                  if (!formData) return;
                  const previewLines = lines.map((line) => {
                    const quantity = Number(line.quantity);
                    const unitPrice = Number(line.unitPrice);
                    const hasQuantity = line.quantity.trim() !== "";
                    const hasUnitPrice = line.unitPrice.trim() !== "";
                    const hasValidAmount =
                      hasQuantity &&
                      hasUnitPrice &&
                      Number.isFinite(quantity) &&
                      quantity > 0 &&
                      Number.isFinite(unitPrice) &&
                      unitPrice >= 0;
                    return {
                      description: line.description.trim(),
                      quantity: hasQuantity && Number.isFinite(quantity) ? quantity : null,
                      unitPrice: hasUnitPrice && Number.isFinite(unitPrice) ? unitPrice : null,
                      lineTotal: hasValidAmount
                        ? Math.round(quantity * unitPrice * 100) / 100
                        : null,
                    };
                  });
                  const taxAmount = Number(formData.get("tax_amount") ?? 0);
                  setQuotationPreview({
                    quotationNumber:
                      String(formData.get("quotation_number") ?? "").trim() || "Quotation number",
                    clientName: quotationClient?.name || "Client not selected",
                    contactPerson: quotationClient?.contact_person ?? null,
                    billingAddress: quotationClient?.billing_address ?? null,
                    email: quotationClient?.email ?? null,
                    phone: quotationClient?.phone ?? null,
                    projectLabel: quotationProject
                      ? `${quotationProject.project_code} · ${quotationProject.service}`
                      : null,
                    issueDate,
                    validUntil,
                    currency,
                    taxAmount: Number.isFinite(taxAmount) && taxAmount >= 0 ? taxAmount : 0,
                    notes: String(formData.get("notes") ?? "").trim(),
                    lines: previewLines,
                  });
                  setPreviewOpen(true);
                }}
                className="rounded-sm border px-4 py-2 text-sm font-semibold hover:bg-secondary"
              >
                Preview quotation
              </button>
              <button
                type="submit"
                disabled={createQuotation.isPending || availableClients.length === 0}
                className="rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {createQuotation.isPending ? "Saving…" : "Create draft quotation"}
              </button>
            </div>
            {availableClients.length === 0 && (
              <p className="text-xs text-muted-foreground sm:col-span-2 xl:col-span-3">
                Add a client on the Projects & partners page before creating quotations.
              </p>
            )}
          </form>
        </section>

        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle className="signage text-2xl text-navy">Quotation preview</DialogTitle>
              <DialogDescription>
                Review the customer-facing offer before creating the draft quotation.
              </DialogDescription>
            </DialogHeader>
            {quotationPreview && (
              <div className="print-brand-grid max-h-[70dvh] space-y-6 overflow-y-auto rounded-sm border border-white/10 bg-[#101821] p-5 text-white shadow-[0_18px_45px_rgba(15,24,32,0.25)] sm:p-8">
                <header className="border-b-2 border-orange-500/80 pb-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold tracking-[0.22em] text-orange-300">
                        BMP MEDIA PRODUCTION
                      </p>
                      <h2 className="mt-4 text-3xl font-bold text-white">QUOTATION</h2>
                    </div>
                    <div className="rounded-sm border border-white/10 bg-black/20 px-3 py-2 text-right">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-slate-300">
                        Ref.
                      </p>
                      <p className="text-lg font-semibold text-white">{quotationPreview.quotationNumber}</p>
                    </div>
                  </div>
                </header>
                <div className="grid grid-cols-1 gap-5 text-sm sm:grid-cols-2">
                  <div className="rounded-sm border border-white/10 bg-white/5 p-4">
                    <p className="font-bold text-orange-300">Prepared for</p>
                    <p>{quotationPreview.clientName}</p>
                    {quotationPreview.contactPerson && <p>{quotationPreview.contactPerson}</p>}
                    {quotationPreview.billingAddress && <p>{quotationPreview.billingAddress}</p>}
                    {quotationPreview.email && <p>{quotationPreview.email}</p>}
                    {quotationPreview.phone && <p>{quotationPreview.phone}</p>}
                  </div>
                  <div className="rounded-sm border border-white/10 bg-white/5 p-4">
                    <p>
                      <span className="font-bold text-orange-300">Issue date: </span>
                      {quotationPreview.issueDate}
                    </p>
                    <p>
                      <span className="font-bold text-orange-300">Valid until: </span>
                      {quotationPreview.validUntil}
                    </p>
                    {quotationPreview.projectLabel && (
                      <p>
                        <span className="font-bold text-orange-300">Project: </span>
                        {quotationPreview.projectLabel}
                      </p>
                    )}
                    <p>
                      <span className="font-bold text-orange-300">Currency: </span>
                      {quotationPreview.currency}
                    </p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-y border-white/15 bg-white/5 text-slate-200">
                        <th className="py-2">Description</th>
                        <th className="py-2">Qty</th>
                        <th className="py-2">Unit price</th>
                        <th className="py-2 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quotationPreview.lines.map((line, index) => (
                        <tr key={index} className="border-b border-white/10">
                          <td className="py-2">{line.description || "—"}</td>
                          <td className="py-2">{line.quantity ?? "—"}</td>
                          <td className="py-2">
                            {line.unitPrice === null
                              ? "—"
                              : money(line.unitPrice, quotationPreview.currency)}
                          </td>
                          <td className="py-2 text-right">
                            {line.lineTotal === null
                              ? "—"
                              : money(line.lineTotal, quotationPreview.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td className="pt-3 font-semibold text-slate-200" colSpan={3}>
                          Subtotal
                        </td>
                        <td className="pt-3 text-right">
                          {quotationPreview.lines.some((line) => line.lineTotal === null)
                            ? "—"
                            : money(
                                quotationPreview.lines.reduce(
                                  (total, line) => total + (line.lineTotal ?? 0),
                                  0,
                                ),
                                quotationPreview.currency,
                              )}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1 font-semibold text-slate-200" colSpan={3}>
                          Tax
                        </td>
                        <td className="py-1 text-right">
                          {money(quotationPreview.taxAmount, quotationPreview.currency)}
                        </td>
                      </tr>
                      <tr className="border-t border-white/20 font-bold text-orange-300">
                        <td className="pt-2" colSpan={3}>
                          Total
                        </td>
                        <td className="pt-2 text-right">
                          {quotationPreview.lines.some((line) => line.lineTotal === null)
                            ? "—"
                            : money(
                                quotationPreview.lines.reduce(
                                  (total, line) => total + (line.lineTotal ?? 0),
                                  quotationPreview.taxAmount,
                                ),
                                quotationPreview.currency,
                              )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {quotationPreview.notes && (
                  <p className="whitespace-pre-wrap text-sm text-slate-200">
                    <span className="font-bold text-orange-300">Notes and terms: </span>
                    {quotationPreview.notes}
                  </p>
                )}
                <p className="border-t border-white/10 pt-3 text-xs text-slate-300">
                  This quotation is valid until {quotationPreview.validUntil}. Prices and terms are
                  subject to written acceptance.
                </p>
              </div>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
              >
                Back to editing
              </button>
            </div>
          </DialogContent>
        </Dialog>

        <section className="space-y-3">
          <div>
            <h2 className="signage text-xl text-navy">Quotation register</h2>
            <p className="text-sm text-muted-foreground">
              An expired offer cannot be accepted or converted. Converted quotations remain linked
              to the draft invoice for traceability.
            </p>
          </div>
          {queryError && (
            <p
              role="alert"
              className="rounded-sm border border-destructive/40 bg-destructive/10 p-3 text-sm"
            >
              Could not load quotations: {(queryError as Error).message}
            </p>
          )}
          {quotationsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading quotations…</p>
          ) : quotations.length === 0 ? (
            <p className="rounded-sm border bg-card p-4 text-sm text-muted-foreground">
              No quotations have been created.
            </p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {quotations.map((quotation: Quotation) => {
                const client = parties.find((party) => party.id === quotation.client_id);
                const project = projects.find((item) => item.id === quotation.project_id);
                const expired =
                  quotation.valid_until < today &&
                  (quotation.status === "sent" || quotation.status === "accepted");
                const status = expired ? "expired" : quotation.status;
                const selected = selectedQuotationId === quotation.id;
                return (
                  <article
                    key={quotation.id}
                    className={`space-y-3 rounded-sm border bg-card p-4 ${selected ? "border-primary" : ""}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-bold">{quotation.quotation_number}</p>
                        <p className="text-sm text-muted-foreground">
                          {client?.name ?? "Unknown client"}
                          {project ? ` · ${project.project_code}` : ""}
                        </p>
                      </div>
                      <span className="rounded-sm bg-secondary px-2 py-1 text-xs font-bold uppercase">
                        {status}
                      </span>
                    </div>
                    <div className="grid gap-2 text-sm sm:grid-cols-2">
                      <p>
                        <span className="text-muted-foreground">Issued / valid until: </span>
                        {quotation.issue_date} / {quotation.valid_until}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Total: </span>
                        {money(quotation.total_amount, quotation.currency)}
                      </p>
                      {quotation.converted_invoice_number && (
                        <p className="sm:col-span-2">
                          <span className="text-muted-foreground">Draft invoice: </span>
                          {quotation.converted_invoice_number}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 border-t pt-3">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedQuotationId(selected ? "" : quotation.id);
                          setStatusReason("");
                        }}
                        className="rounded-sm border px-3 py-2 text-sm font-semibold hover:bg-secondary"
                      >
                        {selected ? "Hide details" : "Details"}
                      </button>
                      {quotation.status === "draft" && (
                        <button
                          type="button"
                          disabled={updateStatus.isPending}
                          onClick={() => requestStatusChange(quotation.id, "sent")}
                          className="rounded-sm bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                        >
                          Mark sent
                        </button>
                      )}
                      {quotation.status === "sent" && !expired && (
                        <>
                          <button
                            type="button"
                            disabled={updateStatus.isPending}
                            onClick={() => requestStatusChange(quotation.id, "accepted")}
                            className="rounded-sm bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                          >
                            Mark accepted
                          </button>
                          <button
                            type="button"
                            disabled={updateStatus.isPending}
                            onClick={() => requestStatusChange(quotation.id, "rejected")}
                            className="rounded-sm border px-3 py-2 text-sm font-semibold text-destructive disabled:opacity-60"
                          >
                            Mark rejected
                          </button>
                        </>
                      )}
                    </div>
                    {selected && quotation.status !== "converted" && (
                      <label className="block space-y-1 text-xs font-medium text-muted-foreground">
                        Status note / audit reason
                        <input
                          value={statusReason}
                          onChange={(event) => setStatusReason(event.target.value)}
                          className={inputClass}
                          placeholder="Record how the client responded or when it was sent"
                        />
                      </label>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {selectedQuotation && (
          <section className="space-y-4 rounded-sm border bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="signage text-xl text-navy">{selectedQuotation.quotation_number}</h2>
                <p className="text-sm text-muted-foreground">
                  {selectedClient?.name}
                  {selectedProject ? ` · ${selectedProject.project_code}` : ""}
                  {" · "}Valid until {selectedQuotation.valid_until}
                </p>
              </div>
              <p className="text-lg font-bold">
                {money(selectedQuotation.total_amount, selectedQuotation.currency)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-sm border px-3 py-2 text-sm font-semibold hover:bg-secondary"
            >
              Print quotation
            </button>
            {lineItemsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading quotation details…</p>
            ) : lineItemsQuery.error ? (
              <p role="alert" className="text-sm text-destructive">
                Could not load quotation line items: {(lineItemsQuery.error as Error).message}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-sm border">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="bg-secondary text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="p-3">Description</th>
                      <th className="p-3">Quantity</th>
                      <th className="p-3">Unit price</th>
                      <th className="p-3">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {lineItemsQuery.data?.map((line: QuotationLine) => (
                      <tr key={line.id}>
                        <td className="p-3">{line.description}</td>
                        <td className="p-3">{line.quantity}</td>
                        <td className="p-3">
                          {money(line.unit_price, selectedQuotation.currency)}
                        </td>
                        <td className="p-3">
                          {money(line.line_total, selectedQuotation.currency)}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td className="p-3 font-semibold" colSpan={3}>
                        Subtotal
                      </td>
                      <td className="p-3">
                        {money(selectedQuotation.subtotal, selectedQuotation.currency)}
                      </td>
                    </tr>
                    <tr>
                      <td className="p-3 font-semibold" colSpan={3}>
                        Tax
                      </td>
                      <td className="p-3">
                        {money(selectedQuotation.tax_amount, selectedQuotation.currency)}
                      </td>
                    </tr>
                    <tr className="font-bold">
                      <td className="p-3" colSpan={3}>
                        Total
                      </td>
                      <td className="p-3">
                        {money(selectedQuotation.total_amount, selectedQuotation.currency)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            {selectedQuotation.notes && (
              <p className="text-sm">
                <span className="font-semibold">Notes and terms: </span>
                {selectedQuotation.notes}
              </p>
            )}
            <div className="quotation-print-sheet hidden print-brand-grid">
              <header className="mb-8 border-b-2 border-orange-500/80 pb-4">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold tracking-[0.22em] text-orange-300">
                      BMP MEDIA PRODUCTION
                    </p>
                    <h1 className="mt-4 text-3xl font-bold text-white">QUOTATION</h1>
                  </div>
                  <div className="rounded-sm border border-white/10 bg-black/20 px-3 py-2 text-right">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-slate-300">Ref.</p>
                    <p className="text-lg font-semibold text-white">{selectedQuotation.quotation_number}</p>
                  </div>
                </div>
              </header>
              <div className="mb-6 grid grid-cols-2 gap-6 text-sm">
                <div className="rounded-sm border border-white/10 bg-white/5 p-4">
                  <p className="font-bold text-orange-300">Prepared for</p>
                  <p>{selectedClient?.name}</p>
                  {selectedClient?.contact_person && <p>{selectedClient.contact_person}</p>}
                  {selectedClient?.billing_address && <p>{selectedClient.billing_address}</p>}
                  {selectedClient?.email && <p>{selectedClient.email}</p>}
                  {selectedClient?.phone && <p>{selectedClient.phone}</p>}
                </div>
                <div className="rounded-sm border border-white/10 bg-white/5 p-4">
                  <p>
                    <span className="font-bold text-orange-300">Issue date: </span>
                    {selectedQuotation.issue_date}
                  </p>
                  <p>
                    <span className="font-bold text-orange-300">Valid until: </span>
                    {selectedQuotation.valid_until}
                  </p>
                  {selectedProject && (
                    <p>
                      <span className="font-bold text-orange-300">Project: </span>
                      {selectedProject.project_code} · {selectedProject.service}
                    </p>
                  )}
                  <p>
                    <span className="font-bold text-orange-300">Currency: </span>
                    {selectedQuotation.currency}
                  </p>
                </div>
              </div>
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-y border-white/15 bg-white/5 text-slate-200">
                    <th className="py-2">Description</th>
                    <th className="py-2">Qty</th>
                    <th className="py-2">Unit price</th>
                    <th className="py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItemsQuery.data?.map((line: QuotationLine) => (
                    <tr key={line.id} className="border-b border-white/10">
                      <td className="py-2">{line.description}</td>
                      <td className="py-2">{line.quantity}</td>
                      <td className="py-2">{money(line.unit_price, selectedQuotation.currency)}</td>
                      <td className="py-2 text-right">
                        {money(line.line_total, selectedQuotation.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="pt-3 font-semibold text-slate-200" colSpan={3}>
                      Subtotal
                    </td>
                    <td className="pt-3 text-right">
                      {money(selectedQuotation.subtotal, selectedQuotation.currency)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1 font-semibold text-slate-200" colSpan={3}>
                      Tax
                    </td>
                    <td className="py-1 text-right">
                      {money(selectedQuotation.tax_amount, selectedQuotation.currency)}
                    </td>
                  </tr>
                  <tr className="border-t border-white/20 font-bold text-orange-300">
                    <td className="pt-2" colSpan={3}>
                      Total
                    </td>
                    <td className="pt-2 text-right">
                      {money(selectedQuotation.total_amount, selectedQuotation.currency)}
                    </td>
                  </tr>
                </tfoot>
              </table>
              {selectedQuotation.notes && (
                <p className="mt-8 whitespace-pre-wrap text-sm text-slate-200">
                  <span className="font-bold text-orange-300">Notes and terms: </span>
                  {selectedQuotation.notes}
                </p>
              )}
              <p className="mt-12 border-t border-white/10 pt-3 text-xs text-slate-300">
                This quotation is valid until {selectedQuotation.valid_until}. Prices and terms are
                subject to written acceptance.
              </p>
            </div>
            {selectedQuotation.status === "accepted" && selectedQuotation.valid_until >= today && (
              <form
                className="grid gap-3 border-t pt-4 sm:grid-cols-2 xl:grid-cols-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  convertToInvoice.mutate();
                }}
              >
                <div className="sm:col-span-2 xl:col-span-4">
                  <h3 className="font-semibold">Convert to draft invoice</h3>
                  <p className="text-xs text-muted-foreground">
                    Line items, currency, tax, client, project, and notes will be copied. The
                    invoice stays a draft until it is issued from Invoices & collections.
                  </p>
                </div>
                <label className="space-y-1 text-sm font-medium">
                  Invoice number
                  <input
                    required
                    value={invoiceNumber}
                    onChange={(event) => setInvoiceNumber(event.target.value)}
                    className={inputClass}
                  />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Invoice date
                  <input
                    required
                    type="date"
                    value={invoiceIssueDate}
                    onChange={(event) => {
                      setInvoiceIssueDate(event.target.value);
                      if (invoiceDueDate < event.target.value)
                        setInvoiceDueDate(event.target.value);
                    }}
                    className={inputClass}
                  />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Invoice due date
                  <input
                    required
                    type="date"
                    min={invoiceIssueDate}
                    value={invoiceDueDate}
                    onChange={(event) => setInvoiceDueDate(event.target.value)}
                    className={inputClass}
                  />
                </label>
                <button
                  type="submit"
                  disabled={convertToInvoice.isPending || Boolean(selectedQuotation.invoice_id)}
                  className="self-end rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {convertToInvoice.isPending ? "Converting…" : "Create draft invoice"}
                </button>
              </form>
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}
