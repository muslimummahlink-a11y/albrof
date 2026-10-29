import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { StyledSelect } from "@/components/StyledSelect";
import { supabase } from "@/integrations/supabase/client";
import { devAuthBypass } from "@/lib/dev-auth";
import type { Tables } from "@/integrations/supabase/types";

type BusinessParty = Tables<"business_parties">;
type Project = Tables<"projects">;
type PartyType = "client" | "supplier" | "both";
type Currency = "UGX" | "USD";
type ProjectStatus = "planning" | "active" | "on_hold" | "completed" | "cancelled";

const currencies: Array<{ value: Currency; label: string }> = [
  { value: "UGX", label: "UGX" },
  { value: "USD", label: "USD" },
];
const partyTypes: Array<{ value: PartyType; label: string }> = [
  { value: "client", label: "Client" },
  { value: "supplier", label: "Supplier" },
  { value: "both", label: "Client and supplier" },
];
const projectStatuses: Array<{ value: ProjectStatus; label: string }> = [
  { value: "planning", label: "Planning" },
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On hold" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

function isPartyType(value: string): value is PartyType {
  return value === "client" || value === "supplier" || value === "both";
}

function isCurrency(value: string): value is Currency {
  return value === "UGX" || value === "USD";
}

function isProjectStatus(value: string): value is ProjectStatus {
  return projectStatuses.some((status) => status.value === value);
}

function money(value: number | null, currency: string) {
  return value === null
    ? "Not set"
    : `${currency} ${Number(value).toLocaleString("en-UG", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
}

function optionalNumber(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text === "" ? null : Number(text);
}

export const Route = createFileRoute("/_authenticated/projects")({
  head: () => ({ meta: [{ title: "Projects & partners · BMP Media Production" }] }),
  component: ProjectsPage,
});

function ProjectsPage() {
  const queryClient = useQueryClient();
  const [partyType, setPartyType] = useState<PartyType>("client");
  const [partyCurrency, setPartyCurrency] = useState<Currency>("UGX");
  const [projectClient, setProjectClient] = useState("");
  const [contractCurrency, setContractCurrency] = useState<Currency>("UGX");
  const [budgetCurrency, setBudgetCurrency] = useState<Currency>("UGX");
  const [projectStatus, setProjectStatus] = useState<ProjectStatus>("planning");
  const [partySearch, setPartySearch] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [projectStatusFilter, setProjectStatusFilter] = useState("all");
  const [producerForProject, setProducerForProject] = useState<Record<string, string>>({});
  const inputClass =
    "w-full rounded-sm border border-input bg-card px-3 py-2 text-sm text-foreground";

  const rolesQuery = useQuery({
    queryKey: ["project-management-roles"],
    queryFn: async () => {
      if (devAuthBypass) return ["admin"];
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) return [];
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", auth.user.id);
      if (error) throw error;
      return (data ?? []).map((item) => item.role);
    },
  });
  const roles = rolesQuery.data ?? [];
  const canManageProjectRecords = roles.some(
    (role) => role === "admin" || role === "hr" || role === "accountant",
  );
  const canAssignProducers = roles.includes("admin");
  const {
    data: parties = [],
    isLoading: loadingParties,
    isError: partiesFailed,
    error: partiesError,
  } = useQuery({
    queryKey: ["business-parties"],
    enabled: canManageProjectRecords,
    queryFn: async () => {
      const { data, error } = await supabase.from("business_parties").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });
  const { data: assignments = [], error: assignmentsError } = useQuery({
    queryKey: ["project-assignments"],
    enabled: rolesQuery.isSuccess,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_assignments")
        .select("*")
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });
  const { data: producerUsers = [] } = useQuery({
    queryKey: ["project-producer-users"],
    enabled: canAssignProducers,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_user_access");
      if (error) throw error;
      return data.filter((user) => user.roles.includes("producer"));
    },
  });
  const {
    data: projects = [],
    isLoading: loadingProjects,
    isError: projectsFailed,
    error: projectsError,
  } = useQuery({
    queryKey: ["business-projects"],
    enabled: rolesQuery.isSuccess,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const activeClients = useMemo(
    () =>
      parties.filter(
        (party) =>
          party.is_active && (party.party_type === "client" || party.party_type === "both"),
      ),
    [parties],
  );
  const visibleParties = parties.filter((party) =>
    `${party.name} ${party.contact_person ?? ""} ${party.email ?? ""} ${party.phone ?? ""}`
      .toLowerCase()
      .includes(partySearch.trim().toLowerCase()),
  );
  const visibleProjects = projects.filter((project) => {
    const client = parties.find((party) => party.id === project.client_id);
    return (
      `${project.project_code} ${project.service} ${client?.name ?? ""}`
        .toLowerCase()
        .includes(projectSearch.trim().toLowerCase()) &&
      (projectStatusFilter === "all" || project.status === projectStatusFilter)
    );
  });

  const saveParty = useMutation({
    mutationFn: async (formData: FormData) => {
      const name = String(formData.get("name") ?? "").trim();
      if (!name) throw new Error("Enter a client or supplier name.");
      const rawTerms = Number(formData.get("payment_terms_days"));
      if (!Number.isInteger(rawTerms) || rawTerms < 0) {
        throw new Error("Payment terms must be zero or a positive number of days.");
      }
      const payload = {
        name,
        party_type: partyType,
        contact_person: String(formData.get("contact_person") ?? "").trim() || null,
        email: String(formData.get("email") ?? "").trim() || null,
        phone: String(formData.get("phone") ?? "").trim() || null,
        billing_address: String(formData.get("billing_address") ?? "").trim() || null,
        tax_identifier: String(formData.get("tax_identifier") ?? "").trim() || null,
        preferred_currency: partyCurrency,
        payment_terms_days: rawTerms,
        notes: String(formData.get("notes") ?? "").trim(),
      };
      const { error } = await supabase.from("business_parties").insert(payload);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["business-parties"] });
      toast.success("Business contact saved.");
      document.getElementById("clients")?.querySelector("form")?.reset();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const setPartyActive = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase
        .from("business_parties")
        .update({ is_active: isActive })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["business-parties"] });
      toast.success("Business contact status updated.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const setProjectProducer = useMutation({
    mutationFn: async ({ projectId, userId }: { projectId: string; userId: string }) => {
      if (!userId) throw new Error("Choose a producer to assign.");
      const existing = assignments.find(
        (assignment) => assignment.project_id === projectId && assignment.user_id === userId,
      );
      const { error } = existing
        ? await supabase
            .from("project_assignments")
            .update({ is_active: true })
            .eq("id", existing.id)
        : await supabase
            .from("project_assignments")
            .insert({ project_id: projectId, user_id: userId });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project-assignments"] });
      setProducerForProject({});
      toast.success("Producer assigned to project.");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const removeProjectProducer = useMutation({
    mutationFn: async (assignmentId: string) => {
      const { error } = await supabase
        .from("project_assignments")
        .update({ is_active: false })
        .eq("id", assignmentId);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project-assignments"] });
      toast.success("Producer removed from project.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveProject = useMutation({
    mutationFn: async (formData: FormData) => {
      if (!projectClient) throw new Error("Choose an active client for the project.");
      const code = String(formData.get("project_code") ?? "").trim();
      const service = String(formData.get("service") ?? "").trim();
      if (!code || !service) throw new Error("Project ID and service are required.");
      const startsOn = String(formData.get("starts_on") ?? "") || null;
      const dueOn = String(formData.get("due_on") ?? "") || null;
      if (startsOn && dueOn && dueOn < startsOn) {
        throw new Error("Delivery date cannot be earlier than the start date.");
      }
      const { error } = await supabase.from("projects").insert({
        project_code: code,
        client_id: projectClient,
        service,
        scope_description: String(formData.get("scope_description") ?? "").trim(),
        contract_value: optionalNumber(formData.get("contract_value")),
        contract_currency: contractCurrency,
        budget_amount: optionalNumber(formData.get("budget_amount")),
        budget_currency: budgetCurrency,
        starts_on: startsOn,
        due_on: dueOn,
        responsible_person: String(formData.get("responsible_person") ?? "").trim() || null,
        status: projectStatus,
        notes: String(formData.get("notes") ?? "").trim(),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["business-projects"] });
      toast.success("Project created.");
      document.getElementById("business-project-form")?.querySelector("form")?.reset();
      setProjectClient("");
      setContractCurrency("UGX");
      setBudgetCurrency("UGX");
      setProjectStatus("planning");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const updateProjectStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ProjectStatus }) => {
      const { error } = await supabase.from("projects").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["business-projects"] });
      toast.success("Project status updated.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <AppShell title="Projects & partners">
      <div className="space-y-6">
        <p className="rounded-sm border-l-4 border-primary bg-accent p-4 text-sm text-accent-foreground">
          Maintain client and supplier records and track production projects. Each project has a
          unique ID, client, service, contract and budget currencies, owner, dates, and status.
        </p>

        {(partiesFailed || projectsFailed || Boolean(assignmentsError) || rolesQuery.isError) && (
          <div
            role="alert"
            className="rounded-sm border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
          >
            Business records could not be loaded:{" "}
            {[partiesError, projectsError, assignmentsError, rolesQuery.error]
              .filter(Boolean)
              .map((error) => (error instanceof Error ? error.message : String(error)))
              .join(" ")}
          </div>
        )}

        {canManageProjectRecords && (
          <div className="grid gap-6 xl:grid-cols-2">
            <section id="clients" className="space-y-4 rounded-sm border bg-card p-4 sm:p-5">
              <div>
                <h2 className="signage text-xl text-navy">Clients & suppliers</h2>
                <p className="text-sm text-muted-foreground">
                  Store contact and billing details, terms, and preferred currency.
                </p>
              </div>
              <form
                className="grid gap-3 sm:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveParty.mutate(new FormData(event.currentTarget));
                }}
              >
                <label className="space-y-1 text-sm font-medium">
                  Type
                  <StyledSelect
                    ariaLabel="Business contact type"
                    value={partyType}
                    onChange={(value) => {
                      if (isPartyType(value)) setPartyType(value);
                    }}
                    options={partyTypes}
                    className={inputClass}
                  />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Name
                  <input required name="name" className={inputClass} />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Contact person
                  <input name="contact_person" className={inputClass} />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Phone
                  <input name="phone" type="tel" className={inputClass} />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Email
                  <input name="email" type="email" className={inputClass} />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Tax identifier
                  <input name="tax_identifier" className={inputClass} />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Preferred currency
                  <StyledSelect
                    ariaLabel="Preferred business contact currency"
                    value={partyCurrency}
                    onChange={(value) => {
                      if (isCurrency(value)) setPartyCurrency(value);
                    }}
                    options={currencies}
                    className={inputClass}
                  />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Payment terms (days)
                  <input
                    required
                    name="payment_terms_days"
                    type="number"
                    min="0"
                    step="1"
                    defaultValue="0"
                    className={inputClass}
                  />
                </label>
                <label className="space-y-1 text-sm font-medium sm:col-span-2">
                  Billing address
                  <input name="billing_address" className={inputClass} />
                </label>
                <label className="space-y-1 text-sm font-medium sm:col-span-2">
                  Notes
                  <textarea name="notes" rows={2} className={inputClass} />
                </label>
                <button
                  type="submit"
                  disabled={saveParty.isPending}
                  className="rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60 sm:col-span-2"
                >
                  {saveParty.isPending ? "Saving…" : "Add business contact"}
                </button>
              </form>
            </section>

            <section
              id="business-project-form"
              className="space-y-4 rounded-sm border bg-card p-4 sm:p-5"
            >
              <div>
                <h2 className="signage text-xl text-navy">Create project</h2>
                <p className="text-sm text-muted-foreground">
                  Contract value and project budget retain their own currency and are never summed
                  across currencies.
                </p>
              </div>
              <form
                className="grid gap-3 sm:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveProject.mutate(new FormData(event.currentTarget));
                }}
              >
                <label className="space-y-1 text-sm font-medium">
                  Project ID
                  <input
                    required
                    name="project_code"
                    className={inputClass}
                    placeholder="BMP-2026-001"
                  />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Client
                  <StyledSelect
                    ariaLabel="Project client"
                    value={projectClient}
                    onChange={setProjectClient}
                    placeholder="Choose a client"
                    options={activeClients.map((client) => ({
                      value: client.id,
                      label: client.name,
                    }))}
                    className={inputClass}
                  />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Service
                  <input
                    required
                    name="service"
                    className={inputClass}
                    placeholder="Video production"
                  />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Responsible person
                  <input name="responsible_person" className={inputClass} />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Contract value
                  <input
                    name="contract_value"
                    type="number"
                    min="0"
                    step="0.01"
                    className={inputClass}
                  />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Contract currency
                  <StyledSelect
                    ariaLabel="Project contract currency"
                    value={contractCurrency}
                    onChange={(value) => {
                      if (isCurrency(value)) setContractCurrency(value);
                    }}
                    options={currencies}
                    className={inputClass}
                  />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Budget
                  <input
                    name="budget_amount"
                    type="number"
                    min="0"
                    step="0.01"
                    className={inputClass}
                  />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Budget currency
                  <StyledSelect
                    ariaLabel="Project budget currency"
                    value={budgetCurrency}
                    onChange={(value) => {
                      if (isCurrency(value)) setBudgetCurrency(value);
                    }}
                    options={currencies}
                    className={inputClass}
                  />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Start date
                  <input name="starts_on" type="date" className={inputClass} />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Delivery date
                  <input name="due_on" type="date" className={inputClass} />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Status
                  <StyledSelect
                    ariaLabel="Project status"
                    value={projectStatus}
                    onChange={(value) => {
                      if (isProjectStatus(value)) setProjectStatus(value);
                    }}
                    options={projectStatuses}
                    className={inputClass}
                  />
                </label>
                <label className="space-y-1 text-sm font-medium sm:col-span-2">
                  Scope
                  <textarea name="scope_description" rows={2} className={inputClass} />
                </label>
                <label className="space-y-1 text-sm font-medium sm:col-span-2">
                  Notes
                  <textarea name="notes" rows={2} className={inputClass} />
                </label>
                <button
                  type="submit"
                  disabled={saveProject.isPending || activeClients.length === 0}
                  className="rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60 sm:col-span-2"
                >
                  {saveProject.isPending ? "Saving…" : "Create project"}
                </button>
                {activeClients.length === 0 && (
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    Add an active client before creating a project.
                  </p>
                )}
              </form>
            </section>
          </div>
        )}

        <section className="space-y-3">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <h2 className="signage text-xl text-navy">Project register</h2>
              <p className="text-sm text-muted-foreground">
                Search, review project scope, and update project status.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                aria-label="Search projects"
                placeholder="Search project or client…"
                value={projectSearch}
                onChange={(event) => setProjectSearch(event.target.value)}
                className={inputClass}
              />
              <StyledSelect
                ariaLabel="Filter projects by status"
                value={projectStatusFilter}
                onChange={setProjectStatusFilter}
                options={[{ value: "all", label: "All project statuses" }, ...projectStatuses]}
                className={inputClass}
              />
            </div>
          </div>
          {loadingProjects ? (
            <p className="text-sm text-muted-foreground">Loading projects…</p>
          ) : visibleProjects.length === 0 ? (
            <p className="rounded-sm border bg-card p-4 text-sm text-muted-foreground">
              No projects match the current filters.
            </p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {visibleProjects.map((project) => {
                const client = parties.find((party) => party.id === project.client_id);
                return (
                  <article key={project.id} className="space-y-3 rounded-sm border bg-card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-bold">{project.project_code}</p>
                        <p className="text-sm text-muted-foreground">
                          {client?.name ?? "Unknown client"} · {project.service}
                        </p>
                      </div>
                      {canManageProjectRecords && (
                        <StyledSelect
                          ariaLabel={`Status for ${project.project_code}`}
                          value={project.status}
                          onChange={(value) => {
                            if (isProjectStatus(value)) {
                              updateProjectStatus.mutate({ id: project.id, status: value });
                            }
                          }}
                          options={projectStatuses}
                          className="w-36"
                          disabled={updateProjectStatus.isPending}
                        />
                      )}
                    </div>
                    <div className="grid gap-2 text-sm sm:grid-cols-2">
                      <p>
                        <span className="text-muted-foreground">Contract: </span>
                        {money(project.contract_value, project.contract_currency)}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Budget: </span>
                        {money(project.budget_amount, project.budget_currency)}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Owner: </span>
                        {project.responsible_person || "Unassigned"}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Delivery: </span>
                        {project.due_on || "Not set"}
                      </p>
                    </div>
                    {project.scope_description && (
                      <p className="border-t pt-3 text-sm text-muted-foreground">
                        {project.scope_description}
                      </p>
                    )}
                    {canAssignProducers && (
                      <div className="space-y-2 border-t pt-3">
                        <p className="text-xs font-semibold uppercase text-muted-foreground">
                          Assigned producers
                        </p>
                        {assignments
                          .filter((assignment) => assignment.project_id === project.id)
                          .map((assignment) => {
                            const producer = producerUsers.find(
                              (user) => user.user_id === assignment.user_id,
                            );
                            return (
                              <div
                                key={assignment.id}
                                className="flex items-center justify-between gap-2 text-sm"
                              >
                                <span>
                                  {producer?.full_name || producer?.email || assignment.user_id}
                                </span>
                                <button
                                  type="button"
                                  disabled={removeProjectProducer.isPending}
                                  onClick={() => removeProjectProducer.mutate(assignment.id)}
                                  className="text-xs font-semibold text-destructive hover:underline"
                                >
                                  Remove
                                </button>
                              </div>
                            );
                          })}
                        <div className="flex gap-2">
                          <StyledSelect
                            ariaLabel={`Producer for ${project.project_code}`}
                            value={producerForProject[project.id] ?? ""}
                            onChange={(value) =>
                              setProducerForProject((current) => ({
                                ...current,
                                [project.id]: value,
                              }))
                            }
                            options={[
                              { value: "", label: "Choose producer" },
                              ...producerUsers.map((producer) => ({
                                value: producer.user_id,
                                label: producer.full_name || producer.email || producer.user_id,
                              })),
                            ]}
                            className={inputClass}
                          />
                          <button
                            type="button"
                            disabled={
                              setProjectProducer.isPending ||
                              !producerForProject[project.id] ||
                              producerUsers.length === 0
                            }
                            onClick={() =>
                              setProjectProducer.mutate({
                                projectId: project.id,
                                userId: producerForProject[project.id] ?? "",
                              })
                            }
                            className="shrink-0 rounded-sm border px-3 text-xs font-semibold disabled:opacity-50"
                          >
                            Assign
                          </button>
                        </div>
                        {producerUsers.length === 0 && (
                          <p className="text-xs text-muted-foreground">
                            Add the producer role to a registered user before assigning them.
                          </p>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {canManageProjectRecords && (
          <section className="space-y-3">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div>
                <h2 className="signage text-xl text-navy">Business contacts</h2>
                <p className="text-sm text-muted-foreground">
                  Archived contacts remain in project history and are not available for new
                  projects.
                </p>
              </div>
              <input
                aria-label="Search business contacts"
                placeholder="Search contacts…"
                value={partySearch}
                onChange={(event) => setPartySearch(event.target.value)}
                className={`${inputClass} sm:max-w-xs`}
              />
            </div>
            {loadingParties ? (
              <p className="text-sm text-muted-foreground">Loading business contacts…</p>
            ) : visibleParties.length === 0 ? (
              <p className="rounded-sm border bg-card p-4 text-sm text-muted-foreground">
                No business contacts match the search.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-sm border bg-card">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-secondary text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="p-3">Name / type</th>
                      <th className="p-3">Contact</th>
                      <th className="p-3">Terms / currency</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {visibleParties.map((party: BusinessParty) => (
                      <tr key={party.id}>
                        <td className="p-3">
                          <span className="block font-semibold">{party.name}</span>
                          <span className="text-xs capitalize text-muted-foreground">
                            {party.party_type}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className="block">{party.contact_person || "—"}</span>
                          <span className="text-xs text-muted-foreground">
                            {[party.email, party.phone].filter(Boolean).join(" · ") || "—"}
                          </span>
                        </td>
                        <td className="p-3">
                          {party.payment_terms_days} days · {party.preferred_currency ?? "—"}
                        </td>
                        <td className="p-3">{party.is_active ? "Active" : "Archived"}</td>
                        <td className="p-3">
                          <button
                            type="button"
                            disabled={setPartyActive.isPending}
                            onClick={() =>
                              setPartyActive.mutate({ id: party.id, isActive: !party.is_active })
                            }
                            className="font-semibold text-primary hover:underline disabled:opacity-60"
                          >
                            {party.is_active ? "Archive" : "Reactivate"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}
