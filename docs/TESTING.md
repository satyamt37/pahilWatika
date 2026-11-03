# Test report

Run everything with `npm test`. The GitHub deploy workflow runs it before every
deployment, and a failing test blocks the deploy.

## Automated tests: 51 passing

### `tests/db.test.ts`: security and data rules (27 tests)
The real migration is applied to an in-process PostgreSQL (PGlite) with stand-ins
for Supabase's `auth` and `storage` schemas. Each query then runs **as a
specific user**, the same way requests arrive from the browser.

| Area | Verified |
|---|---|
| Accounts | First account becomes Super Admin. An email that matches a member is auto-approved and linked. Unknown sign-ups wait for approval. Nobody can self-promote or self-approve. The last Super Admin cannot be demoted |
| Privacy | Visitors see only public members, with no phone, birthday, year or email. Members see birthdays but not others' birth years or hidden phones. The raw members table is limited to self and admins. Members can edit their bio but not their status |
| Photos | Uploads inherit album visibility. Members cannot approve their own uploads. Duplicate hashes are rejected. Visitors see only public approved photos. Admins see the trash. Pending accounts cannot upload |
| Events | RSVP capacity enforced (counting guests). RSVP closed for past events. Duplicate title and date rejected |
| Finance | Members cannot write. The treasurer records entries, and the balance is computed from the rows (₹500 − ₹120.50 = ₹379.50). Amounts cannot be edited, and rows cannot be deleted (no API path, and the trigger blocks even privileged connections). Edits to descriptive fields are audited with old and new values. A reversal nets the balance, needs a reason and can happen only once. Dues follow configured rules (₹200 rule: ₹150 paid → *partial*, reversed payment → *pending*). Finance is hidden from visitors, and from members when the setting is off |
| Audit & stats | Member changes are written to `audit_log`. Homepage statistics count real rows only, so trashed photos are excluded |

### `tests/finance.test.ts`: Hisaab-Kitab calculations (10 tests)
Signed amounts, totals and balance with reversals, the January→December
previous-month boundary, an empty ledger shown as zeros (never sample numbers),
rounding to paise, monthly series, member and category totals, outstanding
dues, credit/debit word classification (English and Hindi), and import
duplicate keys.

### `tests/import.test.ts`: Excel import and dates (14 tests)
All date formats in the owner's sheet (`24-February-1996`, `12/20/1979`,
`4/6/2009` read as M/D, `30-June` and `24-September` without a year).
Also covered:
- Column day/month-order detection, and 29 February → 28 February in non-leap years.
- Celebration roll-over.
- Phone normalisation (`98765 43210` → `9876543210`), and हाँ/नहीं answers.
- Auto-mapping of the Hindi Google-Form headers.
- Warnings for a 2024 birth date and for an anniversary while unmarried.
- Duplicate and shared-phone handling, and event validation.

### Static checks
`next build`, which also runs TypeScript and ESLint, completes for all 17 static pages.

## Acceptance criteria

✅ = covered by an automated test above. 🔲 = manual check once the Supabase
project is connected (it needs a live browser and real files).

| Criterion | Status | How |
|---|---|---|
| A member can log in securely | ✅ / 🔲 | Approval and role rules are tested. Sign in at `/login/` |
| An administrator can create a member | ✅ / 🔲 | DB test inserts as admin. UI: Admin → Members → Add |
| Upload 20 photographs together | 🔲 | Gallery → Upload, select 20 photos. Up to `max_batch` (default 30) per batch, 3 at a time, with progress, cancel and retry |
| Photos persist after refresh and on another device | 🔲 | Stored in Supabase Storage plus the `photos` table, never in the browser |
| An administrator can create an album | 🔲 | Admin → Albums |
| Members browse and share permitted photos | ✅ / 🔲 | Visibility rules tested. Lightbox → Share / WhatsApp / Download |
| Import events from Excel; invalid rows identified | ✅ / 🔲 | Validation tested. Admin → Excel import → Events (template download available) |
| Upcoming events correct; past events archived | ✅ / 🔲 | IST date comparison. Events → Upcoming / Past |
| Birthdays and anniversaries automatic | ✅ | Date and leap-year tests. Celebrations page |
| The uploaded MP3 plays | 🔲 | Admin → Theme song → Upload MP3, then press Play |
| Hisaab-Kitab preserves historical records | ✅ (design) / 🔲 | The Salesforce app is untouched and linked. Import only with owner approval (see HISAAB_KITAB_INTEGRATION.md) |
| Balances reconcile with transactions | ✅ | Computed only from ledger rows |
| Unauthorized members cannot modify finance | ✅ | RLS plus trigger tests |
| All financial modifications auditable | ✅ | `fin_audit_log` test |
| Works on mobile | 🔲 | Bottom navigation, ≥ 44 px touch targets, sheet modals. Test on real phones at 360–414 px |
| No important button non-functional | 🔲 | Walk through each page after connecting Supabase |

## Data to verify before importing the member list

The import highlights rows that need a human check: a birth year in the future,
an anniversary for someone marked unmarried, a married member with no
anniversary, dates without a year, a missing mobile number, two rows sharing one
mobile number, and month/day dates that could be swapped. The named list for the
current member sheet is kept privately in `private/DATA_REVIEW.private.md`. It is
not in this public repository.

## Manual mobile checklist

- [ ] Bottom navigation: Home / Parivaar / Memories / Events / More, each opening the right page
- [ ] More sheet: Hisaab-Kitab, Birthdays, Theme Song, Announcements, Profile and (staff only) Admin
- [ ] Gallery: pick photos from the phone camera roll, upload, swipe in the lightbox
- [ ] Mini player keeps playing while you browse, and the song never plays twice
- [ ] Forms are usable with the on-screen keyboard. Modals scroll on small screens
- [ ] Greeting card downloads as a PNG and shares to WhatsApp
