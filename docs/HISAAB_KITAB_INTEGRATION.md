# Hisaab-Kitab integration plan

## 1. What was inspected

URL: <https://resilient-koala-m1f4xi-dev-ed.trailblaze.my.site.com/credit-debit>

| Finding | Evidence |
|---|---|
| Platform: **Salesforce Experience Cloud**, LWR runtime with Lightning Web Components, on a Developer Edition org (`-dev-ed`) | `/webruntime/…/lwr_mobile`, `LWR.define(...)`, `@app/apexApiBasePath` in the page source |
| Data object: custom object **`Credit_Debit__c`** | Route named `Credit_Debit__c` in the site's route table |
| Server logic: **Apex** controllers | `apexApiBasePath` module is loaded |
| Access control: a custom **`Check_Password`** page plus standard Login, Register and Forgot Password pages | Routes `Check_Password`, `Login`, `Register`, `Forgot_Password` |
| Records, calculations, reports | **Not visible.** Without Salesforce credentials the page renders only its shell, so no records, fields, formulas or reports could be read |

The source code (Apex classes, LWC bundles, object metadata) was not supplied, so
the existing calculation logic is not yet documented. It must be read before any
migration.

## 2. Approach (non-destructive)

1. **Keep the Salesforce app running, unchanged.** The new Hisaab-Kitab page links to it (*Admin → Website settings → Legacy Hisaab-Kitab URL*) as the historical source of truth. Salesforce sites block being embedded in other pages, so it opens in a new tab.
2. The new platform has its **own audited ledger** (append-only, reversal-based corrections, full audit log; see ARCHITECTURE.md). The treasurer can start recording new entries there whenever the committee decides.
3. **Migration happens only with the owner's approval**, using the import in *Admin → Hisaab-Kitab → Import*:
   * In Salesforce, create a report (or list view) on `Credit_Debit__c` with all fields and export it to Excel/CSV.
   * Upload it. Map the columns (date, amount, credit/debit or type, member or party, description, record Id) and review the preview.
   * Errors and duplicates are highlighted. The record Id is kept in `external_ref`, so re-importing never creates duplicates.
   * The import button stays disabled until "owner approved" is ticked. Each import is recorded with counts and a downloadable error report.
4. **Reconcile.** After import, compare *Total collection*, *Total expenditure* and *Balance* on the new dashboard with Salesforce's totals for the same period. If they differ, fix the cause with reversal entries. No row is ever edited or deleted.
5. When both agree, the committee decides on a cut-over date. Salesforce can then be kept read-only as an archive.

## 3. Information still needed from the owner

* Salesforce admin access (or an export of `Credit_Debit__c` with its field list).
* Apex source and any formula fields that compute balances or dues, to confirm the rules match `fin_contribution_rules`.
* How the `Check_Password` gate is used (a shared password?). The new site replaces it with per-person logins and roles.

## 4. Live API integration (optional, later)

If a live link is preferred over a one-time import: create a Salesforce Connected
App and a small Supabase Edge Function that reads `Credit_Debit__c` through the
REST API (`/services/data/vXX.X/query?q=SELECT … FROM Credit_Debit__c`) on a
schedule. It would insert new rows with `source = 'salesforce_import'` and the
record Id as `external_ref`. This needs Salesforce credentials stored as Supabase
secrets. It is not built yet, because it would act on financial data without
approval.
