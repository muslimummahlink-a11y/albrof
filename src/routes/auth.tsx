import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import stadium from "@/assets/hoima-stadium.png.asset.json";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in · Hoima City Stadium Payroll" },
      { name: "description", content: "Secure staff sign-in for the Hoima City Stadium payroll system." },
      { property: "og:title", content: "Sign in · Hoima City Stadium Payroll" },
      { property: "og:description", content: "Secure staff sign-in for the Hoima City Stadium payroll system." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => data.session && navigate({ to: "/dashboard" }));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => s && navigate({ to: "/dashboard" }));
    return () => data.subscription.unsubscribe();
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res =
      mode === "in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
    setBusy(false);
    if (res.error) return toast.error(res.error.message);
    if (mode === "up" && !res.data.session) toast.success("Check your email to confirm your account.");
  }

  async function google() {
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth" });
    if (r.error) toast.error("Google sign-in failed");
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden lg:block">
        <img src={stadium.url} alt="Hoima City Stadium" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-x-0 bottom-0 bg-navy/90 p-10 text-navy-foreground">
          <div className="facade-stripe mb-6 w-40" />
          <p className="signage text-5xl leading-none">Hoima City Stadium</p>
          <p className="mt-2 text-sm opacity-80">Staff payroll · PAYE & NSSF compliant · Uganda</p>
        </div>
      </div>
      <div className="flex flex-col">
        <div className="facade-stripe" />
        <div className="flex flex-1 items-center justify-center p-8">
          <form onSubmit={submit} className="w-full max-w-sm space-y-4">
            <p className="signage text-sm text-primary">Payroll office</p>
            <h1 className="signage text-4xl text-navy">{mode === "in" ? "Sign in" : "Create account"}</h1>
            <input required type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-sm border border-input bg-card px-3 py-2.5 outline-none focus:ring-2 focus:ring-ring" />
            <input required type="password" minLength={6} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-sm border border-input bg-card px-3 py-2.5 outline-none focus:ring-2 focus:ring-ring" />
            <button disabled={busy} className="signage w-full rounded-sm bg-primary py-3 text-primary-foreground transition hover:opacity-90 disabled:opacity-60">
              {busy ? "Please wait…" : mode === "in" ? "Sign in" : "Sign up"}
            </button>
            <button type="button" onClick={google} className="w-full rounded-sm border bg-card py-2.5 text-sm font-semibold hover:bg-secondary">
              Continue with Google
            </button>
            <p className="text-center text-sm text-muted-foreground">
              {mode === "in" ? "New staff member?" : "Already registered?"}{" "}
              <button type="button" onClick={() => setMode(mode === "in" ? "up" : "in")} className="font-semibold text-primary">
                {mode === "in" ? "Create account" : "Sign in"}
              </button>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
