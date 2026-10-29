import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/account-settings")({
  head: () => ({ meta: [{ title: "Account settings · BMP Media Production" }] }),
  component: AccountSettings,
});

function AccountSettings() {
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const { data: user, isLoading } = useQuery({
    queryKey: ["account-settings"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      if (!data.user) throw new Error("Sign in to manage your account.");
      return data.user;
    },
  });

  useEffect(() => {
    setFullName(String(user?.user_metadata?.["full_name"] ?? ""));
  }, [user]);

  const saveProfile = useMutation({
    mutationFn: async () => {
      const name = fullName.trim();
      if (!name) throw new Error("Enter your name.");

      const { error } = await supabase.auth.updateUser({
        data: { ...user?.user_metadata, full_name: name },
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["account-settings"] });
      await queryClient.invalidateQueries({ queryKey: ["access"] });
      toast.success("Profile updated.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const updateLogin = useMutation({
    mutationFn: async () => {
      const email = newEmail.trim();
      const password = newPassword;
      if (!email && !password) throw new Error("Enter a new email address or password.");
      if (email && email.toLowerCase() === user?.email?.toLowerCase()) {
        throw new Error("Enter an email address different from your current one.");
      }
      if (password && password.length < 8) {
        throw new Error("Use a password with at least 8 characters.");
      }
      if (password !== confirmPassword) throw new Error("The passwords do not match.");

      const { error } = await supabase.auth.updateUser({
        ...(email ? { email } : {}),
        ...(password ? { password } : {}),
      });
      if (error) throw error;
      return { emailChanged: Boolean(email), passwordChanged: Boolean(password) };
    },
    onSuccess: async ({ emailChanged, passwordChanged }) => {
      setNewEmail("");
      setNewPassword("");
      setConfirmPassword("");
      await queryClient.invalidateQueries({ queryKey: ["account-settings"] });
      toast.success(
        emailChanged && passwordChanged
          ? "Login updated. Confirm the email change using the message sent to your new address."
          : emailChanged
            ? "Check your new email address to confirm the change."
            : "Password updated.",
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const inputClass =
    "w-full rounded-sm border border-input bg-card px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring";

  return (
    <AppShell title="Account settings">
      <div className="mx-auto max-w-2xl space-y-6">
        <section className="space-y-4 rounded-sm border bg-card p-5">
          <div>
            <h2 className="signage text-xl text-navy">Profile</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Update the name shown for your signed-in account.
            </p>
          </div>
          <label className="block space-y-1.5 text-sm font-medium">
            <span>Full name</span>
            <input
              autoComplete="name"
              className={inputClass}
              disabled={isLoading || saveProfile.isPending}
              onChange={(event) => setFullName(event.target.value)}
              value={fullName}
            />
          </label>
          <button
            className="rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            disabled={isLoading || saveProfile.isPending || !fullName.trim()}
            onClick={() => saveProfile.mutate()}
            type="button"
          >
            {saveProfile.isPending ? "Saving…" : "Save profile"}
          </button>
        </section>

        <section className="space-y-4 rounded-sm border bg-card p-5">
          <div>
            <h2 className="signage text-xl text-navy">Login details</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Signed in as <span className="font-semibold">{user?.email}</span>. Leave a field blank
              if you do not want to change it.
            </p>
          </div>
          <label className="block space-y-1.5 text-sm font-medium">
            <span>New email address</span>
            <input
              autoComplete="email"
              className={inputClass}
              disabled={isLoading || updateLogin.isPending}
              onChange={(event) => setNewEmail(event.target.value)}
              type="email"
              value={newEmail}
            />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            <span>New password</span>
            <input
              autoComplete="new-password"
              className={inputClass}
              disabled={isLoading || updateLogin.isPending}
              minLength={8}
              onChange={(event) => setNewPassword(event.target.value)}
              type="password"
              value={newPassword}
            />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            <span>Confirm new password</span>
            <input
              autoComplete="new-password"
              className={inputClass}
              disabled={isLoading || updateLogin.isPending}
              minLength={8}
              onChange={(event) => setConfirmPassword(event.target.value)}
              type="password"
              value={confirmPassword}
            />
          </label>
          <button
            className="rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            disabled={isLoading || updateLogin.isPending || (!newEmail.trim() && !newPassword)}
            onClick={() => updateLogin.mutate()}
            type="button"
          >
            {updateLogin.isPending ? "Updating…" : "Update login"}
          </button>
        </section>
      </div>
    </AppShell>
  );
}
