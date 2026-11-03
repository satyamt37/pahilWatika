"use client";
import { KeyRound, Mail, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { Logo } from "@/components/Logo";
import { useToast } from "@/components/toast";
import { Button, Card, Field, Input, Tabs } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { siteUrl } from "@/lib/format";
import { supabase } from "@/lib/supabase";

type Mode = "signin" | "magic" | "signup" | "forgot" | "reset";

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address");
const passwordSchema = z.string().min(8, "Password must be at least 8 characters");

/** Only allow same-site relative redirects after login. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export default function LoginPage() {
  const router = useRouter();
  const toast = useToast();
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [next, setNext] = useState("/");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setNext(safeNext(q.get("next")));
    if (q.get("reset") === "1" || window.location.hash.includes("type=recovery")) setMode("reset");
    const { data } = supabase.auth.onAuthStateChange((evt) => {
      if (evt === "PASSWORD_RECOVERY") setMode("reset");
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!loading && user && mode !== "reset") router.replace(next);
  }, [loading, user, mode, next, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setSent(null);
    const em = emailSchema.safeParse(email);
    if (mode !== "reset" && !em.success) return setErr(em.error.issues[0].message);
    if ((mode === "signin" || mode === "signup" || mode === "reset")) {
      const pw = passwordSchema.safeParse(password);
      if (!pw.success) return setErr(pw.error.issues[0].message);
    }
    if (mode === "signup" && name.trim().length < 2) return setErr("Please enter your full name");
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email: em.data!, password });
        if (error) throw error;
        toast.success("स्वागत है! · Welcome back");
      } else if (mode === "magic") {
        const { error } = await supabase.auth.signInWithOtp({
          email: em.data!,
          options: { emailRedirectTo: siteUrl("/login/"), shouldCreateUser: false },
        });
        if (error) throw error;
        setSent("Check your email for a sign-in link. · लॉगिन लिंक आपके ईमेल पर भेजा गया है।");
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: em.data!,
          password,
          options: { data: { full_name: name.trim() }, emailRedirectTo: siteUrl("/login/") },
        });
        if (error) throw error;
        if (!data.session) setSent("Account created. Please confirm your email address, then sign in. · ईमेल की पुष्टि करें।");
        else toast.success("खाता बन गया · Account created");
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(em.data!, { redirectTo: siteUrl("/login/?reset=1") });
        if (error) throw error;
        setSent("A password reset link has been sent if this email is registered.");
      } else if (mode === "reset") {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        toast.success("Password updated · पासवर्ड बदल गया");
        setMode("signin");
        router.replace("/");
      }
    } catch (e2) {
      const m = (e2 as Error).message ?? "";
      setErr(
        m.includes("Invalid login") ? "Email or password is incorrect · ईमेल या पासवर्ड गलत है"
          : m.includes("rate limit") || m.includes("security purposes") ? "Too many attempts. Please wait a minute and try again."
            : m.includes("Signups not allowed") ? "This email is not registered. Ask an admin to add you."
              : m || "Something went wrong",
      );
    } finally {
      setBusy(false);
    }
  }

  const title = {
    signin: "लॉगिन करें · Sign in",
    magic: "ईमेल लिंक से लॉगिन · Email link",
    signup: "नया खाता · Create account",
    forgot: "पासवर्ड भूल गए · Forgot password",
    reset: "नया पासवर्ड · Set a new password",
  }[mode];

  return (
    <div className="mx-auto max-w-md py-4">
      <div className="mb-6 text-center">
        <Logo className="mx-auto h-16 w-16" />
        <h1 className="mt-3 font-hindi text-2xl font-bold text-forest">पाहिल वाटिका परिवार</h1>
        <p className="text-muted">Members&apos; sign in</p>
      </div>
      <Card className="p-5 sm:p-6">
        {(mode === "signin" || mode === "magic" || mode === "signup") && (
          <Tabs
            className="mb-5"
            value={mode}
            onChange={(m) => { setMode(m); setErr(null); setSent(null); }}
            items={[
              { value: "signin", label: "पासवर्ड" },
              { value: "magic", label: "ईमेल लिंक" },
              { value: "signup", label: "नया खाता" },
            ]}
          />
        )}
        <h2 className="mb-4 font-hindi text-lg font-semibold text-forest">{title}</h2>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {mode === "signup" && (
            <Field label="पूरा नाम · Full name" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </Field>
          )}
          {mode !== "reset" && (
            <Field label="ईमेल · Email" required>
              <Input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </Field>
          )}
          {(mode === "signin" || mode === "signup" || mode === "reset") && (
            <Field label="पासवर्ड · Password" required hint={mode !== "signin" ? "At least 8 characters" : undefined}>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signin" ? "current-password" : "new-password"} />
            </Field>
          )}
          {err && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{err}</p>}
          {sent && <p className="rounded-xl bg-leaf-50 px-3 py-2 text-sm text-leaf-700" role="status">{sent}</p>}
          <Button type="submit" size="lg" className="w-full" loading={busy}
            icon={mode === "magic" || mode === "forgot" ? <Mail className="h-4 w-4" /> : mode === "signup" ? <UserPlus className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}>
            {mode === "signin" ? "लॉगिन · Sign in" : mode === "magic" ? "लिंक भेजें · Send link" : mode === "signup" ? "खाता बनाएँ · Create account" : mode === "forgot" ? "रीसेट लिंक भेजें · Send reset link" : "पासवर्ड सेव करें · Save password"}
          </Button>
        </form>
        <div className="mt-4 flex justify-between text-sm">
          {mode === "signin" ? (
            <button className="text-leaf-700 underline-offset-2 hover:underline" onClick={() => { setMode("forgot"); setErr(null); }}>पासवर्ड भूल गए? · Forgot password?</button>
          ) : mode === "forgot" ? (
            <button className="text-leaf-700 hover:underline" onClick={() => setMode("signin")}>← वापस · Back to sign in</button>
          ) : <span />}
        </div>
        {mode === "signup" && (
          <p className="mt-4 text-xs text-muted">
            If an admin has already added your email to your member profile, your account is approved automatically. Otherwise an admin will approve it shortly.
          </p>
        )}
      </Card>
    </div>
  );
}
