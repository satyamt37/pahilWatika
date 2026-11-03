// End-to-end database tests: applies the real migration to an in-process
// Postgres (PGlite) with minimal stand-ins for Supabase's `auth` and `storage`
// schemas, then checks RLS, roles, privacy masking and the financial ledger rules
// by acting as different users — exactly how requests arrive from the browser.
import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, test } from "node:test";

const SUPABASE_STUBS = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, metadata jsonb);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as
  $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
`;

const GRANTS = `
grant usage on schema public, auth, storage to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;
grant execute on all functions in schema public to authenticated;
grant execute on all functions in schema auth to anon, authenticated;
`;

const db = new PGlite();
const U = {
  owner: "00000000-0000-0000-0000-000000000001",
  ravi: "00000000-0000-0000-0000-000000000002",
  stranger: "00000000-0000-0000-0000-000000000003",
  treasurer: "00000000-0000-0000-0000-000000000004",
};

/** Run SQL as a given user (null = anonymous visitor), like PostgREST does. */
async function as<T = Record<string, unknown>>(uid: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec("reset role;");
  }
}
async function rejects(uid: string | null, sql: string, re: RegExp) {
  await assert.rejects(as(uid, sql), (e: Error) => {
    assert.match(e.message, re);
    return true;
  });
}
async function signUp(id: string, email: string, name: string) {
  await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
  await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, email, { full_name: name }]);
}

before(async () => {
  await db.exec(SUPABASE_STUBS);
  await db.exec(readFileSync(new URL("../supabase/migrations/0001_init.sql", import.meta.url), "utf8"));
  await db.exec(GRANTS);
});

describe("accounts & roles", () => {
  test("first account becomes approved super admin", async () => {
    await signUp(U.owner, "owner@example.com", "Owner");
    const [p] = await as(U.owner, "select role, approved from profiles where id = $1", [U.owner]);
    assert.deepEqual(p, { role: "super_admin", approved: true });
  });

  test("owner adds members; a sign-up with a matching email is auto-approved and linked", async () => {
    await as(U.owner, `insert into members (full_name, email, phone, birth_day, birth_month, birth_year, show_phone, is_public)
      values ('Ravi Kumar', 'ravi@example.com', '9000000001', 24, 2, 1996, false, true),
             ('Private Person', null, '9000000002', 5, 3, null, true, false)`);
    await signUp(U.ravi, "Ravi@Example.com", "Ravi");
    const [p] = await as(U.ravi, "select role, approved, member_id is not null as linked from profiles where id = $1", [U.ravi]);
    assert.deepEqual(p, { role: "member", approved: true, linked: true });
  });

  test("unknown sign-up waits for approval and sees no member data", async () => {
    await signUp(U.stranger, "x@example.com", "Stranger");
    const [p] = await as(U.stranger, "select approved from profiles where id = $1", [U.stranger]);
    assert.equal(p.approved, false);
    const rows = await as(U.stranger, "select full_name, phone, birth_day from member_directory");
    assert.deepEqual(rows.map((r) => r.full_name), ["Ravi Kumar"]); // public member only
    assert.equal(rows[0].phone, null);
    assert.equal(rows[0].birth_day, null);
  });

  test("a member cannot promote themself or self-approve", async () => {
    await rejects(U.ravi, `update profiles set role = 'super_admin' where id = '${U.ravi}'`, /super admin can change roles/);
    await rejects(U.stranger, `update profiles set approved = true where id = '${U.stranger}'`, /Only admins/);
  });

  test("the last super admin cannot be demoted", async () => {
    await rejects(U.owner, `update profiles set role = 'member' where id = '${U.owner}'`, /last super admin/);
  });
});

describe("privacy", () => {
  test("visitors see only public members and never private fields", async () => {
    const rows = await as(null, "select full_name, phone, birth_day, birth_year, email from member_directory");
    assert.deepEqual(rows, [{ full_name: "Ravi Kumar", phone: null, birth_day: null, birth_year: null, email: null }]);
    assert.equal((await as(null, "select * from members")).length, 0);
  });

  test("members see birthdays but not birth years or hidden phones of others", async () => {
    const rows = await as(U.ravi, "select full_name, phone, birth_day, birth_year from member_directory order by full_name");
    const priv = rows.find((r) => r.full_name === "Private Person")!;
    assert.equal(priv.phone, "9000000002"); // show_phone = true
    assert.equal(priv.birth_day, 5);
    const self = rows.find((r) => r.full_name === "Ravi Kumar")!;
    assert.equal(self.phone, "9000000001"); // own phone is visible to self
    assert.equal(self.birth_year, 1996); // own birth year visible to self
  });

  test("a member cannot read the raw members table of others", async () => {
    const rows = await as(U.ravi, "select full_name from members");
    assert.deepEqual(rows.map((r) => r.full_name), ["Ravi Kumar"]);
  });

  test("a member cannot change their own status", async () => {
    await rejects(U.ravi, `update members set status = 'inactive' where user_id = '${U.ravi}'`, /Not allowed/);
  });

  test("a member can edit their own bio", async () => {
    await as(U.ravi, `update members set bio = 'Yoga every morning' where user_id = '${U.ravi}'`);
    const [r] = await as(U.owner, "select bio from members where email = 'ravi@example.com'");
    assert.equal(r.bio, "Yoga every morning");
  });
});

describe("photos", () => {
  test("member upload inherits album visibility; members cannot approve their own uploads", async () => {
    const [album] = await as(U.owner, "select id from albums where name = 'Morning Yoga'");
    const [ph] = await as(U.ravi, `insert into photos (album_id, storage_path, thumb_path, file_hash, is_public, status)
      values ($1, 'u/x/a.jpg', 'u/x/a_t.jpg', 'hash1', false, 'approved') returning is_public, status, uploaded_by`, [album.id]);
    assert.equal(ph.is_public, true); // Morning Yoga is a public album
    assert.equal(ph.uploaded_by, U.ravi);
    await rejects(U.ravi, "update photos set status = 'hidden' where file_hash = 'hash1'", /Only admins/);
  });

  test("duplicate photo hash is rejected", async () => {
    await assert.rejects(as(U.ravi, "insert into photos (storage_path, file_hash) values ('u/x/b.jpg', 'hash1')"), /photos_hash_uniq/);
  });

  test("visitors see public approved photos; admins also see the trash", async () => {
    assert.equal((await as(null, "select id from photos")).length, 1);
    await as(U.owner, "update photos set deleted_at = now() where file_hash = 'hash1'");
    assert.equal((await as(null, "select id from photos")).length, 0);
    assert.equal((await as(U.owner, "select id from photos where deleted_at is not null")).length, 1);
  });

  test("pending accounts cannot upload", async () => {
    await assert.rejects(as(U.stranger, "insert into photos (storage_path, file_hash) values ('u/y/c.jpg', 'h3')"), /row-level security/);
  });
});

describe("events & RSVP", () => {
  test("capacity is enforced in the database", async () => {
    const [ev] = await as(U.owner, `insert into events (title, event_date, max_capacity) values ('Picnic', current_date + 10, 2) returning id`);
    await as(U.ravi, "insert into event_rsvps (event_id, status, guests) values ($1, 'going', 1)", [ev.id]);
    await as(U.owner, "insert into event_rsvps (event_id, status, guests) values ($1, 'maybe', 0)", [ev.id]);
    await assert.rejects(as(U.owner, "update event_rsvps set status = 'going' where event_id = $1 and user_id = auth.uid()", [ev.id]), /full/);
  });

  test("RSVP is closed for past events", async () => {
    const [ev] = await as(U.owner, `insert into events (title, event_date) values ('Old meet', current_date - 3) returning id`);
    await assert.rejects(as(U.ravi, "insert into event_rsvps (event_id, status) values ($1, 'going')", [ev.id]), /closed/);
  });

  test("duplicate event title on the same date is rejected", async () => {
    await assert.rejects(as(U.owner, "insert into events (title, event_date) values (' picnic', current_date + 10)"), /events_dupe_uniq/);
  });
});

describe("Hisaab-Kitab ledger", () => {
  let memberId = "";
  let txnId = "";

  test("treasurer role can be granted by the super admin", async () => {
    await signUp(U.treasurer, "t@example.com", "Treasurer");
    await as(U.owner, `update profiles set approved = true where id = '${U.treasurer}'`);
    await as(U.owner, `update profiles set role = 'treasurer' where id = '${U.treasurer}'`);
    const [m] = await as(U.owner, "select id from members where email = 'ravi@example.com'");
    memberId = m.id as string;
  });

  test("members cannot record financial entries", async () => {
    await assert.rejects(
      as(U.ravi, "insert into fin_transactions (kind, amount, txn_date, member_id) values ('contribution', 100, current_date, $1)", [memberId]),
      /row-level security|Only the treasurer/,
    );
  });

  test("treasurer records contributions and expenses; balance comes from the rows", async () => {
    const [t] = await as(U.treasurer, `insert into fin_transactions (kind, amount, txn_date, member_id, payment_method)
      values ('contribution', 500, '2026-10-05', $1, 'upi') returning id, period_month, created_by`, [memberId]);
    txnId = t.id as string;
    assert.equal(t.created_by, U.treasurer);
    assert.equal(new Date(t.period_month as string).toISOString().slice(0, 10), "2026-10-01");
    await as(U.treasurer, "insert into fin_transactions (kind, amount, txn_date, title, category) values ('expense', 120.5, '2026-10-06', 'Chai', 'Chai-chappa')");
    const [b] = await as(U.ravi, "select sum(signed_amount)::numeric as bal from fin_ledger");
    assert.equal(Number(b.bal), 379.5);
  });

  test("amounts cannot be edited and records cannot be deleted", async () => {
    await rejects(U.treasurer, `update fin_transactions set amount = 1 where id = '${txnId}'`, /cannot be edited/);
    // Through the API there is no DELETE policy, so nothing is deleted…
    await as(U.owner, `delete from fin_transactions where id = '${txnId}'`);
    assert.equal((await as(U.treasurer, `select id from fin_transactions where id = '${txnId}'`)).length, 1);
    // …and even a privileged connection that bypasses RLS is stopped by the trigger.
    await db.exec("reset role;");
    await assert.rejects(db.query(`delete from fin_transactions where id = '${txnId}'`), /cannot be deleted/);
    // Remarks can change, and the change is audited with old values.
    await as(U.treasurer, `update fin_transactions set remarks = 'Paid via GPay' where id = '${txnId}'`);
    const audit = await as(U.treasurer, `select action, old_values->>'remarks' as old_r, new_values->>'remarks' as new_r from fin_audit_log where txn_id = '${txnId}' order by id`);
    assert.deepEqual(audit.map((a) => a.action), ["insert", "update"]);
    assert.equal(audit[1].new_r, "Paid via GPay");
  });

  test("a reversal nets the balance to the remaining entries and cannot be repeated", async () => {
    await as(U.treasurer, `select fin_reverse('${txnId}', 'Entered twice')`);
    const [b] = await as(U.treasurer, "select sum(signed_amount)::numeric as bal from fin_ledger");
    assert.equal(Number(b.bal), -120.5);
    const [o] = await as(U.treasurer, `select is_reversed from fin_ledger where id = '${txnId}'`);
    assert.equal(o.is_reversed, true);
    await assert.rejects(as(U.treasurer, `select fin_reverse('${txnId}', 'again')`), /duplicate key|unique/);
  });

  test("reversal requires a reason", async () => {
    await rejects(U.treasurer, `select fin_reverse('${txnId}', '  ')`, /reason is required/);
  });

  test("dues follow the configured rule, not a fixed amount", async () => {
    await as(U.treasurer, "insert into fin_contribution_rules (name, amount, effective_from) values ('Monthly', 200, '2026-09-01')");
    await as(U.treasurer, `insert into fin_transactions (kind, amount, txn_date, member_id, period_month) values ('contribution', 150, '2026-09-10', $1, '2026-09-01')`, [memberId]);
    const rows = await as(U.ravi, `select member_name, to_char(period_month, 'YYYY-MM') as m, expected::numeric, paid::numeric, status
      from fin_member_dues('2026-09-01', '2026-10-01') where member_id = $1 order by period_month`, [memberId]);
    assert.deepEqual(rows.map((r) => [r.m, Number(r.expected), Number(r.paid), r.status]), [
      ["2026-09", 200, 150, "partial"],
      ["2026-10", 200, 0, "pending"], // the October payment was reversed
    ]);
  });

  test("finance is hidden from members when the setting is off, and from visitors always", async () => {
    assert.equal((await as(null, "select id from fin_transactions")).length, 0);
    await as(U.owner, `update site_settings set value = value || '{"finance_visible_to_members": false}' where key = 'permissions'`);
    assert.equal((await as(U.ravi, "select id from fin_transactions")).length, 0);
    assert.ok((await as(U.treasurer, "select id from fin_transactions")).length > 0);
    await as(U.owner, `update site_settings set value = value || '{"finance_visible_to_members": true}' where key = 'permissions'`);
  });
});

describe("content audit & stats", () => {
  test("changes to members are written to the audit log", async () => {
    const rows = await as(U.owner, "select action from audit_log where table_name = 'members'");
    assert.ok(rows.some((r) => r.action === "insert") && rows.some((r) => r.action === "update"));
  });

  test("site_stats counts real rows only", async () => {
    const [s] = await as(null, "select site_stats() as s");
    const stats = s.s as Record<string, number>;
    assert.equal(stats.members, 2);
    assert.equal(stats.photos, 0); // the only photo is in the trash
  });
});
