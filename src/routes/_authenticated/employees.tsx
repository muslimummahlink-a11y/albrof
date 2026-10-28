import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Trash2, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Json, Tables } from "@/integrations/supabase/types";
import { AppShell } from "@/components/AppShell";
import { EmployeePhoto } from "@/components/EmployeePhoto";
import { PdfExportDialog } from "@/components/PdfExportDialog";
import { StyledSelect } from "@/components/StyledSelect";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { computePayslip, ugx } from "@/lib/payroll";

export const Route = createFileRoute("/_authenticated/employees")({
  head: () => ({ meta: [{ title: "Staff · BMP Media Production" }] }),
  component: Employees,
});

type Emp = Tables<"employees">;
type EmployeeDocument = { name: string; path: string };
type EmployeeSaveInput = {
  employee: Partial<Emp>;
  photo: File | null;
  cv: File | null;
  applicationLetter: File | null;
  otherDocuments: File[];
};
const DEPTS = [
  "Administration",
  "Grounds & Pitch",
  "Security",
  "Operations",
  "Maintenance",
  "Ticketing",
  "Catering",
];
const empty = {
  employee_no: "",
  full_name: "",
  position: "",
  department: "Administration",
  phone: "",
  bank_name: "",
  account_no: "",
  nssf_no: "",
  base_salary: 0,
  allowances: 0,
  employment_type: "salaried",
  daily_rate: null,
  status: "active",
  auth_user_id: null,
  photo_path: null,
  cv_path: null,
  application_letter_path: null,
  other_documents: [],
};

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const DOCUMENT_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "text/plain",
];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function documentsOf(value: Json | null | undefined): EmployeeDocument[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((document) => {
    if (typeof document !== "object" || document === null || Array.isArray(document)) return [];
    const name = document["name"];
    const path = document["path"];
    return typeof name === "string" && typeof path === "string" ? [{ name, path }] : [];
  });
}

