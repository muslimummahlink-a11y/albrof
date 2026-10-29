import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ExternalLink,
  FileClock,
  Pencil,
  Plus,
  Printer,
  Upload,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { StyledSelect } from "@/components/StyledSelect";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { addDaysToDate, daysUntilDate, formatContractDate, getKampalaDate } from "@/lib/contracts";
import {
  buildContractHtml,
  DEFAULT_CONTRACT_TERMS,
  readContractTerms,
  type ContractTerms,
} from "@/lib/contract-document";

export const Route = createFileRoute("/_authenticated/contracts")({
  head: () => ({ meta: [{ title: "Contracts · BMP Media Production" }] }),
  component: EmployeeContracts,
});

type Contract = Tables<"employee_contracts">;
type ContractDraft = {
  id?: string;
  employee_id: string;
  contract_type: string;
  start_date: string;
  end_date: string;
  status: string;
  document_path: string | null;
  signed_document_path: string | null;
  terms: ContractTerms;
  notes: string;
};
type ContractTextField = keyof Omit<ContractTerms, "additionalClauses">;

const contractTypes = [
  { value: "fixed_term", label: "Fixed-term" },
  { value: "permanent", label: "Permanent" },
  { value: "probation", label: "Probation" },
  { value: "consultancy", label: "Consultancy" },
  { value: "other", label: "Other" },
];
const contractStatuses = [
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "terminated", label: "Terminated" },
];
const allowedTypes = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const allowedSignedTypes = [...allowedTypes, "image/jpeg", "image/png"];
const maxFileSize = 10 * 1024 * 1024;
const inputClass =
  "w-full rounded-sm border border-input bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

