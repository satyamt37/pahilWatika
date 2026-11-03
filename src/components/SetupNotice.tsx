import { Logo } from "./Logo";

/** Shown when the site was built without Supabase credentials. */
export function SetupNotice() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-cream p-4">
      <div className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-card sm:p-8">
        <Logo className="mb-4 h-16 w-16" />
        <h1 className="font-hindi text-2xl font-bold text-forest">पाहिल वाटिका योगा ग्रुप, खजुराहो</h1>
        <p className="mt-1 text-muted">The website is deployed but not yet connected to its database.</p>
        <ol className="mt-6 list-decimal space-y-2 pl-5 text-[15px] text-forest-900">
          <li>Create a free project at <a className="text-leaf underline" href="https://supabase.com" target="_blank" rel="noreferrer">supabase.com</a>.</li>
          <li>Open <b>SQL Editor</b>, paste <code>supabase/migrations/0001_init.sql</code> from the repository and run it.</li>
          <li>In GitHub → repository <b>Settings → Secrets and variables → Actions → Variables</b>, add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.</li>
          <li>Re-run the <b>Deploy</b> workflow. The first account that signs up becomes Super Admin.</li>
        </ol>
        <p className="mt-6 text-sm text-muted">Full instructions: <code>docs/DEPLOYMENT.md</code> in the repository.</p>
      </div>
    </div>
  );
}
