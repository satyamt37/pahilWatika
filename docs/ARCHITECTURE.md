# Architecture

## Overview

```
 Phone / desktop browser
        │  static HTML/JS/CSS (GitHub Pages, free, HTTPS)
        ▼
 Next.js static export ── supabase-js (anon key only) ──►  Supabase
                                                           ├─ Auth (email + password, magic link, reset)
                                                           ├─ PostgreSQL  ← RLS policies + triggers = the security boundary
                                                           └─ Storage     ← bucket policies (site: public, gallery/receipts: private)
```

**Why this stack.** GitHub Pages hosts static files only. Supabase gives a real
Postgres database, authentication and file storage on a free tier, and its
row-level security lets the database itself decide who can read or write each row.
No custom API server is needed, and there is no server whose checks could be
bypassed. A direct API call with the anon key gets exactly the same answer as the
UI.

The spec suggested Vercel and shadcn/ui. Both are interchangeable here:
- The same build deploys to Vercel unchanged.
- The UI kit in `src/components/ui.tsx` follows the same design-system pattern without the extra dependency.

## Database schema (`supabase/migrations/0001_init.sql`)

| Table / view | Purpose |
|---|---|
| `profiles` | One per login: `role` (super_admin, admin, treasurer, member), `approved`, linked `member_id` |
| `members` | Directory records, independent of logins. Birthday and anniversary stored as day/month with an **optional year** (the form data has `30-June`). Privacy flags `show_birthday`, `show_anniversary`, `show_phone`, `is_public` |
| `member_directory` (view) | Privacy-masked members: visitors get only public names and photos; members get birthdays (not years) and phones only when allowed |
| `albums`, `photos` | Photos, videos and YouTube links. `file_hash` is unique per live photo (duplicate detection). Soft delete via `deleted_at` |
| `photo_reactions`, `photo_comments` | Optional engagement for members |
| `events`, `event_rsvps`, `event_participants` (view) | Events, with RSVP capacity and "past events closed" enforced by a trigger |
| `announcements`, `announcement_reads` | Notice board, with scheduling, expiry (archive), priority, pinning, visibility, read confirmation |
| `thoughts`, `greeting_templates`, `theme_song` | सुविचार rotation, editable greeting texts, the song file, artwork and lyrics (LRC for synced lyrics) |
| `site_settings` | Website text, homepage photos, permission toggles, legacy Hisaab-Kitab URL |
| `import_batches` | Excel import history with counts and row errors |
| `fin_transactions` | **Append-only ledger.** Contributions, other income, expenses, opening balance |
| `fin_ledger`, `fin_monthly` (views), `fin_member_dues()` | Signed amounts, reversal status, monthly totals, expected vs paid per member from the configured rules |
| `fin_contribution_rules`, `fin_categories` | Configurable contribution amounts (never hard-coded) and categories |
| `fin_audit_log` | Every financial insert, update and reversal, with old and new values and the actor |
| `audit_log` | Every change to members, profiles, albums, photos, events, announcements, settings, song, templates and thoughts |

Indexes cover name search, birthday/anniversary month-day lookups, gallery
ordering, event dates, ledger dates and members.

### Financial integrity rules (enforced by trigger `fin_guard`)

* Only `super_admin` and `treasurer` can insert or update. No role can delete, and even a privileged connection is stopped by the trigger.
* Amount, type, date, member and period are **frozen** after insert. Only descriptive fields (remarks, reference, receipt…) may change, and each change is audited.
* Mistakes are fixed with `fin_reverse(id, reason)`. It writes an equal and opposite reversal entry. A reversal cannot be reversed, and an entry can be reversed only once.
* Balances are always computed by summing the signed amounts of the rows. Nothing is stored as a running total that could drift.

## Authentication

* Supabase Auth with email and password, magic link, and password reset.
* **Bootstrap:** the first account ever created becomes an approved Super Admin.
* **Linking:** when someone signs up with an email that an admin has stored on a member record, the account is approved and linked automatically. Anyone else waits in Admin → Users & roles for approval.
* Role changes: Super Admin only. The last Super Admin cannot be demoted. A member cannot change their own role or approval, or protected columns of their member record.
* Sessions: Supabase JWT with auto-refresh. Auth rate limits are applied by Supabase.

## Storage

| Bucket | Access | Contents | Limit |
|---|---|---|---|
| `site` | public read, admin write | hero and group photo, theme song MP3, artwork, event covers, announcement images | 50 MB/file |
| `gallery` | private (signed URLs, 6 h) | photos (2048 px JPEG), 480 px thumbnails, optional originals, videos, member avatars | 50 MB/file |
| `receipts` | private (finance viewers), treasurer write | expense receipts (image or PDF) | 10 MB/file |

* Members upload only into `gallery/u/<their user id>/…`.
* A file in `gallery` can be fetched by a visitor only if its photo row is approved and public, or it is the avatar of a public member.
* Images are compressed in the browser before upload: EXIF orientation is respected, and a SHA-256 hash is used for duplicate detection.
* Uploads are rate-limited per member per hour by a trigger.

## Permission matrix

| Capability | Super Admin | Admin | Treasurer | Member | Visitor |
|---|:-:|:-:|:-:|:-:|:-:|
| Public pages, public photos, public events and announcements | ✅ | ✅ | ✅ | ✅ | ✅ |
| Full directory, private photos, members-only content, RSVP | ✅ | ✅ | ✅ | ✅ | — |
| Upload photos (toggle) | ✅ | ✅ | ✅ | ✅ | — |
| Edit own profile and privacy (toggle) | ✅ | ✅ | ✅ | ✅ | — |
| Manage members, events, albums, photos, announcements, song, settings | ✅ | ✅ | — | — | — |
| View Hisaab-Kitab (toggle for members) | ✅ | ✅* | ✅ | ✅* | — |
| Record contributions, expenses, receipts, rules; reverse entries | ✅ | — | ✅ | — | — |
| Change roles, delete members | ✅ | — | — | — | — |

\* Admins and members see finance read-only when “Members can view Hisaab-Kitab”
is on (the default, for transparency).

## Frontend structure

* Static routes only (GitHub Pages). Record ids travel as query strings, for example `/events/view/?id=…`.
* `AuthProvider` loads the session, profile and settings. Role flags in the UI are hints only.
* `AudioProvider` owns the single `<audio>` element, so the song cannot play twice. It is created only on the first tap, so there is no autoplay.
* Times are handled in IST (`Asia/Kolkata`) whatever the device timezone. A 29 February birthday is celebrated on 28 February in non-leap years.
