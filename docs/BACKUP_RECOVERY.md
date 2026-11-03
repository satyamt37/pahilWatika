# Backup & recovery

## What needs protecting

| Data | Where | How it is protected |
|---|---|---|
| Website code | GitHub | Git history. Any commit can be redeployed |
| Database (members, events, finance, audit logs) | Supabase Postgres | Backups below. Financial rows are append-only and cannot be deleted through the API |
| Photos, song, receipts | Supabase Storage | Backups below. Deleted photos sit in the trash until an admin empties it |

## Routine backups (monthly, about 10 minutes)

**1. Database dump.** Supabase's free plan has no automatic backup you can download, so make your own:

```bash
# Supabase dashboard → Project Settings → Database → Connection string (URI)
pg_dump "postgresql://postgres:<password>@db.<project>.supabase.co:5432/postgres" \
  --schema=public --no-owner --format=custom -f pahil-vatika-$(date +%F).dump
```

(Install the PostgreSQL client tools, or use `npx supabase db dump --data-only > data.sql` with the Supabase CLI.)

**2. Spreadsheet exports** (no tools needed):
* Admin → Members → **Excel**
* Hisaab-Kitab → Reports → **Excel** (annual and member-wise)

**3. Media files.** Supabase dashboard → Storage → download the `gallery`, `site` and `receipts` buckets. Or use the CLI:

```bash
npx supabase storage cp -r ss:///gallery ./backup/gallery --experimental
```

Keep backups in two places, for example Google Drive and an external disk.

## Restore

1. Create a new Supabase project and run `supabase/migrations/0001_init.sql`.
2. Restore the data: `pg_restore --data-only --disable-triggers -d "<new connection URI>" pahil-vatika-YYYY-MM-DD.dump`.
   Use `--disable-triggers` so the audit and finance guards don't block re-inserting historical rows. It needs the `postgres` user.
3. Upload the media folders back into buckets with the same names. Paths are stored in the database, so they must match.
4. Update the GitHub variables to the new project URL and key, then re-run the deploy workflow.

## Common incidents

| Problem | Fix |
|---|---|
| Site shows "not connected to its database" | GitHub variables are missing. Set them and re-run the deploy |
| Everything fails to load after a quiet period | The Supabase project paused. Dashboard → **Restore project** |
| A wrong financial entry | Hisaab-Kitab admin → Ledger → **Reverse** (with a reason), then enter the correct one |
| A photo deleted by mistake | Admin → Photos → Trash → **Restore** (possible until the trash is emptied) |
| Super Admin locked out | Supabase → Authentication → reset the password. Or in SQL: `update profiles set role='super_admin', approved=true where email='…';` |
| Storage full | See STORAGE.md |