function EmployeeContracts() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [draft, setDraft] = useState<ContractDraft | null>(null);
  const [document, setDocument] = useState<File | null>(null);
  const [signedCopy, setSignedCopy] = useState<File | null>(null);

  const { data: employees = [] } = useQuery({
    queryKey: ["contract-employees"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, employee_no, full_name, position, department, base_salary, allowances, phone")
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });
  const { data: contracts = [], isLoading } = useQuery({
    queryKey: ["employee-contracts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_contracts")
        .select("*, employees(id, full_name, employee_no, position)")
        .order("end_date");
      if (error) throw error;
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async (input: { draft: ContractDraft; document: File | null }) => {
      const { draft: contract, document: file } = input;
      if (
        !contract.employee_id ||
        !contract.start_date ||
        (contract.contract_type !== "permanent" && !contract.end_date)
      ) {
        throw new Error("Choose an employee and enter the required contract dates.");
      }
      if (contract.end_date && contract.end_date < contract.start_date) {
        throw new Error("The contract end date must be on or after the start date.");
      }
      for (const [label, value] of [
        ["Gross pay", contract.terms.payAmount],
        ["Allowances", contract.terms.payAllowances],
      ]) {
        if (value && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
          throw new Error(`${label} must be a non-negative number.`);
        }
      }
      if (file && (!allowedTypes.includes(file.type) || file.size > maxFileSize)) {
        throw new Error("Contract files must be PDF or Word documents no larger than 10 MB.");
      }

      const id = contract.id ?? crypto.randomUUID();
      const payload = {
        employee_id: contract.employee_id,
        contract_type: contract.contract_type,
        start_date: contract.start_date,
        end_date: contract.end_date || null,
        status: contract.status,
        contract_terms: contract.terms,
        notes: contract.notes.trim(),
        updated_at: new Date().toISOString(),
      };
      const { error: saveError } = contract.id
        ? await supabase.from("employee_contracts").update(payload).eq("id", id)
        : await supabase.from("employee_contracts").insert({ ...payload, id });
      if (saveError) throw saveError;

      if (!file) {
        return {
          id,
          documentPath: contract.document_path,
          uploadError: null as string | null,
        };
      }
      const safeName = file.name.replace(/[\\/:*?"<>|]/g, "_");
      const path = `${id}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from("employee-contracts")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) {
        return { id, documentPath: contract.document_path, uploadError: uploadError.message };
      }

      const { error: linkError } = await supabase
        .from("employee_contracts")
        .update({ document_path: path, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (linkError) {
        return {
          id,
          documentPath: contract.document_path,
          uploadError: `The document uploaded but could not be linked: ${linkError.message}`,
        };
      }
      return { id, documentPath: path, uploadError: null as string | null };
    },
    onSuccess: ({ id, documentPath, uploadError }) => {
      void queryClient.invalidateQueries({ queryKey: ["employee-contracts"] });
      void queryClient.invalidateQueries({ queryKey: ["contract-expiry-alerts"] });
      setDraft((current) =>
        current
          ? { ...current, id, document_path: documentPath ?? current.document_path }
          : current,
      );
      setDocument(null);
      if (uploadError) {
        toast.error(`Contract saved, but the document was not attached: ${uploadError}`);
        return;
      }
      toast.success("Contract saved. Upload its signed copy when ready.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const uploadSignedCopy = useMutation({
    mutationFn: async () => {
      if (!draft?.id) throw new Error("Save the contract before uploading its signed copy.");
      if (!signedCopy) throw new Error("Choose the signed contract file to upload.");
      if (!allowedSignedTypes.includes(signedCopy.type) || signedCopy.size > maxFileSize) {
        throw new Error(
          "Signed copies must be PDF, Word, JPEG, or PNG files no larger than 10 MB.",
        );
      }

      const safeName = signedCopy.name.replace(/[\\/:*?"<>|]/g, "_");
      const path = `${draft.id}/signed/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from("employee-contracts")
        .upload(path, signedCopy, { contentType: signedCopy.type, upsert: false });
      if (uploadError) throw uploadError;

      const { error: updateError } = await supabase
        .from("employee_contracts")
        .update({ signed_document_path: path, updated_at: new Date().toISOString() })
        .eq("id", draft.id);
      if (updateError) throw updateError;
      return path;
    },
    onSuccess: (path) => {
      setDraft((current) => (current ? { ...current, signed_document_path: path } : current));
      setSignedCopy(null);
      void queryClient.invalidateQueries({ queryKey: ["employee-contracts"] });
      void queryClient.invalidateQueries({ queryKey: ["employee-contracts-for-staff-form"] });
      toast.success("Signed contract copy uploaded");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const today = getKampalaDate();
  const expiryDate = addDaysToDate(today, 30);
  const expiring = contracts.filter(
    (contract) =>
      contract.status === "active" &&
      contract.end_date !== null &&
      contract.end_date >= today &&
      contract.end_date <= expiryDate,
  );
  const filtered = contracts.filter((contract) => {
    const employee = contract.employees;
    const matchesSearch =
      `${employee?.full_name ?? ""} ${employee?.employee_no ?? ""} ${contract.contract_type}`
        .toLowerCase()
        .includes(search.trim().toLowerCase());
    return matchesSearch && (statusFilter === "all" || contract.status === statusFilter);
  });

  function openNewContract() {
    setDocument(null);
    setSignedCopy(null);
    setDraft({
      employee_id: "",
      contract_type: "fixed_term",
      start_date: today,
      end_date: "",
      status: "active",
      document_path: null,
      signed_document_path: null,
      terms: {
        ...DEFAULT_CONTRACT_TERMS,
        additionalClauses: [...DEFAULT_CONTRACT_TERMS.additionalClauses],
      },
      notes: "",
    });
  }

  function openExistingContract(contract: Contract) {
    setDocument(null);
    setSignedCopy(null);
    const employee = employees.find((candidate) => candidate.id === contract.employee_id);
    const terms = readContractTerms(contract.contract_terms);
    setDraft({
      id: contract.id,
      employee_id: contract.employee_id,
      contract_type: contract.contract_type,
      start_date: contract.start_date,
      end_date: contract.end_date ?? "",
      status: contract.status,
      document_path: contract.document_path,
      signed_document_path: contract.signed_document_path,
      terms: employee
        ? {
            ...terms,
            employeeName: terms.employeeName || employee.full_name,
            employeeNumber: terms.employeeNumber || employee.employee_no,
            jobTitle: terms.jobTitle || employee.position,
            department: terms.department || employee.department,
            employeePhone: terms.employeePhone || employee.phone || "",
            payAmount: terms.payAmount || String(employee.base_salary),
            payAllowances: terms.payAllowances || String(employee.allowances),
          }
        : terms,
      notes: contract.notes,
    });
  }

  function updateTerms<K extends keyof ContractTerms>(key: K, value: ContractTerms[K]) {
    setDraft((current) =>
      current ? { ...current, terms: { ...current.terms, [key]: value } } : current,
    );
  }

  function updateEmployee(employeeId: string) {
    const employee = employees.find((candidate) => candidate.id === employeeId);
    setDraft((current) =>
      current
        ? {
            ...current,
            employee_id: employeeId,
            terms: {
              ...current.terms,
              employeeName: employee?.full_name ?? "",
              employeeNumber: employee?.employee_no ?? "",
              jobTitle: employee?.position ?? "",
              department: employee?.department ?? "",
              employeePhone: employee?.phone ?? "",
              payAmount: employee ? String(employee.base_salary) : "",
              payAllowances: employee ? String(employee.allowances) : "",
            },
          }
        : current,
    );
  }

  function printDraft(contract: ContractDraft) {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast.error("Allow pop-ups to preview and print the contract.");
      return;
    }
    printWindow.onload = () => printWindow.print();
    printWindow.document.open();
    printWindow.document.write(
      buildContractHtml(
        {
          contractType:
            contractTypes.find((type) => type.value === contract.contract_type)?.label ??
            contract.contract_type,
          startDate: contract.start_date,
          endDate: contract.end_date,
        },
        contract.terms,
      ),
    );
    printWindow.document.close();
  }

  async function openDocument(path: string) {
    const { data, error } = await supabase.storage
      .from("employee-contracts")
      .createSignedUrl(path, 60);
    if (error) {
      toast.error(`Contract document could not be opened: ${error.message}`);
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  function renderTermInput(label: string, key: ContractTextField, type = "text") {
    return (
      <label key={key} className="space-y-1 text-sm font-medium">
        {label}
        <input
          aria-label={label}
          type={type}
          value={draft?.terms[key] ?? ""}
          onChange={(event) => updateTerms(key, event.target.value)}
          className={inputClass}
        />
      </label>
    );
  }

  function renderTermTextarea(label: string, key: ContractTextField, rows = 3) {
    return (
      <label key={key} className="space-y-1 text-sm font-medium">
        {label}
        <textarea
          aria-label={label}
          rows={rows}
          value={draft?.terms[key] ?? ""}
          onChange={(event) => updateTerms(key, event.target.value)}
          className={inputClass}
        />
      </label>
    );
  }

  return (
    <AppShell
      title="Employee contracts"
      actions={
        <Button onClick={openNewContract} className="gap-2">
          <Plus aria-hidden="true" className="h-4 w-4" />
          Add contract
        </Button>
      }
    >
      <div className="space-y-5">
        {expiring.length > 0 && (
          <section
            aria-labelledby="contract-expiry-heading"
            className="rounded-sm border-l-4 border-amber-500 bg-amber-50 p-4 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <h2 id="contract-expiry-heading" className="font-semibold">
                  {expiring.length}{" "}
                  {expiring.length === 1 ? "contract expires" : "contracts expire"} within 30 days
                </h2>
                <ul className="mt-2 space-y-1 text-sm">
                  {expiring.slice(0, 5).map((contract) => {
                    if (!contract.end_date) return null;
                    const days = daysUntilDate(contract.end_date, today);
                    return (
                      <li key={contract.id}>
                        {contract.employees?.full_name ?? "Employee"} —{" "}
                        {days === 0 ? "expires today" : `expires in ${days} days`} (
                        {formatContractDate(contract.end_date)})
                      </li>
                    );
                  })}
                  {expiring.length > 5 && <li>And {expiring.length - 5} more contracts.</li>}
                </ul>
                <p className="mt-2 text-xs">
                  HR and administrators see this alert in the app. Email reminders are sent daily
                  once the scheduled email service is configured.
                </p>
              </div>
            </div>
          </section>
        )}

        <section className="space-y-3">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <h2 className="signage text-xl text-navy">Contract register</h2>
              <p className="text-sm text-muted-foreground">
                Track staff agreements and review contracts before they expire.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                aria-label="Search contracts"
                placeholder="Search employee or type…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className={inputClass}
              />
              <StyledSelect
                aria-label="Filter contracts by status"
                value={statusFilter}
                onChange={setStatusFilter}
                options={[{ value: "all", label: "All contract statuses" }, ...contractStatuses]}
                className={inputClass}
              />
            </div>
          </div>

          <div className="overflow-x-auto rounded-sm border bg-card">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    Employee
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Type
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Start date
                  </th>
                  <th scope="col" className="px-4 py-3">
                    End date
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Signed copy
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      Loading contracts…
                    </td>
                  </tr>
                ) : filtered.length ? (
                  filtered.map((contract) => {
                    const days = contract.end_date ? daysUntilDate(contract.end_date, today) : null;
                    const isExpiring =
                      contract.status === "active" && days !== null && days >= 0 && days <= 30;
                    return (
                      <tr key={contract.id}>
                        <td className="px-4 py-3">
                          <div className="font-semibold">
                            {contract.employees?.full_name ?? "Unknown employee"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {contract.employees?.employee_no ?? "—"}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {contractTypes.find((type) => type.value === contract.contract_type)
                            ?.label ?? contract.contract_type}
                        </td>
                        <td className="px-4 py-3">{formatContractDate(contract.start_date)}</td>
                        <td className="px-4 py-3">
                          <span className={isExpiring ? "font-semibold text-destructive" : ""}>
                            {contract.end_date
                              ? formatContractDate(contract.end_date)
                              : "No fixed end date"}
                          </span>
                          {isExpiring && (
                            <span className="ml-2 text-xs text-destructive">
                              {days === 0 ? "Today" : `${days} days`}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 capitalize">{contract.status}</td>
                        <td className="px-4 py-3">
                          {contract.signed_document_path ? (
                            <button
                              type="button"
                              onClick={() => void openDocument(contract.signed_document_path!)}
                              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                            >
                              <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                              Open
                            </button>
                          ) : (
                            <span className="text-muted-foreground">Not uploaded</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => openExistingContract(contract)}
                          >
                            <Pencil aria-hidden="true" className="mr-1 h-3.5 w-3.5" />
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`Print contract for ${contract.employees?.full_name ?? "employee"}`}
                            onClick={() => {
                              openExistingContract(contract);
                              const employee = employees.find(
                                (candidate) => candidate.id === contract.employee_id,
                              );
                              const terms = readContractTerms(contract.contract_terms);
                              printDraft({
                                id: contract.id,
                                employee_id: contract.employee_id,
                                contract_type: contract.contract_type,
                                start_date: contract.start_date,
                                end_date: contract.end_date ?? "",
                                status: contract.status,
                                document_path: contract.document_path,
                                signed_document_path: contract.signed_document_path,
                                terms: employee
                                  ? {
                                      ...terms,
                                      employeeName: terms.employeeName || employee.full_name,
                                      employeeNumber: terms.employeeNumber || employee.employee_no,
                                      jobTitle: terms.jobTitle || employee.position,
                                      department: terms.department || employee.department,
                                      employeePhone: terms.employeePhone || employee.phone || "",
                                      payAmount: terms.payAmount || String(employee.base_salary),
                                      payAllowances:
                                        terms.payAllowances || String(employee.allowances),
                                    }
                                  : terms,
                                notes: contract.notes,
                              });
                            }}
                          >
                            <Printer aria-hidden="true" className="mr-1 h-4 w-4" />
                            Print
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      No contracts match your search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <Dialog
          open={Boolean(draft)}
          onOpenChange={(open) => {
            if (!open && !save.isPending) {
              setDraft(null);
              setDocument(null);
              setSignedCopy(null);
            }
          }}
        >
          <DialogContent className="max-h-[95vh] overflow-y-auto sm:max-w-7xl">
            <DialogHeader>
              <DialogTitle className="signage text-2xl text-navy">
                {draft?.id ? "Build or edit employment contract" : "Build employment contract"}
              </DialogTitle>
              <p className="text-sm text-muted-foreground">
                Complete the employment terms, review the live document preview, then print it for
                signing. Upload the signed copy separately after signatures are complete.
              </p>
            </DialogHeader>
            {draft && (
              <form
                className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]"
                onSubmit={(event) => {
                  event.preventDefault();
                  save.mutate({ draft, document });
                }}
              >
                <div className="space-y-5">
                  <section className="space-y-3 rounded-sm border p-4">
                    <h2 className="signage text-lg text-navy">Contract details</h2>
                    <label className="block space-y-1 text-sm font-medium">
                      Employee
                      <StyledSelect
                        aria-label="Contract employee"
                        value={draft.employee_id}
                        onChange={updateEmployee}
                        options={employees.map((employee) => ({
                          value: employee.id,
                          label: `${employee.employee_no} · ${employee.full_name}`,
                        }))}
                        placeholder="Choose an employee"
                      />
                    </label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1 text-sm font-medium">
                        Contract type
                        <StyledSelect
                          aria-label="Contract type"
                          value={draft.contract_type}
                          onChange={(contract_type) => setDraft({ ...draft, contract_type })}
                          options={contractTypes}
                        />
                      </label>
                      <label className="space-y-1 text-sm font-medium">
                        Record status
                        <StyledSelect
                          aria-label="Contract status"
                          value={draft.status}
                          onChange={(status) => setDraft({ ...draft, status })}
                          options={contractStatuses}
                        />
                      </label>
                      <label className="space-y-1 text-sm font-medium">
                        Start date
                        <input
                          aria-label="Contract start date"
                          type="date"
                          required
                          value={draft.start_date}
                          onChange={(event) =>
                            setDraft({ ...draft, start_date: event.target.value })
                          }
                          className={inputClass}
                        />
                      </label>
                      <label className="space-y-1 text-sm font-medium">
                        End date {draft.contract_type === "permanent" && "(optional)"}
                        <input
                          aria-label="Contract end date"
                          type="date"
                          required={draft.contract_type !== "permanent"}
                          value={draft.end_date}
                          onChange={(event) => setDraft({ ...draft, end_date: event.target.value })}
                          className={inputClass}
                        />
                      </label>
                    </div>
                  </section>

                  <section className="space-y-3 rounded-sm border p-4">
                    <h2 className="signage text-lg text-navy">Employer particulars</h2>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {renderTermInput("Legal employer name", "employerName")}
                      {renderTermInput("Registration number", "employerRegistration")}
                      {renderTermInput("Employer address", "employerAddress")}
                      {renderTermInput("Employer email", "employerEmail", "email")}
                      {renderTermInput("Employer phone", "employerPhone", "tel")}
                      {renderTermInput("Employer signatory name", "employerRepresentative")}
                      {renderTermInput("Employer signatory title", "employerRepresentativeTitle")}
                    </div>
                  </section>

                  <section className="space-y-3 rounded-sm border p-4">
                    <h2 className="signage text-lg text-navy">Employee particulars</h2>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {renderTermInput("Employee full legal name", "employeeName")}
                      {renderTermInput("Employee number", "employeeNumber")}
                      {renderTermInput("National ID or passport", "employeeNationalId")}
                      {renderTermInput("Employee address", "employeeAddress")}
                      {renderTermInput("Employee phone", "employeePhone", "tel")}
                      {renderTermInput("Employee email", "employeeEmail", "email")}
                      {renderTermInput("Position / job title", "jobTitle")}
                      {renderTermInput("Department", "department")}
                    </div>
                  </section>

                  <section className="space-y-3 rounded-sm border p-4">
                    <h2 className="signage text-lg text-navy">Employment terms</h2>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {renderTermInput("Work location", "workLocation")}
                      {renderTermInput("Reports to", "reportsTo")}
                      {renderTermInput("Gross pay amount", "payAmount", "number")}
                      {renderTermInput("Allowances", "payAllowances", "number")}
                      <label className="space-y-1 text-sm font-medium">
                        Pay currency
                        <StyledSelect
                          aria-label="Contract pay currency"
                          value={draft.terms.payCurrency}
                          onChange={(payCurrency) => updateTerms("payCurrency", payCurrency)}
                          options={[
                            { value: "UGX", label: "UGX" },
                            { value: "USD", label: "USD" },
                          ]}
                        />
                      </label>
                      {renderTermInput("Pay frequency", "payFrequency")}
                      {renderTermInput("Probation period", "probationPeriod")}
                      {renderTermInput("Working hours", "workingHours")}
                      {renderTermInput("Annual leave entitlement", "annualLeave")}
                      {renderTermInput("Notice period", "noticePeriod")}
                    </div>
                    <div className="space-y-3">
                      {renderTermTextarea("Duties and responsibilities", "duties", 5)}
                    </div>
                  </section>

                  <section className="space-y-3 rounded-sm border p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="signage text-lg text-navy">Additional clauses</h2>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          updateTerms("additionalClauses", [
                            ...draft.terms.additionalClauses,
                            { heading: "", body: "" },
                          ])
                        }
                      >
                        <Plus aria-hidden="true" className="mr-1 h-4 w-4" />
                        Add clause
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Edit or remove any sample clause. Added clauses appear in the printed
                      document.
                    </p>
                    {draft.terms.additionalClauses.map((clause, index) => (
                      <div key={index} className="space-y-2 rounded-sm border bg-secondary/30 p-3">
                        <div className="flex items-center gap-2">
                          <input
                            aria-label={`Clause ${index + 1} heading`}
                            placeholder="Clause heading"
                            value={clause.heading}
                            onChange={(event) =>
                              updateTerms(
                                "additionalClauses",
                                draft.terms.additionalClauses.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? { ...item, heading: event.target.value }
                                    : item,
                                ),
                              )
                            }
                            className={inputClass}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`Remove clause ${index + 1}`}
                            onClick={() =>
                              updateTerms(
                                "additionalClauses",
                                draft.terms.additionalClauses.filter(
                                  (_, itemIndex) => itemIndex !== index,
                                ),
                              )
                            }
                          >
                            Remove
                          </Button>
                        </div>
                        <textarea
                          aria-label={`Clause ${index + 1} text`}
                          rows={3}
                          placeholder="Write the clause text"
                          value={clause.body}
                          onChange={(event) =>
                            updateTerms(
                              "additionalClauses",
                              draft.terms.additionalClauses.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, body: event.target.value } : item,
                              ),
                            )
                          }
                          className={inputClass}
                        />
                      </div>
                    ))}
                    {renderTermInput("Place of signing", "signingCity")}
                  </section>

                  <section className="space-y-3 rounded-sm border p-4">
                    <h2 className="signage text-lg text-navy">Internal notes</h2>
                    <textarea
                      aria-label="Internal contract notes"
                      rows={3}
                      placeholder="Internal notes (not included in the printed contract)"
                      value={draft.notes}
                      onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                      className={inputClass}
                    />
                  </section>

                  <section className="space-y-3 rounded-sm border p-4">
                    <h2 className="signage text-lg text-navy">Signed copy</h2>
                    {draft.document_path && (
                      <button
                        type="button"
                        onClick={() => void openDocument(draft.document_path!)}
                        className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:underline"
                      >
                        <ExternalLink aria-hidden="true" className="h-4 w-4" />
                        Open existing supporting document
                      </button>
                    )}
                    <label className="block space-y-1 text-sm font-medium">
                      Optional supporting draft (PDF or Word, max 10 MB)
                      <input
                        aria-label="Upload supporting draft contract document"
                        type="file"
                        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        onChange={(event) => setDocument(event.target.files?.[0] ?? null)}
                        className={inputClass}
                      />
                    </label>
                    {draft.signed_document_path && (
                      <button
                        type="button"
                        onClick={() => void openDocument(draft.signed_document_path!)}
                        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                      >
                        <ExternalLink aria-hidden="true" className="h-4 w-4" />
                        Open currently signed copy
                      </button>
                    )}
                    <label className="block space-y-1 text-sm font-medium">
                      Upload signed PDF, Word, JPEG, or PNG (max 10 MB)
                      <input
                        aria-label="Upload signed contract copy"
                        type="file"
                        accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png"
                        onChange={(event) => setSignedCopy(event.target.files?.[0] ?? null)}
                        className={inputClass}
                      />
                    </label>
                    {signedCopy && (
                      <p className="text-xs text-muted-foreground">
                        Selected: {signedCopy.name}. Uploading replaces the current signed-copy
                        link.
                      </p>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!draft.id || !signedCopy || uploadSignedCopy.isPending}
                      onClick={() => uploadSignedCopy.mutate()}
                    >
                      <Upload aria-hidden="true" className="mr-2 h-4 w-4" />
                      {uploadSignedCopy.isPending ? "Uploading…" : "Upload signed copy"}
                    </Button>
                    {!draft.id && (
                      <p className="text-xs text-muted-foreground">
                        Save the contract before uploading its signed copy.
                      </p>
                    )}
                  </section>

                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={save.isPending || uploadSignedCopy.isPending}>
                      <FileClock aria-hidden="true" className="mr-2 h-4 w-4" />
                      {save.isPending ? "Saving…" : "Save contract"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => printDraft(draft)}
                      disabled={
                        !draft.employee_id ||
                        (draft.contract_type !== "permanent" && !draft.end_date)
                      }
                    >
                      <Printer aria-hidden="true" className="mr-2 h-4 w-4" />
                      Preview & print
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setDraft(null);
                        setDocument(null);
                        setSignedCopy(null);
                      }}
                    >
                      Close builder
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Use a qualified local HR/legal adviser to review your template and clauses
                    before issuing contracts.
                  </p>
                  {employees.length === 0 && (
                    <p className="text-xs text-destructive">
                      Add an employee before creating a contract.
                    </p>
                  )}
                </div>

                <aside className="min-w-0 space-y-2 lg:sticky lg:top-0 lg:self-start">
                  <h2 className="signage text-lg text-navy">Live contract preview</h2>
                  <iframe
                    title="Printable employment contract preview"
                    sandbox=""
                    srcDoc={buildContractHtml(
                      {
                        contractType:
                          contractTypes.find((type) => type.value === draft.contract_type)?.label ??
                          draft.contract_type,
                        startDate: draft.start_date,
                        endDate: draft.end_date,
                      },
                      draft.terms,
                    )}
                    className="h-[75vh] w-full rounded-sm border bg-white"
                  />
                </aside>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
