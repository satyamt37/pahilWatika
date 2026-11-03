# Deployment

Everything runs on free tiers: **GitHub Pages** (website), **Supabase Free**
(database, login, file storage) and **GitHub Actions** (build, deploy, keep-alive).

## 1. Create the Supabase project

1. Sign up at <https://supabase.com>, then **New project**.
   * Name: `pahil-vatika`. Region: **Mumbai (ap-south-1)**, closest to Khajuraho.
   * Save the database password in a safe place.
2. **SQL Editor → New query**: paste all of `supabase/migrations/0001_init.sql`, then **Run**.
   It creates the tables, security policies, storage buckets, default albums and greeting texts.
3. **Authentication → URL Configuration**:
   * Site URL: `https://satyamt37.github.io/pahilWatika/`
   * Redirect URLs: add `https://satyamt37.github.io/pahilWatika/**` (and `http://localhost:3000/**` for development).
4. **Authentication → Providers → Email**: keep *Confirm email* on.
   The free tier sends a limited number of emails per hour. For more, add your own SMTP under *Authentication → SMTP Settings* (for example a Gmail app password or Brevo's free plan).
5. **Project Settings → API**: copy the **Project URL** and the **anon public** key.
   Never use the `service_role` key in the website.

## 2. Connect GitHub Pages

Repository → **Settings → Secrets and variables → Actions → Variables** → *New repository variable*:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon public key |
| `CUSTOM_DOMAIN` | *(optional)* `true` only when serving from your own domain |

Or from a terminal:

```bash
gh variable set NEXT_PUBLIC_SUPABASE_URL --body "https://<project>.supabase.co" -R satyamt37/pahilWatika
gh variable set NEXT_PUBLIC_SUPABASE_ANON_KEY --body "<anon key>" -R satyamt37/pahilWatika
gh workflow run "Deploy to GitHub Pages" -R satyamt37/pahilWatika
```

The site is published at **https://satyamt37.github.io/pahilWatika/** (HTTPS is
automatic). Every push to `main` redeploys. The build runs all tests first.

## 3. First login and admin setup

1. Open the site → **लॉगिन → नया खाता** and sign up with the owner's email. The first account becomes **Super Admin**.
2. **Admin → Website settings**: upload the hero (sunrise or garden) photo and the group photo, then add the session time and contact details.
3. **Admin → Excel import**: upload the member workbook. The prepared file is `private/members-import.private.xlsx`; it is git-ignored and stays on this computer.
   * Review the warnings before importing (see *Data to verify* in TESTING.md).
4. **Admin → Theme song**: upload the original MP3, the artwork and the lyrics.
5. **Admin → Members**: add each member's email. When they sign up with that email, they are approved automatically.
6. **Admin → Users & roles**: approve other sign-ups. The Super Admin assigns Admin and Treasurer roles.
7. **Admin → Hisaab-Kitab → Rules**: set the contribution amount. Nothing is assumed.

## 4. Custom domain (optional)

1. Repository → Settings → Pages → Custom domain → `pahilvatika.in` (example). Add the DNS records GitHub shows.
2. Set the repository variable `CUSTOM_DOMAIN=true` (the site is then served from `/` instead of `/pahilWatika`).
3. Update the Supabase Site URL and Redirect URLs to the new domain, then re-run the deploy workflow.

## 5. Environment variables

| Name | Where | Secret? | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | build | no | Supabase API endpoint |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | build | no, public by design; RLS protects the data | Browser API key |
| `NEXT_PUBLIC_BASE_PATH` | build (set by the workflow) | no | `/pahilWatika` on GitHub Pages, empty on a custom domain |

There are no server secrets. The `service_role` key must never be put in this repository or in the website.

## 6. Keep-alive

Free Supabase projects pause after 7 days with no traffic. The **Keep Supabase
awake** workflow calls a read-only function every 3 days. If the project is ever
paused, open the Supabase dashboard and click **Restore**. No data is lost.

## 7. Updating the database later

New SQL changes go into `supabase/migrations/0002_*.sql`. Run them in the SQL
Editor, after taking a backup (see BACKUP_RECOVERY.md).
