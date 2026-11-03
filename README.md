# पाहिल वाटिका योगा ग्रुप, खजुराहो

**Pahil Vatika Yoga Group, Khajuraho** · *पाहिल वाटिका योग परिवार*
एक परिवार, एक पहचान। · योग से स्वास्थ्य, साथ से खुशियाँ।

The community's digital home: member directory, photo & video memories, events
and RSVPs, birthdays and anniversaries with greeting cards, the community theme
song, announcements, and a transparent, auditable Hisaab-Kitab, plus an admin
dashboard. Mobile-first and bilingual (Hindi + English).

| | |
|---|---|
| Frontend | Next.js 15 (static export) · React 19 · TypeScript · Tailwind CSS · Recharts · SheetJS · jsPDF · Zod |
| Backend | Supabase (free tier): PostgreSQL with row-level security, Auth, Storage |
| Hosting | GitHub Pages via GitHub Actions (free) |

## Quick start

```bash
npm ci
cp .env.example .env.local      # fill in your Supabase URL + anon key
npm run dev                     # http://localhost:3000
npm test                        # 51 tests: database security, finance, imports, dates
npm run build                   # static site in ./out
```

The site is a static bundle that talks directly to Supabase. **All permissions are
enforced inside Postgres** (row-level security, triggers, and storage policies), so
the browser only ever holds the public anon key. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Going live (one time, ~15 minutes)

1. Create a free Supabase project, then run [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql) in its SQL Editor.
2. Add two repository **variables** in GitHub: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Re-run the **Deploy to GitHub Pages** workflow.
4. Sign up on the site. **The first account becomes Super Admin.**
5. Admin → Excel import → upload the member workbook.

Step-by-step with screenshots-level detail: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Documentation

| Document | Contents |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, database schema, auth, storage, permission matrix |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Supabase + GitHub Pages setup, env variables, custom domain, admin setup |
| [STORAGE.md](docs/STORAGE.md) | Free photo/video storage options compared, and how this app stays within them |
| [HISAAB_KITAB_INTEGRATION.md](docs/HISAAB_KITAB_INTEGRATION.md) | Findings on the existing Salesforce Hisaab-Kitab and the migration plan |
| [BACKUP_RECOVERY.md](docs/BACKUP_RECOVERY.md) | Backups, restore, and disaster recovery |
| [TESTING.md](docs/TESTING.md) | Automated test report and acceptance-criteria checklist |

## Project layout

```
src/app/            pages: / members gallery events celebrations song hisaab announcements profile login admin
src/components/     UI kit (ui.tsx), shell & navigation, audio player, module components, admin tabs
src/lib/            supabase client, auth/roles, dates (IST, leap years), excel parsing, finance maths, image processing
supabase/migrations SQL schema, RLS policies, triggers, storage buckets, default content
tests/              node:test suites (db.test.ts runs the real migration in PGlite)
private/            git-ignored: real member data for import (never committed)
```

## Privacy

This repository is public. Member names, phone numbers and dates are **not**
stored in it. They live only in the Supabase database, and are entered through the
admin dashboard or the Excel import.
