import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { devAuthBypass } from "@/lib/dev-auth";
import type { Enums } from "@/integrations/supabase/types";

type ManagedRole = Extract<Enums<"app_role">, "hr" | "accountant" | "producer">;
const managedRoles: Array<{ value: ManagedRole; label: string; description: string }> = [
  { value: "hr", label: "HR", description: "Payroll, staff, attendance, and leave workflows." },
  {
    value: "accountant",
    label: "Accountant",
    description: "Treasury, invoicing, reconciliation, budgets, and finance reports.",
  },
  {
    value: "producer",
    label: "Producer / team",
    description: "Assigned projects and personal expense requests.",
  },
];

export const Route = createFileRoute("/_authenticated/user-access")({
  head: () => ({ meta: [{ title: "User access · BMP Media Production" }] }),
  component: UserAccessPage,
});

function UserAccessPage() {
  const queryClient = useQueryClient();
  const accessQuery = useQuery({
    queryKey: ["user-access-admin-check"],
    queryFn: async () => {
      if (devAuthBypass) return true;
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) return false;
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", auth.user.id);
      if (error) throw error;
      return (data ?? []).some((role) => role.role === "admin");
    },
  });
  const usersQuery = useQuery({
    queryKey: ["user-access-directory"],
    enabled: accessQuery.data === true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_user_access");
      if (error) throw error;
      return data;
    },
  });
  const setRole = useMutation({
    mutationFn: async ({
      userId,
      role,
      enabled,
    }: {
      userId: string;
      role: ManagedRole;
      enabled: boolean;
    }) => {
      const { error } = await supabase.rpc("admin_set_user_role", {
        p_user_id: userId,
        p_role: role,
        p_enabled: enabled,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["user-access-directory"] });
      await queryClient.invalidateQueries({ queryKey: ["access"] });
      toast.success("User role updated.");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const loadError = accessQuery.error ?? usersQuery.error;

  return (
    <AppShell title="User access">
      <div className="space-y-5">
        <p className="rounded-sm border-l-4 border-primary bg-accent p-4 text-sm text-accent-foreground">
          Assign only the access each person needs. Manager/admin access is provisioned separately
          and cannot be granted or removed here. Producer access alone does not grant project
          visibility; assign producers to each project.
        </p>
        {accessQuery.data === false && (
          <div
            role="alert"
            className="rounded-sm border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
          >
            Administrator access is required to manage roles.
          </div>
        )}
        {loadError && (
          <div
            role="alert"
            className="rounded-sm border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
          >
            User access could not be loaded: {loadError.message}
          </div>
        )}
        {usersQuery.isLoading && <p className="text-sm text-muted-foreground">Loading users…</p>}
        {accessQuery.data && usersQuery.data && (
          <div className="space-y-3">
            {usersQuery.data.map((user) => (
              <section key={user.user_id} className="space-y-3 rounded-sm border bg-card p-4">
                <div>
                  <h2 className="font-semibold">{user.full_name || user.email || "User"}</h2>
                  <p className="text-sm text-muted-foreground">
                    {user.email ?? "No email address"}
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  {managedRoles.map((role) => {
                    const checked = user.roles.includes(role.value);
                    return (
                      <label
                        key={role.value}
                        className="flex items-start gap-3 rounded-sm border p-3"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={setRole.isPending}
                          onChange={(event) =>
                            setRole.mutate({
                              userId: user.user_id,
                              role: role.value,
                              enabled: event.currentTarget.checked,
                            })
                          }
                        />
                        <span>
                          <span className="block text-sm font-semibold">{role.label}</span>
                          <span className="block text-xs text-muted-foreground">
                            {role.description}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {user.roles.includes("admin") && (
                  <p className="text-xs font-medium text-muted-foreground">
                    Administrator / manager access is active and managed outside this page.
                  </p>
                )}
              </section>
            ))}
            {!usersQuery.data.length && (
              <p className="rounded-sm border bg-card p-4 text-sm text-muted-foreground">
                No registered users are available.
              </p>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
