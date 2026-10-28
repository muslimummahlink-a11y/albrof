import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { devAuthBypass } from "@/lib/dev-auth";

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
  const [mfaCode, setMfaCode] = useState("");
  const [enrollment, setEnrollment] = useState<{
    factorId: string;
    qrCode: string;
    secret: string;
  } | null>(null);

  const { data: user, isLoading } = useQuery({
    queryKey: ["account-settings"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      if (!data.user) throw new Error("Sign in to manage your account.");
      return data.user;
    },
  });

  const rolesQuery = useQuery({
    queryKey: ["account-finance-roles"],
    enabled: Boolean(user) && !devAuthBypass,
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      if (error) throw error;
      return data.map((row) => row.role);
    },
  });
  const isFinanceUser =
    devAuthBypass ||
    (rolesQuery.data?.some((role) => role === "admin" || role === "accountant") ?? false);
  const mfaQuery = useQuery({
    queryKey: ["account-finance-mfa"],
    enabled: isFinanceUser && !devAuthBypass,
    queryFn: async () => {
      const [{ data: factors, error: factorsError }, { data: assurance, error: assuranceError }] =
        await Promise.all([
          supabase.auth.mfa.listFactors(),
          supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        ]);
      if (factorsError) throw factorsError;
      if (assuranceError) throw assuranceError;
      const totpFactors = factors.all.filter((factor) => factor.factor_type === "totp");
      return {
        factors: totpFactors,
        verifiedFactor: totpFactors.find((factor) => factor.status === "verified"),
        pendingFactor: totpFactors.find((factor) => factor.status === "unverified"),
        currentLevel: assurance.currentLevel,
      };
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

  const enrollMfa = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "BMP finance authenticator",
      });
      if (error) throw error;
      return {
        factorId: data.id,
        qrCode: data.totp.qr_code,
        secret: data.totp.secret,
      };
    },
    onSuccess: (data) => setEnrollment(data),
    onError: (error: Error) => toast.error(error.message),
  });

  const verifyMfa = useMutation({
    mutationFn: async () => {
      const factorId =
        enrollment?.factorId ??
        mfaQuery.data?.verifiedFactor?.id ??
        mfaQuery.data?.pendingFactor?.id;
      const code = mfaCode.trim();
      if (!factorId) throw new Error("Enroll an authenticator before verifying.");
      if (!/^\d{6}$/.test(code)) throw new Error("Enter the six-digit authenticator code.");

      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      if (error) throw error;
    },
    onSuccess: async () => {
      setEnrollment(null);
      setMfaCode("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["account-finance-mfa"] }),
        queryClient.invalidateQueries({ queryKey: ["access"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-finance-access"] }),
        queryClient.invalidateQueries({ queryKey: ["payroll-finance-mfa"] }),
      ]);
      toast.success("Authenticator verified for this session.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removePendingMfa = useMutation({
    mutationFn: async () => {
      const factorId = mfaQuery.data?.pendingFactor?.id;
      if (!factorId) throw new Error("There is no unfinished authenticator setup to restart.");
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["account-finance-mfa"] });
      toast.success("Unfinished setup removed. You can start again.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const inputClass =
    "w-full rounded-sm border border-input bg-card px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring";

  return (
    <AppShell title="Account settings">
      <div className="mx-auto max-w-2xl space-y-6">
        <section
          aria-labelledby="hosting-notice-title"
          className="rounded-sm border-l-4 border-gold bg-accent p-4 text-accent-foreground sm:p-5"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div className="min-w-0 space-y-2">
              <h2 id="hosting-notice-title" className="signage text-lg">
                Important hosting and maintenance notice
              </h2>
              <p className="text-sm leading-relaxed">
                The payroll database is hosted by TennaHub Technologies LTD. No database renewal fee
                applies under the current arrangement. Server migrations that may interrupt system
                operation will be communicated to BMP Media Production administration in writing
                before the work.
              </p>
              <p className="flex flex-wrap gap-x-2 text-sm">
                <a
                  className="font-semibold underline underline-offset-2"
                  href="mailto:info@tennahubapp.com"
                >
                  info@tennahubapp.com
                </a>
                <span aria-hidden="true">·</span>
                <a className="font-semibold underline underline-offset-2" href="tel:+256745368426">
                  +256 745 368 426
                </a>
              </p>
            </div>
          </div>
        </section>

        {isFinanceUser && !devAuthBypass && (
          <section
            aria-labelledby="finance-mfa-title"
            className="space-y-4 rounded-sm border bg-card p-5"
          >
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <h2 id="finance-mfa-title" className="signage text-xl text-navy">
                  Finance account verification
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Admin and accountant access to financial records requires a verified
                  authenticator.
                </p>
              </div>
            </div>
            {mfaQuery.isError && (
              <p role="alert" className="text-sm text-destructive">
                Could not load authenticator status: {mfaQuery.error.message}
              </p>
            )}
            {mfaQuery.data?.currentLevel === "aal2" ? (
              <p className="rounded-sm bg-primary/10 p-3 text-sm font-medium text-primary">
                MFA is verified for this session.
              </p>
            ) : (
              <>
                {!mfaQuery.data?.verifiedFactor && !mfaQuery.data?.pendingFactor && !enrollment && (
                  <button
                    className="rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                    disabled={mfaQuery.isLoading || enrollMfa.isPending || rolesQuery.isLoading}
                    onClick={() => enrollMfa.mutate()}
                    type="button"
                  >
                    {enrollMfa.isPending ? "Setting up…" : "Set up authenticator"}
                  </button>
                )}
                {mfaQuery.data?.pendingFactor && !enrollment && (
                  <p className="text-sm text-muted-foreground">
                    Use the authenticator app from your unfinished setup, or discard that setup and
                    scan a new QR code.
                    <button
                      className="ml-1 font-semibold text-primary underline disabled:opacity-60"
                      disabled={removePendingMfa.isPending}
                      onClick={() => removePendingMfa.mutate()}
                      type="button"
                    >
                      {removePendingMfa.isPending ? "Removing…" : "Restart setup"}
                    </button>
                  </p>
                )}
                {enrollment && (
                  <div className="space-y-3 rounded-sm border bg-background p-4">
                    <p className="text-sm">
                      Scan this QR code with an authenticator app, then enter its six-digit code.
                    </p>
                    <img
                      alt="Authenticator setup QR code"
                      className="h-48 w-48 max-w-full border bg-white p-2"
                      src={enrollment.qrCode}
                    />
                    <p className="break-all text-xs text-muted-foreground">
                      Setup key: <span className="font-mono">{enrollment.secret}</span>
                    </p>
                  </div>
                )}
                {(enrollment || mfaQuery.data?.verifiedFactor || mfaQuery.data?.pendingFactor) && (
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <label className="block flex-1 space-y-1.5 text-sm font-medium">
                      <span>Six-digit authenticator code</span>
                      <input
                        autoComplete="one-time-code"
                        className={inputClass}
                        inputMode="numeric"
                        maxLength={6}
                        onChange={(event) =>
                          setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                        }
                        value={mfaCode}
                      />
                    </label>
                    <button
                      className="self-end rounded-sm bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                      disabled={verifyMfa.isPending || mfaCode.length !== 6}
                      onClick={() => verifyMfa.mutate()}
                      type="button"
                    >
                      {verifyMfa.isPending ? "Verifying…" : "Verify MFA"}
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        )}

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
