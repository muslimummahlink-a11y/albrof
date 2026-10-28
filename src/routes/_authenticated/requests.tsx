import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { EmployeePhoto } from "@/components/EmployeePhoto";
import { DatePicker } from "@/components/DatePicker";
import { StyledSelect } from "@/components/StyledSelect";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/requests")({
  head: () => ({ meta: [{ title: "Leave and overtime · BMP Media Production" }] }),
  component: Requests,
});

function Requests() {
  const qc = useQueryClient();
  const [requestType, setRequestType] = useState<"leave" | "overtime">("leave");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [hours, setHours] = useState("");
  const [reason, setReason] = useState("");
  const [managerNotes, setManagerNotes] = useState<Record<string, string>>({});
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const { data: access } = useQuery({
    queryKey: ["request-access"],
    queryFn: async () => {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) throw new Error("Sign in to view requests.");
      const [{ data: roles, error: rolesError }, { data: employee, error: employeeError }] =
        await Promise.all([
          supabase.from("user_roles").select("role").eq("user_id", auth.user.id),
          supabase.from("employees").select("id").eq("auth_user_id", auth.user.id).maybeSingle(),
        ]);
      if (rolesError) throw rolesError;
      if (employeeError) throw employeeError;
      return {
        userId: auth.user.id,
        isStaff: Boolean(roles?.length),
        employeeId: employee?.id ?? null,
      };
    },
  });

  const { data: requests = [] } = useQuery({
    queryKey: ["employee-requests", access?.isStaff],
    enabled: Boolean(access),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_requests")
        .select("*, employees(full_name, employee_no, department, photo_path)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!access?.employeeId)
        throw new Error("Ask the BMP administrator to link your staff account first.");
      if (!startDate || !endDate || !reason.trim()) {
        throw new Error("Enter the dates and a reason for your request.");
      }
      if (endDate < startDate) throw new Error("The end date cannot be before the start date.");
      if (requestType === "overtime" && Number(hours) <= 0) {
        throw new Error("Enter the overtime hours.");
      }
      const { error } = await supabase.from("employee_requests").insert({
        employee_id: access.employeeId,
        request_type: requestType,
        start_date: startDate,
        end_date: requestType === "overtime" ? startDate : endDate,
        hours: requestType === "overtime" ? Number(hours) : null,
        reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employee-requests"] });
      setReason("");
      setHours("");
      toast.success("Request sent for review");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const review = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" }) => {
      if (!access?.isStaff || !access.userId) throw new Error("Only HR staff can review requests.");
      const { error } = await supabase
        .from("employee_requests")
        .update({
          status,
          manager_note: managerNotes[id]?.trim() || null,
          reviewed_by: access.userId,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("status", "pending");
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employee-requests"] });
      toast.success("Request reviewed");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const filteredRequests = requests.filter((request) => {
    const searchText =
      `${request.employees?.full_name ?? ""} ${request.employees?.employee_no ?? ""} ${request.reason} ${request.manager_note ?? ""} ${request.start_date} ${request.end_date}`.toLowerCase();
    return (
      (statusFilter === "all" || request.status === statusFilter) &&
      (typeFilter === "all" || request.request_type === typeFilter) &&
      (!fromDate || request.start_date >= fromDate) &&
      (!toDate || request.start_date <= toDate) &&
      searchText.includes(search.trim().toLowerCase())
    );
  });

  const inputClass = "mt-1 w-full rounded-sm border border-input bg-card px-3 py-2 text-sm";

  return (
    <AppShell title="Leave and overtime">
      {access?.employeeId && (
        <section className="rounded-sm border bg-card p-5">
          <h2 className="signage text-xl text-navy">Submit a request</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Leave and overtime requests are sent to HR for approval. Approved overtime hours appear
            in weekly payroll summaries; overtime pay is not calculated automatically.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit.mutate();
            }}
            className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            <label className="text-sm font-semibold">
              Request
              <StyledSelect
                ariaLabel="Request type"
                value={requestType}
                onChange={(value) => {
                  if (value === "leave" || value === "overtime") setRequestType(value);
                }}
                options={[
                  { value: "leave", label: "Leave" },
                  { value: "overtime", label: "Overtime" },
                ]}
                className={inputClass}
              />
            </label>
            <label className="text-sm font-semibold">
              {requestType === "overtime" ? "Work date" : "Start date"}
              <DatePicker
                ariaLabel={requestType === "overtime" ? "Work date" : "Start date"}
                value={startDate}
                onChange={setStartDate}
              />
            </label>
            {requestType === "leave" ? (
              <label className="text-sm font-semibold">
                End date
                <DatePicker ariaLabel="End date" value={endDate} onChange={setEndDate} />
              </label>
            ) : (
              <label className="text-sm font-semibold">
                Overtime hours
                <input
                  required
                  min="0.25"
                  step="0.25"
                  type="number"
                  value={hours}
                  onChange={(event) => setHours(event.target.value)}
                  className={inputClass}
                />
              </label>
            )}
            <label className="text-sm font-semibold sm:col-span-2 lg:col-span-3">
              Reason
              <textarea
                required
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className={inputClass}
                rows={2}
              />
            </label>
            <button
              disabled={submit.isPending}
              className="signage w-fit rounded-sm bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
            >
              {submit.isPending ? "Sending…" : "Send request"}
            </button>
          </form>
        </section>
      )}

      <section className="mt-6 rounded-sm border bg-card p-4 sm:p-5">
        <div className="mb-4">
          <h2 className="signage text-xl text-navy">
            {access?.isStaff ? "Requests for review" : "My requests"}
          </h2>
          {access && !access.employeeId && !access.isStaff && (
            <p className="mt-1 text-sm text-muted-foreground">
              Ask the BMP administrator to link your staff account before submitting a request.
            </p>
          )}
        </div>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <input
            aria-label="Search requests"
            placeholder="Search staff, reason, date…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={inputClass}
          />
          <StyledSelect
            aria-label="Filter requests by status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "all", label: "All statuses" },
              { value: "pending", label: "Pending" },
              { value: "approved", label: "Approved" },
              { value: "rejected", label: "Rejected" },
            ]}
            className={inputClass}
          />
          <StyledSelect
            aria-label="Filter requests by type"
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { value: "all", label: "All request types" },
              { value: "leave", label: "Leave" },
              { value: "overtime", label: "Overtime" },
            ]}
            className={inputClass}
          />
          <label className="space-y-1 text-sm">
            <span className="block text-muted-foreground">From date</span>
            <DatePicker
              ariaLabel="Filter requests from date"
              value={fromDate}
              onChange={setFromDate}
              clearable
              className="w-full"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="block text-muted-foreground">To date</span>
            <DatePicker
              ariaLabel="Filter requests to date"
              value={toDate}
              onChange={setToDate}
              clearable
              className="w-full"
            />
          </label>
        </div>
        {filteredRequests.length === 0 ? (
          <p className="rounded-sm border p-8 text-center text-sm text-muted-foreground">
            No requests match these filters.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            {filteredRequests.map((request) => (
              <article key={request.id} className="rounded-sm border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    {access?.isStaff && (
                      <div className="mb-2 flex items-center gap-2">
                        <EmployeePhoto
                          path={request.employees?.photo_path}
                          name={request.employees?.full_name ?? "Unknown staff"}
                          className="h-9 w-9"
                        />
                        <div>
                          <p className="font-semibold">{request.employees?.full_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {request.employees?.employee_no} · {request.employees?.department}
                          </p>
                        </div>
                      </div>
                    )}
                    <p className={`${access?.isStaff ? "mt-2" : ""} font-semibold capitalize`}>
                      {request.request_type} request
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-sm px-2 py-1 text-xs font-bold uppercase ${request.status === "approved" ? "bg-accent text-accent-foreground" : request.status === "rejected" ? "bg-destructive/10 text-destructive" : "bg-secondary"}`}
                  >
                    {request.status}
                  </span>
                </div>
                <p className="mt-3 text-sm">
                  {request.start_date}
                  {request.end_date !== request.start_date && ` – ${request.end_date}`}
                  {request.hours ? ` · ${request.hours} hours` : ""}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                  {request.reason}
                </p>
                {access?.isStaff && request.status === "pending" ? (
                  <div className="mt-4 space-y-2 border-t pt-3">
                    <input
                      aria-label={`Review note for ${request.employees?.full_name}`}
                      value={managerNotes[request.id] ?? ""}
                      onChange={(event) =>
                        setManagerNotes({ ...managerNotes, [request.id]: event.target.value })
                      }
                      placeholder="Optional review note"
                      className="w-full rounded-sm border bg-card px-2 py-2 text-sm"
                    />
                    <div className="flex gap-4">
                      <button
                        onClick={() => review.mutate({ id: request.id, status: "approved" })}
                        disabled={review.isPending}
                        className="text-sm font-bold text-primary disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => review.mutate({ id: request.id, status: "rejected" })}
                        disabled={review.isPending}
                        className="text-sm font-bold text-destructive disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ) : (
                  request.manager_note && (
                    <p className="mt-3 border-t pt-3 text-sm text-muted-foreground">
                      Review note: {request.manager_note}
                    </p>
                  )
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
