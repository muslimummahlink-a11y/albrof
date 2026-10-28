import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { StyledSelect } from "@/components/StyledSelect";
import { EmployeeIdCard } from "@/components/EmployeeIdCard";
import { supabase } from "@/integrations/supabase/client";
import { downloadCsv } from "@/lib/export";

export const Route = createFileRoute("/_authenticated/id-cards")({
  head: () => ({ meta: [{ title: "Employee ID cards · BMP Media Production" }] }),
  component: IdCards,
});

function IdCards() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [cardFilter, setCardFilter] = useState("all");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const { data: employees = [], isLoading } = useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees").select("*").order("full_name");
      if (error) throw error;
      return data;
    },
  });
  const { data: issuedCards = [] } = useQuery({
    queryKey: ["employee-id-cards"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_id_cards")
        .select("employee_id, issued_at");
      if (error) throw error;
      return data;
    },
  });

  const employee = useMemo(
    () => employees.find((item) => item.id === selectedId),
    [employees, selectedId],
  );
  const issued = useMemo(
    () => new Map(issuedCards.map((card) => [card.employee_id, card.issued_at])),
    [issuedCards],
  );
  const filteredEmployees = employees.filter((item) => {
    const matchesSearch =
      `${item.employee_no} ${item.full_name} ${item.position} ${item.department}`
        .toLowerCase()
        .includes(search.toLowerCase());
    const hasCard = issued.has(item.id);
    return (
      matchesSearch &&
      (cardFilter === "all" ||
        (cardFilter === "issued" && hasCard) ||
        (cardFilter === "not-issued" && !hasCard))
    );
  });

  const issueCard = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("Select an employee first.");
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) throw new Error("Sign in again before issuing an ID card.");
      const { error } = await supabase
        .from("employee_id_cards")
        .upsert(
          { employee_id: selectedId, issued_by: auth.user.id, issued_at: new Date().toISOString() },
          { onConflict: "employee_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employee-id-cards"] });
      toast.success("ID card issued. Preview it, print either side, or download JPGs.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <AppShell title="Employee ID cards">
      <style>{`
        @media print {
          @page { size: 86mm 54mm; margin: 0; }
          body * { visibility: hidden !important; }
          .employee-id-print, .employee-id-print * { visibility: visible !important; }
          .employee-id-print {
            position: fixed !important; inset: 0 auto auto 0; width: 86mm !important;
            height: 54mm !important; border: 0 !important; border-radius: 3mm !important;
            box-shadow: none !important;
          }
          .employee-id-print canvas { width: 86mm !important; height: 54mm !important; }
        }
      `}</style>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(360px,1.1fr)]">
        <section className="rounded-sm border bg-card p-5">
          <h2 className="signage text-xl text-navy">Create a staff ID</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Prepare a BMP Media Production ID featuring the company brand. Reissuing the card
            updates its issue date.
          </p>
          <label className="mt-4 block text-sm font-semibold">
            Employee
            <StyledSelect
              ariaLabel="Employee"
              value={selectedId}
              onChange={(value) => {
                setSelectedId(value);
                setPhotoUrl(null);
              }}
              placeholder="Choose an employee"
              options={employees.map((item) => ({
                value: item.id,
                label: `${item.employee_no} · ${item.full_name}`,
              }))}
              className="mt-1 w-full rounded-sm border border-input bg-card px-3 py-2"
              disabled={isLoading}
            />
          </label>
          <label className="mt-4 block text-sm font-semibold">
            Employee photo
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={!employee}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (!file) return;
                if (file.size > 8 * 1024 * 1024) {
                  toast.error("Choose a photo smaller than 8 MB.");
                  return;
                }
                if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
                  toast.error("Choose a JPG, PNG, or WebP photo.");
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                  if (typeof reader.result === "string") setPhotoUrl(reader.result);
                  else toast.error("Could not read the selected employee photo.");
                };
                reader.onerror = () => toast.error("Could not read the selected employee photo.");
                reader.readAsDataURL(file);
              }}
              className="mt-1 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:font-semibold"
            />
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              Optional. Used for this card preview and JPG only; it is not saved to the employee
              record.
            </span>
          </label>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => issueCard.mutate()}
              disabled={!employee || issueCard.isPending}
              className="signage rounded-sm bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
            >
              {issueCard.isPending ? "Saving…" : "Issue ID card"}
            </button>
          </div>
          {employee && issued.has(employee.id) && (
            <p className="mt-3 text-sm text-muted-foreground">
              Issued {new Date(issued.get(employee.id)!).toLocaleDateString("en-UG")}
            </p>
          )}
        </section>

        <div className="rounded-sm border bg-secondary/50 p-5">
          <p className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Credential design preview
          </p>
          {employee && issued.has(employee.id) ? (
            <EmployeeIdCard
              employee={employee}
              issuedAt={new Date(issued.get(employee.id)!).toLocaleDateString("en-UG", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
              photoUrl={photoUrl}
            />
          ) : employee ? (
            <div className="grid aspect-[1012/638] place-items-center rounded-2xl border border-dashed bg-card p-6 text-center">
              <div>
                <p className="font-semibold">Ready to issue</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Issue this employee’s card to enable JPG export and printing.
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Select an employee to preview their card.
            </p>
          )}
        </div>
      </div>

      <section className="mt-6 rounded-sm border bg-card p-4 sm:p-5">
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <input
            aria-label="Search ID card register"
            placeholder="Search staff, number, department…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-sm border border-input bg-card px-3 py-2 text-sm"
          />
          <StyledSelect
            aria-label="Filter ID cards"
            value={cardFilter}
            onChange={setCardFilter}
            options={[
              { value: "all", label: "All staff" },
              { value: "issued", label: "Card issued" },
              { value: "not-issued", label: "Not issued" },
            ]}
            className="w-full rounded-sm border border-input bg-card px-3 py-2 text-sm"
          />
        </div>
        {filteredEmployees.length === 0 ? (
          <p className="rounded-sm border p-8 text-center text-sm text-muted-foreground">
            No staff match these filters.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            {filteredEmployees.map((item) => (
              <article key={item.id} className="rounded-sm border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{item.full_name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{item.employee_no}</p>
                  </div>
                  <span className="shrink-0 rounded-sm bg-secondary px-2 py-1 text-xs font-semibold">
                    {issued.has(item.id) ? "Issued" : "Not issued"}
                  </span>
                </div>
                <p className="mt-3 text-sm">
                  {item.position} · {item.department}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Issued:{" "}
                  {issued.has(item.id)
                    ? new Date(issued.get(item.id)!).toLocaleDateString("en-UG")
                    : "Not issued"}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>
      <button
        onClick={() =>
          downloadCsv("bmp-employee-id-cards.csv", [
            ["Employee no.", "Name", "Position", "Department", "Status", "Issued at"],
            ...filteredEmployees.map((item) => [
              item.employee_no,
              item.full_name,
              item.position,
              item.department,
              issued.has(item.id) ? "Issued" : "Not issued",
              issued.get(item.id) ?? "",
            ]),
          ])
        }
        className="mt-3 rounded-sm border px-4 py-2 text-sm font-semibold"
      >
        Export card register
      </button>
    </AppShell>
  );
}
