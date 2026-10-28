import { useState } from "react";
import { FileDown } from "lucide-react";
import { DatePicker } from "@/components/DatePicker";
import { MonthPicker } from "@/components/MonthPicker";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StyledSelect } from "@/components/StyledSelect";
import { openPdfWindow, type PdfReport, printPdfReport } from "@/lib/pdf-export";
import { toast } from "sonner";

export type PdfExportFilters = {
  fromDate: string;
  toDate: string;
  employeeIds: string[];
  month: string;
  department: string;
  status: string;
  includeSensitive: boolean;
};

type PdfExportDialogProps = {
  title: string;
  description?: string;
  employees?: Array<{ id: string; label: string }>;
  dateRange?: boolean;
  month?: boolean;
  departments?: string[];
  statuses?: Array<{ value: string; label: string }>;
  includeSensitiveDetails?: boolean;
  onExport: (filters: PdfExportFilters) => PdfReport | Promise<PdfReport>;
};

export function PdfExportDialog({
  title,
  description = "Choose what to include. The report opens in a print-ready window; select Save as PDF to download it.",
  employees,
  dateRange = false,
  month = false,
  departments,
  statuses,
  includeSensitiveDetails = false,
  onExport,
}: PdfExportDialogProps) {
  const [open, setOpen] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [department, setDepartment] = useState("all");
  const [status, setStatus] = useState("all");
  const [includeSensitive, setIncludeSensitive] = useState(false);
  const [pending, setPending] = useState(false);

  const visibleEmployees = employees?.filter((employee) =>
    employee.label.toLowerCase().includes(employeeSearch.trim().toLowerCase()),
  );

  const exportReport = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (fromDate && toDate && fromDate > toDate) {
      toast.error("The start date must be on or before the end date.");
      return;
    }
    let target: Window;
    try {
      target = openPdfWindow();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open the PDF window.");
      return;
    }
    setPending(true);
    try {
      const report = await onExport({
        fromDate,
        toDate,
        employeeIds,
        month: selectedMonth,
        department,
        status,
        includeSensitive,
      });
      printPdfReport(target, report);
      setOpen(false);
    } catch (error) {
      target.close();
      toast.error(error instanceof Error ? error.message : "Could not prepare the PDF report.");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-sm border bg-card px-3 py-2 text-sm font-semibold hover:bg-secondary"
      >
        <FileDown className="h-4 w-4" />
        Export PDF
      </button>
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="signage text-2xl text-navy">Export {title} PDF</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <form onSubmit={exportReport} className="space-y-4">
            {dateRange && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm font-semibold">
                  From
                  <DatePicker
                    ariaLabel="PDF export start date"
                    value={fromDate}
                    onChange={setFromDate}
                    clearable
                    className="w-full"
                  />
                </label>
                <label className="space-y-1 text-sm font-semibold">
                  To
                  <DatePicker
                    ariaLabel="PDF export end date"
                    value={toDate}
                    onChange={setToDate}
                    clearable
                    className="w-full"
                  />
                </label>
              </div>
            )}
            {month && (
              <label className="block space-y-1 text-sm font-semibold">
                Payroll month
                <MonthPicker
                  ariaLabel="PDF export month"
                  value={selectedMonth}
                  onChange={setSelectedMonth}
                  className="w-full"
                />
              </label>
            )}
            {departments && (
              <label className="block space-y-1 text-sm font-semibold">
                Department
                <StyledSelect
                  ariaLabel="PDF export department"
                  value={department}
                  onChange={setDepartment}
                  options={[
                    { value: "all", label: "All departments" },
                    ...departments.map((value) => ({ value, label: value })),
                  ]}
                />
              </label>
            )}
            {statuses && (
              <label className="block space-y-1 text-sm font-semibold">
                Status
                <StyledSelect
                  ariaLabel="PDF export status"
                  value={status}
                  onChange={setStatus}
                  options={statuses}
                />
              </label>
            )}
            {includeSensitiveDetails && (
              <label className="flex cursor-pointer items-center gap-2 rounded-sm border p-3 text-sm">
                <Checkbox
                  checked={includeSensitive}
                  onCheckedChange={(checked) => setIncludeSensitive(checked === true)}
                />
                <span>Include confidential bank and NSSF details</span>
              </label>
            )}
            {employees && employees.length > 0 && (
              <section className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">Employees</p>
                    <p className="text-xs text-muted-foreground">
                      {employeeIds.length ? `${employeeIds.length} selected` : "All employees"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEmployeeIds([])}
                      className="text-xs font-semibold text-primary hover:underline"
                    >
                      All employees
                    </button>
                  </div>
                </div>
                {employees.length > 8 && (
                  <input
                    aria-label="Search employees for PDF export"
                    value={employeeSearch}
                    onChange={(event) => setEmployeeSearch(event.target.value)}
                    placeholder="Find an employee…"
                    className="w-full rounded-sm border bg-card px-3 py-2 text-sm"
                  />
                )}
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-sm border p-2">
                  {visibleEmployees?.map((employee) => (
                    <label
                      key={employee.id}
                      className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-secondary"
                    >
                      <Checkbox
                        checked={!employeeIds.length || employeeIds.includes(employee.id)}
                        onCheckedChange={(checked) => {
                          setEmployeeIds((current) => {
                            const selected = current.length
                              ? current
                              : employees.map((option) => option.id);
                            const next = checked
                              ? [...new Set([...selected, employee.id])]
                              : selected.filter((id) => id !== employee.id);
                            return next.length === employees.length ? [] : next;
                          });
                        }}
                      />
                      <span>{employee.label}</span>
                    </label>
                  ))}
                  {visibleEmployees?.length === 0 && (
                    <p className="p-2 text-sm text-muted-foreground">No matching employees.</p>
                  )}
                </div>
              </section>
            )}
            <DialogFooter>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="rounded-sm border px-4 py-2 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {pending ? "Preparing…" : "Continue to PDF"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
