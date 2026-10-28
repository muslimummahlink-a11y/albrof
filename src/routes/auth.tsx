import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { devAuthBypass } from "@/lib/dev-auth";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in · BMP للإنتاج الإعلامي Payroll" },
      {
        name: "description",
        content: "Secure staff sign-in for the BMP Media Production payroll system.",
      },
      { property: "og:title", content: "Sign in · BMP للإنتاج الإعلامي Payroll" },
      {
        property: "og:description",
        content: "Secure staff sign-in for the BMP Media Production payroll system.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (devAuthBypass) {
      navigate({ to: "/dashboard", replace: true });
      return;
    }
    supabase.auth.getSession().then(({ data }) => data.session && navigate({ to: "/dashboard" }));
    const { data } = supabase.auth.onAuthStateChange(
      (_e, s) => s && navigate({ to: "/dashboard" }),
    );
    return () => data.subscription.unsubscribe();
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (res.error) {
      toast.error(res.error.message);
      return;
    }
  }

  return (
    <div className="auth-screen relative grid min-h-screen lg:grid-cols-2">
      <div className="absolute inset-0 overflow-hidden lg:hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.24),transparent_30%),linear-gradient(135deg,_#0d1117,_#101821_50%,_#141d2a)]" />
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.06),transparent_40%,rgba(245,158,11,0.08))]" />
        <div className="absolute inset-x-0 bottom-0 bg-[#0a0f14]/85 p-10 text-navy-foreground">
          <div className="facade-stripe mb-6 w-40" />
          <p className="signage text-5xl leading-none">BMP Media Production</p>
          <p className="mt-2 text-sm opacity-80">Staff payroll · Uganda</p>
        </div>
      </div>
      <div className="relative hidden overflow-hidden lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.32),transparent_28%),linear-gradient(135deg,_#0d1117,_#101821_42%,_#141d2a)]" />
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.05),transparent_40%,rgba(245,158,11,0.06))]" />
        <div className="absolute inset-x-0 bottom-0 bg-[#0a0f14]/90 p-10 text-navy-foreground">
          <div className="facade-stripe mb-6 w-40" />
          <p className="signage text-5xl leading-none">BMP Media Production</p>
          <p className="mt-2 text-sm opacity-80">Staff payroll · Uganda</p>
        </div>
      </div>
      <div className="relative flex min-h-screen flex-col bg-black text-white lg:min-h-0">
        <div className="facade-stripe" />
        <div className="flex flex-1 items-center justify-center p-5 sm:p-8">
          <form onSubmit={submit} className="w-full max-w-sm space-y-4">
            <div className="mx-auto mb-2 w-full max-w-xs">
              <img
                src="/bro-media-logo.png"
                alt="BRO Media Production logo"
                className="h-auto w-full"
              />
            </div>
            <p className="text-center text-sm font-semibold text-white">BMP للإنتاج الإعلامي</p>
            <p className="signage text-sm text-primary">Payroll office</p>
            <h1 className="signage text-4xl text-white">Sign in</h1>
            <input
              required
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-sm border border-white/25 bg-white/10 px-3 py-2.5 text-white placeholder:text-white/60 outline-none focus:ring-2 focus:ring-ring"
            />
            <input
              required
              type="password"
              minLength={6}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-sm border border-white/25 bg-white/10 px-3 py-2.5 text-white placeholder:text-white/60 outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              disabled={busy}
              className="signage w-full rounded-sm bg-primary py-3 text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              {busy ? "Please wait…" : "Sign in"}
            </button>
            <p className="text-center text-sm text-white/70">
              Accounts are created by the system administrator.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
