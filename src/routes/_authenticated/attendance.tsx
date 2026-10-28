import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { PdfExportDialog } from "@/components/PdfExportDialog";
import type { PdfExportFilters } from "@/components/PdfExportDialog";
import { DatePicker } from "@/components/DatePicker";
import { StyledSelect } from "@/components/StyledSelect";
import { supabase } from "@/integrations/supabase/client";
import {
  getManualAttendanceStatus,
  parseAttendanceCsv,
  type ManualAttendanceStatus,
} from "@/lib/attendance";
import { downloadCsv } from "@/lib/export";
import { computeCasualOvertimeAmount, type CasualOvertimeMethod } from "@/lib/payroll";
import { ugx } from "@/lib/payroll";

function attendanceBoundary(date: string, end = false): string {
  const start = new Date(`${date}T00:00:00+03:00`);
  if (end) start.setUTCDate(start.getUTCDate() + 1);
  return start.toISOString();
}

function attendanceLocalDate(timestamp: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function attendanceLocalTime(timestamp: string): string {
  return new Intl.DateTimeFormat("en-UG", {
    timeZone: "Africa/Kampala",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function getKampalaDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const getPart = (type: string) => {
    const value = parts.find((part) => part.type === type)?.value;
    if (!value) throw new Error(`Could not determine the current Kampala ${type}.`);
    return value;
  };
  return `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
}

export const Route = createFileRoute("/_authenticated/attendance")({
  head: () => ({ meta: [{ title: "Attendance · BMP Media Production" }] }),
  component: Attendance,
});

function Attendance() {
  const qc = useQueryClient();
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [eventFilter, setEventFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [manualDate, setManualDate] = useState(getKampalaDate);
  const [manualSearch, setManualSearch] = useState("");
  const [manualStatusFilter, setManualStatusFilter] = useState("all");
  const [overtimeEmployeeId, setOvertimeEmployeeId] = useState("");
  const [overtimeSearch, setOvertimeSearch] = useState("");
  const [overtimeMethod, setOvertimeMethod] = useState<CasualOvertimeMethod>("direct_amount");
  const [overtimeAmount, setOvertimeAmount] = useState("");
  const [overtimeHours, setOvertimeHours] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const { data: isAdmin = false } = useQuery({
    queryKey: ["attendance-admin-access"],
    queryFn: async () => {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) return false;
      const { data, error } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", auth.user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
  });
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["attendance-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance_logs")
        .select("*, employees(full_name, employee_no)")
        .is("cancelled_at", null)
        .order("occurred_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });
  const { data: activeEmployees = [] } = useQuery({
    queryKey: ["attendance-active-employees"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, employee_no, full_name, position, employment_type")
        .eq("status", "active")
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });
  const { data: exportEmployees = [] } = useQuery({
    queryKey: ["attendance-export-employees"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, employee_no, full_name")
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });
  const manualDayStart = new Date(`${manualDate}T00:00:00+03:00`).toISOString();
  const manualDayEnd = new Date(
    new Date(`${manualDate}T00:00:00+03:00`).getTime() + 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data: manualLogs = [], isLoading: loadingManualLogs } = useQuery({
    queryKey: ["manual-attendance", manualDate],
    enabled: Boolean(manualDate),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance_logs")
        .select("id, employee_id, raw_event")
        .eq("event_type", "manual_attendance")
        .eq("device_serial", "MANUAL")
        .is("cancelled_at", null)
        .gte("occurred_at", manualDayStart)
        .lt("occurred_at", manualDayEnd);
      if (error) throw error;
      return data;
    },
  });
  const { data: overtimeEntries = [] } = useQuery({
    queryKey: ["casual-overtime-entries", manualDate],
    enabled: Boolean(manualDate),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("casual_overtime_entries")
        .select("*, employees(full_name, employee_no)")
        .eq("work_date", manualDate)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const filteredOvertimeEntries = overtimeEntries.filter((entry) =>
    `${entry.employees?.full_name ?? ""} ${entry.employees?.employee_no ?? ""}`
      .toLowerCase()
      .includes(overtimeSearch.trim().toLowerCase()),
  );

  const manualAttendance = useMutation({
    mutationFn: async ({
      employeeId,
      status,
    }: {
      employeeId: string;
      status: ManualAttendanceStatus | null;
    }) => {
      const occurredAt = new Date(`${manualDate}T12:00:00+03:00`).toISOString();
      const request = status
        ? supabase.from("attendance_logs").upsert(
            {
              employee_id: employeeId,
              occurred_at: occurredAt,
              event_type: "manual_attendance",
              device_serial: "MANUAL",
              raw_event: { input_method: "manual", attendance_status: status },
              cancelled_at: null,
              cancelled_by: null,
            },
            { onConflict: "employee_id,occurred_at,event_type,device_serial" },
          )
        : supabase
            .from("attendance_logs")
            .delete()
            .eq("employee_id", employeeId)
            .eq("occurred_at", occurredAt)
            .eq("event_type", "manual_attendance")
            .eq("device_serial", "MANUAL");
      const { error } = await request;
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["manual-attendance", manualDate] });
      qc.invalidateQueries({ queryKey: ["attendance-logs"] });
      toast.success("Manual attendance updated.");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const cancelAttendance = useMutation({
    mutationFn: async (logId: string) => {
      const { error } = await supabase.rpc("admin_cancel_manual_attendance", {
        p_log_id: logId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["manual-attendance", manualDate] });
      qc.invalidateQueries({ queryKey: ["attendance-logs"] });
      toast.success("Manual attendance mark cancelled.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const addOvertime = useMutation({
    mutationFn: async () => {
      if (!overtimeEmployeeId) throw new Error("Select a casual worker.");
      const amount = overtimeMethod === "hours_rate" ? undefined : Number(overtimeAmount);
      const hours = overtimeMethod === "hours_rate" ? Number(overtimeHours) : undefined;
      const rate = overtimeMethod === "hours_rate" ? Number(hourlyRate) : undefined;
      computeCasualOvertimeAmount({
        method: overtimeMethod,
        amount,
        hours,
        hourlyRate: rate,
      });
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) throw new Error("Sign in again before entering overtime.");
      const { error } = await supabase.from("casual_overtime_entries").upsert(
        {
          employee_id: overtimeEmployeeId,
          work_date: manualDate,
          method: overtimeMethod,
          amount,
          overtime_hours: hours,
          hourly_rate: rate,
          created_by: auth.user.id,
        },
        { onConflict: "employee_id,work_date,method" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["casual-overtime-entries", manualDate] });
      setOvertimeAmount("");
      setOvertimeHours("");
      setHourlyRate("");
      toast.success("Casual overtime saved.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".csv")) {
        throw new Error("Select a CSV export from the attendance machine.");
      }
      const events = parseAttendanceCsv(await file.text());
      if (!events.length) throw new Error("This CSV does not contain any attendance events.");
      if (events.length > 10_000) {
        throw new Error(
          "Import up to 10,000 events at a time. Split the export into smaller CSV files.",
        );
      }

      const { data: employees, error } = await supabase.from("employees").select("id, employee_no");
      if (error) throw error;
      const employeeIds = new Map(employees.map((employee) => [employee.employee_no, employee.id]));
      const missing = [
        ...new Set(
          events
            .filter((event) => !employeeIds.has(event.employee_no))
            .map((event) => event.employee_no),
        ),
      ];
      if (missing.length) {
        throw new Error(
          `These employee numbers do not match staff records: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "…" : ""}. Add or correct the staff records, then import again.`,
        );
      }

      const rows = events.map((event) => ({
        employee_id: employeeIds.get(event.employee_no)!,
        occurred_at: event.occurred_at,
        event_type: event.event_type,
        device_serial: event.device_serial,
        source_file: file.name,
        raw_event: event.raw_event,
      }));
      let processed = 0;
      for (let offset = 0; offset < rows.length; offset += 500) {
        const batch = rows.slice(offset, offset + 500);
        const { error: importError } = await supabase.from("attendance_logs").upsert(batch, {
          onConflict: "employee_id,occurred_at,event_type,device_serial",
          ignoreDuplicates: true,
        });
        if (importError) {
          throw new Error(
            `Import stopped after processing ${processed} of ${rows.length} events: ${importError.message}`,
          );
        }
        processed += batch.length;
      }
      return processed;
    },
    onSuccess: (processed) => {
      setUploadResult(`Processed ${processed} events. Duplicate events were ignored.`);
      qc.invalidateQueries({ queryKey: ["attendance-logs"] });
      toast.success(`Processed ${processed} attendance events`);
    },
    onError: (error: Error) => {
      setUploadResult(null);
      toast.error(error.message);
    },
  });

  const filteredLogs = logs.filter((log) => {
    const searchValue =
      `${log.employees?.full_name ?? ""} ${log.employees?.employee_no ?? ""} ${log.device_serial} ${log.event_type} ${log.source_file ?? ""}`.toLowerCase();
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Kampala",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(log.occurred_at));
    const date = `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
    return (
      searchValue.includes(search.trim().toLowerCase()) &&
      (eventFilter === "all" || log.event_type === eventFilter) &&
      (!fromDate || date >= fromDate) &&
      (!toDate || date <= toDate)
    );
  });
  const exportAttendance = async (filters: PdfExportFilters) => {
    const records: Array<{
      id: string;
      occurred_at: string;
      event_type: string;
      device_serial: string;
      source_file: string | null;
      raw_event: unknown;
      employees: { employee_no: string; full_name: string } | null;
    }> = [];
    for (let offset = 0; ; offset += 1000) {
      let query = supabase
        .from("attendance_logs")
        .select(
          "id, occurred_at, event_type, device_serial, source_file, raw_event, employees(employee_no, full_name)",
        )
        .is("cancelled_at", null)
        .order("occurred_at", { ascending: true })
        .range(offset, offset + 999);
      if (filters.fromDate) query = query.gte("occurred_at", attendanceBoundary(filters.fromDate));
      if (filters.toDate) query = query.lt("occurred_at", attendanceBoundary(filters.toDate, true));
      if (filters.employeeIds.length) query = query.in("employee_id", filters.employeeIds);
      if (filters.status !== "all") query = query.eq("event_type", filters.status);
      const { data, error } = await query;
      if (error) throw error;
      records.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const employeesById = new Set(records.map((record) => record.employees?.employee_no));
    const eventCounts = records.reduce<Record<string, number>>((counts, record) => {
      counts[record.event_type] = (counts[record.event_type] ?? 0) + 1;
      return counts;
    }, {});
    return {
      title: "Attendance log report",
      subtitle: "Attendance events within the selected date and employee filters.",
      filters: [
        [
          "Date range",
          `${filters.fromDate || "Earliest available"} to ${filters.toDate || "Latest available"}`,
        ],
        [
          "Employees",
          filters.employeeIds.length ? `${filters.employeeIds.length} selected` : "All employees",
        ],
        ["Event type", filters.status === "all" ? "All event types" : filters.status],
      ],
      summary: [
        ["Attendance events", String(records.length)],
        ["Employees represented", String(employeesById.size)],
        ...Object.entries(eventCounts).map(
          ([event, count]) => [event, String(count)] as [string, string],
        ),
      ],
      columns: [
        "Employee no.",
        "Employee",
        "Local date",
        "Time (EAT)",
        "Event / status",
        "Device",
        "Source file",
      ],
      rows: records.map((record) => [
        record.employees?.employee_no ?? "—",
        record.employees?.full_name ?? "Unknown staff",
        attendanceLocalDate(record.occurred_at),
        attendanceLocalTime(record.occurred_at),
        record.event_type === "manual_attendance"
          ? `Manual · ${getManualAttendanceStatus(record.raw_event)}`
          : record.event_type,
        record.device_serial || "—",
        record.source_file ?? "Manual entry",
      ]),
    };
  };
  const eventTypes = [...new Set(logs.map((log) => log.event_type))].sort();
  const manualStatusOptions = [
    { value: "all", label: "All attendance statuses" },
    { value: "unmarked", label: "Not marked" },
    { value: "present", label: "Present" },
    { value: "partial", label: "Partially attended" },
    { value: "late", label: "Late" },
    { value: "absent", label: "Absent" },
    { value: "leave", label: "On leave" },
  ];
  const filteredManualEmployees = activeEmployees.filter((employee) => {
    const log = manualLogs.find((item) => item.employee_id === employee.id);
    const status = log ? getManualAttendanceStatus(log.raw_event) : "unmarked";
    const searchText =
      `${employee.full_name} ${employee.employee_no} ${employee.position}`.toLowerCase();
    return (
      searchText.includes(manualSearch.trim().toLowerCase()) &&
      (manualStatusFilter === "all" || status === manualStatusFilter)
    );
  });

  return (
    <AppShell title="Attendance">
      <section className="mb-6 space-y-4 rounded-sm border bg-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="signage text-xl text-navy">Manual attendance</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Record each worker&apos;s status when the fingerprint machine or CSV is unavailable.
              Present, partially attended, and late entries count as one attendance day under the
              current payroll rules. Absent and on-leave entries are recorded but do not count as
              worked days.
            </p>
          </div>
          <label className="text-sm font-semibold">
            Attendance date
            <DatePicker
              value={manualDate}
              onChange={setManualDate}
              ariaLabel="Attendance date"
              className="mt-1 w-full"
            />
          </label>
        </div>
        {activeEmployees.length === 0 ? (
          <p className="rounded-sm border p-4 text-sm text-muted-foreground">
            Add staff records before marking attendance.
          </p>
        ) : (
          <>
            <div className="mb-3 grid gap-2 sm:grid-cols-2">
              <input
                aria-label="Search staff for manual attendance"
                placeholder="Search name, employee number, or position…"
                value={manualSearch}
                onChange={(event) => setManualSearch(event.target.value)}
                className="w-full rounded-sm border border-input bg-card px-3 py-2 text-sm"
              />
              <StyledSelect
                ariaLabel="Filter manual attendance by status"
                value={manualStatusFilter}
                onChange={setManualStatusFilter}
                options={manualStatusOptions}
              />
            </div>
            <p className="mb-2 text-xs text-muted-foreground">
              Showing {filteredManualEmployees.length} of {activeEmployees.length} active staff
            </p>
            {filteredManualEmployees.length === 0 ? (
              <p className="rounded-sm border p-4 text-center text-sm text-muted-foreground">
                No staff match these attendance filters.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                {filteredManualEmployees.map((employee) => {
                  const log = manualLogs.find((item) => item.employee_id === employee.id);
                  const status = log ? getManualAttendanceStatus(log.raw_event) : "";
                  return (
                    <article
                      key={employee.id}
                      className="min-w-0 rounded-sm border p-2 text-xs sm:p-3 sm:text-sm"
                    >
                      <div className="mb-1.5 min-w-0">
                        <span className="block truncate font-semibold">{employee.full_name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {employee.employee_no} · {employee.position}
                        </span>
                      </div>
                      <StyledSelect
                        aria-label={`${employee.full_name} attendance status`}
                        value={status}
                        disabled={loadingManualLogs || manualAttendance.isPending}
                        onChange={(value) =>
                          manualAttendance.mutate({
                            employeeId: employee.id,
                            status: value ? (value as ManualAttendanceStatus) : null,
                          })
                        }
                        options={[
                          { value: "", label: "Not marked" },
                          { value: "present", label: "Present" },
                          { value: "partial", label: "Partially attended" },
                          { value: "late", label: "Late" },
                          { value: "absent", label: "Absent" },
                          { value: "leave", label: "On leave" },
                        ]}
                        className="w-full rounded-sm border border-input bg-card px-2 py-1.5 text-xs"
                      />
                      {isAdmin && log && (
                        <button
                          type="button"
                          disabled={cancelAttendance.isPending}
                          onClick={() =>
                            confirm(
                              `Cancel ${employee.full_name}'s manual attendance mark? This will not change payroll runs that have already been created.`,
                            ) && cancelAttendance.mutate(log.id)
                          }
                          className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-destructive hover:underline disabled:opacity-50"
                        >
                          <X className="h-3 w-3" />
                          Cancel mark
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>

      <section className="mb-6 grid gap-5 rounded-sm border bg-card p-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.9fr)]">
        <div>
          <h2 className="signage text-xl text-navy">Casual overtime</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Add agreed overtime pay for the selected date. Choose a direct amount, hours multiplied
            by an hourly rate, or a fixed special-day bonus.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              addOvertime.mutate();
            }}
            className="mt-4 grid gap-3 sm:grid-cols-2"
          >
            <label className="text-sm font-semibold">
              Casual worker
              <StyledSelect
                ariaLabel="Casual worker"
                value={overtimeEmployeeId}
                onChange={setOvertimeEmployeeId}
                placeholder="Choose a worker"
                options={activeEmployees
                  .filter((employee) => employee.employment_type === "casual")
                  .map((employee) => ({
                    value: employee.id,
                    label: `${employee.employee_no} · ${employee.full_name}`,
                  }))}
                className="mt-1 w-full rounded-sm border border-input bg-card px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm font-semibold">
              Overtime method
              <StyledSelect
                ariaLabel="Overtime method"
                value={overtimeMethod}
                onChange={(value) => setOvertimeMethod(value as CasualOvertimeMethod)}
                options={[
                  { value: "direct_amount", label: "Direct amount" },
                  { value: "hours_rate", label: "Hours × hourly rate" },
                  { value: "special_day_bonus", label: "Special-day bonus" },
                ]}
                className="mt-1 w-full rounded-sm border border-input bg-card px-3 py-2 text-sm"
              />
            </label>
            {overtimeMethod === "hours_rate" ? (
              <>
                <label className="text-sm font-semibold">
                  Overtime hours
                  <input
                    required
                    min="0.25"
                    step="0.25"
                    type="number"
                    value={overtimeHours}
                    onChange={(event) => setOvertimeHours(event.target.value)}
                    className="mt-1 w-full rounded-sm border border-input bg-card px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm font-semibold">
                  Hourly rate (UGX)
                  <input
                    required
                    min="1"
                    type="number"
                    value={hourlyRate}
                    onChange={(event) => setHourlyRate(event.target.value)}
                    className="mt-1 w-full rounded-sm border border-input bg-card px-3 py-2 text-sm"
                  />
                </label>
              </>
            ) : (
              <label className="text-sm font-semibold sm:col-span-2">
                {overtimeMethod === "special_day_bonus"
                  ? "Special-day bonus (UGX)"
                  : "Overtime amount (UGX)"}
                <input
                  required
                  min="1"
                  type="number"
                  value={overtimeAmount}
                  onChange={(event) => setOvertimeAmount(event.target.value)}
                  className="mt-1 w-full rounded-sm border border-input bg-card px-3 py-2 text-sm"
                />
              </label>
            )}
            <button
              type="submit"
              disabled={addOvertime.isPending}
              className="signage w-fit rounded-sm bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
            >
              {addOvertime.isPending ? "Saving…" : "Save overtime"}
            </button>
          </form>
        </div>
        <div className="space-y-2">
          <h3 className="font-semibold">Overtime entered for {manualDate}</h3>
          {overtimeEntries.length > 0 && (
            <>
              <input
                aria-label="Search overtime entries"
                placeholder="Search worker name or number…"
                value={overtimeSearch}
                onChange={(event) => setOvertimeSearch(event.target.value)}
                className="w-full rounded-sm border border-input bg-card px-3 py-2 text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Showing {filteredOvertimeEntries.length} of {overtimeEntries.length} overtime
                entries
              </p>
            </>
          )}
          {overtimeEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No casual overtime added for this date.</p>
          ) : (
            filteredOvertimeEntries.map((entry) => {
              const amount = computeCasualOvertimeAmount({
                method: entry.method as CasualOvertimeMethod,
                amount: entry.amount ?? undefined,
                hours: entry.overtime_hours ?? undefined,
                hourlyRate: entry.hourly_rate ?? undefined,
              });
              return (
                <article key={entry.id} className="rounded-sm border p-3 text-sm">
                  <p className="font-semibold">
                    {entry.employees?.full_name} · {ugx(amount)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {entry.method === "hours_rate"
                      ? `${entry.overtime_hours} hours × ${ugx(Number(entry.hourly_rate))}/hour`
                      : entry.method === "special_day_bonus"
                        ? "Special-day bonus"
                        : "Direct overtime amount"}
                  </p>
                </article>
              );
            })
          )}
          {overtimeEntries.length > 0 && filteredOvertimeEntries.length === 0 && (
            <p className="text-sm text-muted-foreground">No overtime entries match that search.</p>
          )}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.7fr)]">
        <section className="rounded-sm border bg-card p-5">
          <h2 className="signage text-xl text-navy">Import attendance events</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Export a CSV from the Hikvision machine or attendance software, then upload it here.
            Events are checked against staff numbers; duplicate events are ignored.
          </p>
          <p className="mt-3 text-sm">
            Required columns: <code>employee_no</code> and <code>timestamp</code>. You can also use
            separate <code>date</code> and <code>time</code> columns. Add <code>event_type</code>{" "}
            with check_in/check_out values to calculate paired hours. Local timestamps are read as
            Uganda time.
          </p>
          <label className="mt-4 block">
            <span className="sr-only">Choose attendance CSV</span>
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={upload.isPending}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                if (file) {
                  setUploadResult(null);
                  upload.mutate(file);
                }
              }}
              className="block w-full text-sm file:mr-3 file:rounded-sm file:border-0 file:bg-primary file:px-4 file:py-2 file:font-semibold file:text-primary-foreground"
            />
          </label>
          {upload.isPending && (
            <p className="mt-3 text-sm font-semibold">Importing attendance events…</p>
          )}
          {uploadResult && (
            <p className="mt-3 text-sm font-semibold text-primary">{uploadResult}</p>
          )}
        </section>

        <aside className="rounded-sm border bg-secondary/40 p-5">
          <h2 className="signage text-xl text-navy">CSV example</h2>
          <pre className="mt-3 overflow-x-auto rounded-sm bg-card p-3 text-xs leading-6">
            {
              "employee_no,timestamp,event_type,device_serial\nHS-001,2026-10-05 08:00:00,check_in,STADIUM-01\nHS-001,2026-10-05 17:00:00,check_out,STADIUM-01"
            }
          </pre>
          <button
            onClick={() =>
              downloadCsv("attendance-import-template.csv", [
                ["employee_no", "timestamp", "event_type", "device_serial"],
                ["HS-001", "2026-10-05 08:00:00", "check_in", "STADIUM-01"],
                ["HS-001", "2026-10-05 17:00:00", "check_out", "STADIUM-01"],
              ])
            }
            className="mt-3 rounded-sm border bg-card px-3 py-2 text-sm font-semibold"
          >
            Download CSV template
          </button>
          <p className="mt-3 text-xs text-muted-foreground">
            Direct device connection depends on the Hikvision model, its supported connection method
            and access to the BMP company network.
          </p>
        </aside>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <h2 className="signage text-xl text-navy">Latest attendance events</h2>
        <div className="flex flex-wrap gap-2">
          <PdfExportDialog
            title="attendance logs"
            dateRange
            employees={exportEmployees.map((employee) => ({
              id: employee.id,
              label: `${employee.employee_no} · ${employee.full_name}`,
            }))}
            statuses={[
              { value: "all", label: "All event types" },
              ...eventTypes.map((eventType) => ({ value: eventType, label: eventType })),
            ]}
            onExport={exportAttendance}
          />
          <button
            disabled={!filteredLogs.length}
            onClick={() =>
              downloadCsv("bmp-attendance-events.csv", [
                ["Employee no.", "Employee", "Date and time", "Event", "Device", "Source file"],
                ...filteredLogs.map((log) => [
                  log.employees?.employee_no,
                  log.employees?.full_name,
                  log.occurred_at,
                  log.event_type,
                  log.device_serial,
                  log.source_file,
                ]),
              ])
            }
            className="rounded-sm border bg-card px-3 py-2 text-sm font-semibold disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <input
          aria-label="Search attendance events"
          placeholder="Search employee or device"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="rounded-sm border border-input bg-card px-3 py-2 text-sm"
        />
        <StyledSelect
          aria-label="Filter by event type"
          value={eventFilter}
          onChange={setEventFilter}
          options={[
            { value: "all", label: "All event types" },
            ...eventTypes.map((eventType) => ({ value: eventType, label: eventType })),
          ]}
          className="rounded-sm border border-input bg-card px-3 py-2 text-sm"
        />
        <label className="space-y-1 text-sm">
          <span className="block text-muted-foreground">From date</span>
          <DatePicker
            ariaLabel="From date"
            value={fromDate}
            onChange={setFromDate}
            clearable
            className="w-full"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-muted-foreground">To date</span>
          <DatePicker
            ariaLabel="To date"
            value={toDate}
            onChange={setToDate}
            clearable
            className="w-full"
          />
        </label>
      </div>
      {filteredLogs.length === 0 && !isLoading ? (
        <p className="mt-3 rounded-sm border bg-card p-8 text-center text-sm text-muted-foreground">
          No attendance events match these filters.
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-3">
          {filteredLogs.map((log) => (
            <article key={log.id} className="rounded-sm border bg-card p-3 sm:p-4">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {log.employees?.full_name ?? "Unknown staff"}
                  </p>
                  <p className="font-mono text-[11px] text-muted-foreground sm:text-xs">
                    {log.employees?.employee_no ?? "—"}
                  </p>
                </div>
                <span className="max-w-[46%] shrink rounded-sm bg-secondary px-2 py-1 text-[10px] font-semibold leading-tight sm:text-xs">
                  {log.event_type}
                </span>
              </div>
              <p className="mt-2 text-xs sm:text-sm">
                {new Date(log.occurred_at).toLocaleString("en-UG", {
                  timeZone: "Africa/Kampala",
                })}
              </p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="truncate text-[11px] text-muted-foreground sm:text-xs">
                  Device: {log.device_serial || "—"}
                </p>
                {isAdmin &&
                  log.event_type === "manual_attendance" &&
                  log.device_serial === "MANUAL" && (
                    <button
                      type="button"
                      disabled={cancelAttendance.isPending}
                      onClick={() =>
                        confirm(
                          "Cancel this manual attendance mark? This will not change payroll runs that have already been created.",
                        ) && cancelAttendance.mutate(log.id)
                      }
                      className="shrink-0 text-[11px] font-semibold text-destructive hover:underline disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  )}
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">Showing up to 200 of the latest events.</p>
    </AppShell>
  );
}