function Employees() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [employmentFilter, setEmploymentFilter] = useState("all");
  const [edit, setEdit] = useState<Partial<Emp> | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [applicationLetterFile, setApplicationLetterFile] = useState<File | null>(null);
  const [otherDocumentFiles, setOtherDocumentFiles] = useState<File[]>([]);
  const { data: emps = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: async () =>
      (await supabase.from("employees").select("*").order("full_name")).data ?? [],
  });

  const save = useMutation({
    mutationFn: async ({
      employee,
      photo,
      cv,
      applicationLetter,
      otherDocuments,
    }: EmployeeSaveInput) => {
      if (photo && (!PHOTO_TYPES.includes(photo.type) || photo.size > 5 * 1024 * 1024)) {
        throw new Error("Photo must be a JPEG, PNG, or WebP no larger than 5 MB.");
      }
      const allDocuments = [cv, applicationLetter, ...otherDocuments].filter(
        (file): file is File => file !== null,
      );
      if (
        allDocuments.some(
          (file) => !DOCUMENT_TYPES.includes(file.type) || file.size > MAX_FILE_SIZE,
        )
      ) {
        throw new Error(
          "Documents must be PDF, Word, PNG, JPEG, or text files no larger than 10 MB each.",
        );
      }

      const { id, created_at, ...rest } = employee as Emp;
      const payload = {
        ...rest,
        auth_user_id: rest.auth_user_id?.trim() || null,
        base_salary: rest.employment_type === "casual" ? 0 : Number(rest.base_salary),
        allowances: rest.employment_type === "casual" ? 0 : Number(rest.allowances),
        daily_rate:
          rest.employment_type === "casual" && rest.daily_rate != null
            ? Number(rest.daily_rate)
            : null,
      };
      const employeeId = id ?? crypto.randomUUID();
      const { error: saveError } = id
        ? await supabase.from("employees").update(payload).eq("id", employeeId)
        : await supabase.from("employees").insert({ ...payload, id: employeeId });
      if (saveError) throw saveError;

      const filePaths = {
        photo_path: payload.photo_path ?? null,
        cv_path: payload.cv_path ?? null,
        application_letter_path: payload.application_letter_path ?? null,
        other_documents: documentsOf(payload.other_documents),
      };
      const uploadFile = async (file: File, category: string) => {
        const safeName = file.name.replace(/[\\/:*?"<>|]/g, "_");
        const path = `${employeeId}/${category}/${crypto.randomUUID()}-${safeName}`;
        const { error } = await supabase.storage
          .from("employee-documents")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (error) throw error;
        return path;
      };

      let uploadError: string | null = null;
      try {
        if (photo) filePaths.photo_path = await uploadFile(photo, "photo");
        if (cv) filePaths.cv_path = await uploadFile(cv, "cv");
        if (applicationLetter) {
          filePaths.application_letter_path = await uploadFile(
            applicationLetter,
            "application-letter",
          );
        }
        for (const document of otherDocuments) {
          filePaths.other_documents.push({
            name: document.name,
            path: await uploadFile(document, "other"),
          });
        }
      } catch (error) {
        uploadError = error instanceof Error ? error.message : "Unknown upload error.";
      }

      const { error: filesSaveError } = await supabase
        .from("employees")
        .update(filePaths)
        .eq("id", employeeId);
      if (filesSaveError) {
        throw new Error(
          uploadError
            ? `Staff details were saved, but uploaded files could not be linked: ${filesSaveError.message}`
            : `Staff details were saved, but document links could not be updated: ${filesSaveError.message}`,
        );
      }

      return {
        employee: { ...employee, ...payload, ...filePaths, id: employeeId },
        uploadError,
      };
    },
    onSuccess: ({ employee, uploadError }) => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      if (uploadError) {
        setEdit(employee);
        setPhotoFile(null);
        setCvFile(null);
        setApplicationLetterFile(null);
        setOtherDocumentFiles([]);
        toast.error(`Staff saved, but a document upload failed: ${uploadError}`);
      } else {
        closeEditor();
        toast.success("Staff saved");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("employees").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employees"] }),
  });

  const list = emps.filter((employee) => {
    const matchesSearch =
      `${employee.full_name} ${employee.employee_no} ${employee.department} ${employee.position} ${employee.phone ?? ""}`
        .toLowerCase()
        .includes(q.trim().toLowerCase());
    return (
      matchesSearch &&
      (statusFilter === "all" || employee.status === statusFilter) &&
      (departmentFilter === "all" || employee.department === departmentFilter) &&
      (employmentFilter === "all" || employee.employment_type === employmentFilter)
    );
  });
  const f = (k: keyof Emp) => ({
    value: (edit?.[k] as string | number) ?? "",
    onChange: (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setEdit({ ...edit, [k]: ev.target.value }),
  });
  const exportEmployees = (filters: {
    employeeIds: string[];
    status: string;
    department: string;
    includeSensitive: boolean;
  }) => {
    const selected = emps.filter(
      (employee) =>
        (!filters.employeeIds.length || filters.employeeIds.includes(employee.id)) &&
        (filters.status === "all" || employee.status === filters.status) &&
        (filters.department === "all" || employee.department === filters.department),
    );
    const salaried = selected.filter((employee) => employee.employment_type !== "casual");
    const columns = [
      "Employee no.",
      "Full name",
      "Position",
      "Department",
      "Employment type",
      "Status",
      "Phone",
      "Hired on",
    ];
    if (filters.includeSensitive) {
      columns.push(
        "Basic monthly salary (UGX)",
        "Allowances (UGX)",
        "Casual daily rate (UGX)",
        "Bank",
        "Account no.",
        "NSSF no.",
      );
    }
    return {
      title: "Employee register",
      subtitle: "Staff details for the selected employees and status.",
      filters: [
        [
          "Employees",
          filters.employeeIds.length ? `${filters.employeeIds.length} selected` : "All employees",
        ],
        ["Status", filters.status === "all" ? "All statuses" : filters.status],
        ["Department", filters.department],
        [
          "Confidential pay and bank fields",
          filters.includeSensitive ? "Included" : "Not included",
        ],
      ],
      summary: [
        ["Employees listed", String(selected.length)],
        [
          "Active staff",
          String(selected.filter((employee) => employee.status === "active").length),
        ],
        ["Salaried staff", String(salaried.length)],
        ["Casual workers", String(selected.length - salaried.length)],
        [
          "Monthly salary commitment",
          ugx(
            salaried.reduce(
              (sum, employee) => sum + Number(employee.base_salary) + Number(employee.allowances),
              0,
            ),
          ),
        ],
      ],
      columns,
      rows: selected.map((employee) => [
        employee.employee_no,
        employee.full_name,
        employee.position,
        employee.department,
        employee.employment_type,
        employee.status,
        employee.phone ?? "—",
        employee.hired_on,
        ...(filters.includeSensitive
          ? [
              employee.base_salary,
              employee.allowances,
              employee.daily_rate ?? "—",
              employee.bank_name ?? "—",
              employee.account_no ?? "—",
              employee.nssf_no ?? "—",
            ]
          : []),
      ]),
    };
  };
  const inp =
    "w-full rounded-sm border border-input bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
  const fileInput =
    "mt-1 block w-full rounded-sm border border-input bg-card px-3 py-2 text-xs font-normal";

  function openEditor(employee: Partial<Emp>) {
    setPhotoFile(null);
    setCvFile(null);
    setApplicationLetterFile(null);
    setOtherDocumentFiles([]);
    setEdit(employee);
  }

  function closeEditor() {
    setEdit(null);
    setPhotoFile(null);
    setCvFile(null);
    setApplicationLetterFile(null);
    setOtherDocumentFiles([]);
  }

  async function openEmployeeFile(path: string, label: string) {
    const { data, error } = await supabase.storage
      .from("employee-documents")
      .createSignedUrl(path, 60);
    if (error) {
      toast.error(`${label} could not be opened: ${error.message}`);
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <AppShell
      title="Staff"
      actions={
        <div className="flex flex-wrap gap-2">
          <PdfExportDialog
            title="employee details"
            employees={emps.map((employee) => ({
              id: employee.id,
              label: `${employee.employee_no} · ${employee.full_name}`,
            }))}
            departments={DEPTS}
            statuses={[
              { value: "all", label: "All statuses" },
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ]}
            includeSensitiveDetails
            onExport={exportEmployees}
          />
          <button
            onClick={() => openEditor(empty)}
            className="signage flex items-center gap-1 rounded-sm bg-primary px-4 py-2 text-primary-foreground"
          >
            <Plus className="h-4 w-4" />
            Add staff
          </button>
        </div>
      }
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <input
          aria-label="Search staff"
          placeholder="Search name, number, position…"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          className={inp}
        />
        <StyledSelect
          aria-label="Filter staff by status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "all", label: "All statuses" },
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
          ]}
          className={inp}
        />
        <StyledSelect
          aria-label="Filter staff by department"
          value={departmentFilter}
          onChange={setDepartmentFilter}
          options={[
            { value: "all", label: "All departments" },
            ...DEPTS.map((department) => ({ value: department, label: department })),
          ]}
          className={inp}
        />
        <StyledSelect
          aria-label="Filter staff by pay type"
          value={employmentFilter}
          onChange={setEmploymentFilter}
          options={[
            { value: "all", label: "All pay types" },
            { value: "salaried", label: "Salaried" },
            { value: "casual", label: "Casual workers" },
          ]}
          className={inp}
        />
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        Showing {list.length} of {emps.length} staff records
      </p>
      {list.length === 0 ? (
        <p className="rounded-sm border bg-card p-8 text-center text-muted-foreground">
          No staff match these filters.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
          {list.map((employee) => {
            const pay =
              employee.employment_type === "casual"
                ? null
                : computePayslip(employee.base_salary, employee.allowances);
            return (
              <article key={employee.id} className="overflow-hidden rounded-sm border bg-card">
                <div className="diamond-lattice h-2" />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <EmployeePhoto
                        path={employee.photo_path}
                        name={employee.full_name}
                        className="h-12 w-12"
                      />
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{employee.full_name}</p>
                        <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                          {employee.employee_no}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-sm px-2 py-0.5 text-xs font-bold uppercase ${employee.status === "active" ? "bg-accent text-accent-foreground" : "bg-secondary text-muted-foreground"}`}
                    >
                      {employee.status}
                    </span>
                  </div>
                  <p className="mt-3 text-sm">
                    {employee.position} · {employee.department}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {employee.employment_type === "casual" ? "Casual worker" : "Salaried staff"}
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-3 border-t pt-3 text-sm">
                    {pay ? (
                      <>
                        <div>
                          <p className="text-xs text-muted-foreground">Monthly gross</p>
                          <p className="mt-1 font-semibold">{ugx(pay.gross)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Monthly net</p>
                          <p className="mt-1 font-semibold">{ugx(pay.net)}</p>
                        </div>
                      </>
                    ) : (
                      <div>
                        <p className="text-xs text-muted-foreground">Daily rate</p>
                        <p className="mt-1 font-semibold">
                          {ugx(Number(employee.daily_rate ?? 0))}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="mt-4 flex justify-end gap-3 border-t pt-3">
                    <button
                      aria-label={`Edit ${employee.full_name}`}
                      onClick={() => openEditor(employee)}
                      className="rounded-sm p-2 text-navy hover:bg-secondary"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      aria-label={`Delete ${employee.full_name}`}
                      onClick={() =>
                        confirm(`Remove ${employee.full_name}?`) && del.mutate(employee.id)
                      }
                      className="rounded-sm p-2 text-destructive hover:bg-secondary"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Dialog open={!!edit} onOpenChange={(o) => !o && closeEditor()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="signage text-2xl text-navy">
              {edit?.id ? "Edit staff" : "New staff member"}
            </DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (edit) {
                save.mutate({
                  employee: edit,
                  photo: photoFile,
                  cv: cvFile,
                  applicationLetter: applicationLetterFile,
                  otherDocuments: otherDocumentFiles,
                });
              }
            }}
            className="grid gap-3 sm:grid-cols-2"
          >
            <label className="text-xs font-bold">
              Employee no.
              <input required className={inp} {...f("employee_no")} />
            </label>
            <label className="text-xs font-bold">
              Full name
              <input required className={inp} {...f("full_name")} />
            </label>
            <label className="text-xs font-bold">
              Role / Position
              <input required className={inp} {...f("position")} />
            </label>
            <label className="text-xs font-bold">
              Department
              <StyledSelect
                ariaLabel="Department"
                value={String(edit?.department ?? "")}
                onChange={(value) => setEdit({ ...edit, department: value })}
                options={DEPTS.map((department) => ({ value: department, label: department }))}
                className={inp}
              />
            </label>
            <label className="text-xs font-bold">
              Pay type
              <StyledSelect
                ariaLabel="Pay type"
                value={String(edit?.employment_type ?? "salaried")}
                onChange={(value) => setEdit({ ...edit, employment_type: value })}
                options={[
                  { value: "salaried", label: "Salaried" },
                  { value: "casual", label: "Casual worker (daily rate)" },
                ]}
                className={inp}
              />
            </label>
            {edit?.employment_type === "casual" ? (
              <label className="text-xs font-bold">
                Daily rate (UGX)
                <input type="number" min={1} required className={inp} {...f("daily_rate")} />
              </label>
            ) : (
              <>
                <label className="text-xs font-bold">
                  Basic salary (UGX)
                  <input type="number" min={0} required className={inp} {...f("base_salary")} />
                </label>
                <label className="text-xs font-bold">
                  Allowances (UGX)
                  <input type="number" min={0} className={inp} {...f("allowances")} />
                </label>
              </>
            )}
            <label className="text-xs font-bold">
              Phone
              <input className={inp} {...f("phone")} />
            </label>
            <label className="text-xs font-bold">
              NSSF no.
              <input className={inp} {...f("nssf_no")} />
            </label>
            <label className="text-xs font-bold">
              Linked account ID (optional)
              <input
                className={inp}
                placeholder="Employee's Supabase user UUID"
                {...f("auth_user_id")}
              />
            </label>
            <label className="text-xs font-bold">
              Bank
              <input className={inp} {...f("bank_name")} />
            </label>
            <label className="text-xs font-bold">
              Account no.
              <input className={inp} {...f("account_no")} />
            </label>
            <label className="text-xs font-bold">
              Status
              <StyledSelect
                ariaLabel="Staff status"
                value={String(edit?.status ?? "active")}
                onChange={(value) => setEdit({ ...edit, status: value })}
                options={[
                  { value: "active", label: "Active" },
                  { value: "inactive", label: "Inactive" },
                ]}
                className={inp}
              />
            </label>
            <section className="grid gap-3 rounded-sm border p-3 sm:col-span-2 sm:grid-cols-2">
              <h3 className="text-sm font-bold sm:col-span-2">Staff photo and documents</h3>
              <div className="text-xs font-bold">
                <label htmlFor="employee-photo">Photo (JPEG, PNG, or WebP; max 5 MB)</label>
                <input
                  id="employee-photo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className={fileInput}
                  onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)}
                />
                {edit?.photo_path && (
                  <button
                    type="button"
                    className="mt-1 text-left font-normal text-primary underline"
                    onClick={() => openEmployeeFile(edit.photo_path!, "Staff photo")}
                  >
                    View current photo
                  </button>
                )}
              </div>
              <div className="text-xs font-bold">
                <label htmlFor="employee-cv">CV / résumé (max 10 MB)</label>
                <input
                  id="employee-cv"
                  type="file"
                  accept=".pdf,.doc,.docx,.txt,image/jpeg,image/png"
                  className={fileInput}
                  onChange={(event) => setCvFile(event.target.files?.[0] ?? null)}
                />
                {edit?.cv_path && (
                  <button
                    type="button"
                    className="mt-1 text-left font-normal text-primary underline"
                    onClick={() => openEmployeeFile(edit.cv_path!, "CV")}
                  >
                    View current CV
                  </button>
                )}
              </div>
              <div className="text-xs font-bold">
                <label htmlFor="employee-application-letter">Application letter (max 10 MB)</label>
                <input
                  id="employee-application-letter"
                  type="file"
                  accept=".pdf,.doc,.docx,.txt,image/jpeg,image/png"
                  className={fileInput}
                  onChange={(event) => setApplicationLetterFile(event.target.files?.[0] ?? null)}
                />
                {edit?.application_letter_path && (
                  <button
                    type="button"
                    className="mt-1 text-left font-normal text-primary underline"
                    onClick={() =>
                      openEmployeeFile(edit.application_letter_path!, "Application letter")
                    }
                  >
                    View current application letter
                  </button>
                )}
              </div>
              <div className="text-xs font-bold">
                <label htmlFor="employee-other-documents">
                  Other documents (multiple files, max 10 MB each)
                </label>
                <input
                  id="employee-other-documents"
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.txt,image/jpeg,image/png"
                  className={fileInput}
                  onChange={(event) => setOtherDocumentFiles(Array.from(event.target.files ?? []))}
                />
                {documentsOf(edit?.other_documents).map((document) => (
                  <button
                    key={document.path}
                    type="button"
                    className="mt-1 block text-left font-normal text-primary underline"
                    onClick={() => openEmployeeFile(document.path, document.name)}
                  >
                    {document.name}
                  </button>
                ))}
              </div>
            </section>
            <div className="flex items-end justify-end gap-2 sm:col-span-2">
              <button
                type="button"
                onClick={closeEditor}
                className="rounded-sm border px-4 py-2 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                disabled={save.isPending}
                className="signage rounded-sm bg-primary px-5 py-2 text-primary-foreground"
              >
                Save
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
