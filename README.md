# BMP Media Production Payroll

Secure payroll management for BMP Media Production in Uganda.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/e813f625-c9a5-404f-b54e-17e8b615ae81).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

Use `npm run dev:bypass` to open the app without the sign-in screen while developing. This bypass
is enabled only by Vite's development server and does not create an authenticated Supabase session;
database access and server actions continue to require valid authentication.

## Payroll system

Payroll staff can create Monday-to-Sunday weekly runs and compile month-end summaries from the weekly runs whose end date falls in that month. Salaried weekly pay is calculated from the monthly salary, prorated over 52 weeks. Attendance and approved overtime are included as payroll summary information for salaried staff; the system does not apply automatic absence deductions or salaried overtime pay. For casual staff, attendance days determine pay and entered casual overtime is added to gross pay.

## Employee contracts

HR and administrators can manage staff contracts from People & Payroll. Active contracts expiring
within 30 days are highlighted in the app and marked in the navigation. The builder lets HR edit
employer and employee particulars, pay and working terms, duties, and reusable contract clauses;
it provides a live print preview and stores the signed copy separately from any draft attachment.
The employee editor can select an existing signed contract already linked to that employee as the
employee's current contract; it cannot reassign contracts across employees.
Have a qualified local HR/legal adviser review the contract wording before issuing it. Apply
`20261029020000_employee_contracts.sql` after the employee profile/document migration, then apply
`20261029030000_contract_document_builder.sql`. Contract files are private and accessible only to
HR and administrators.

Daily email reminders are sent to every HR and administrator account with an email address. To
enable delivery, configure the Supabase Edge Function with a verified Resend sender and a generated
job secret, then deploy it:

```sh
supabase secrets set RESEND_API_KEY="<Resend API key>" RESEND_FROM_EMAIL="<verified sender>" CONTRACT_JOB_SECRET="<generated secret>"
supabase functions deploy contract-expiry-notifications
```

In Supabase Vault, save the function URL
(`https://txujegjcmtoaoflwccps.supabase.co/functions/v1/contract-expiry-notifications`) as
`contract_function_url` and the same generated secret as `contract_job_secret` before applying the
contracts migration. It schedules a daily run at 06:00 Africa/Kampala. Reminder emails are sent
once per contract end date and recipient; changing a contract's end date starts a new reminder
cycle. Keep the Resend API key and job secret out of source control.

## Finance foundation

The administrator/accountant Treasury & Accounts page supports UGX/USD cash, bank, and mobile-money
accounts (including MTN Mobile Money and Airtel Money), documented USD exchange rates, income and
expense entries, same-currency internal transfers, and account balances. Each bank or mobile-money
statement period can be reconciled by matching posted account movements and confirming the
statement opening and closing balances. Finalized periods and their matches are locked; a new
transaction cannot be backdated into a finalized period. Apply
`20261006100000_finance_foundation.sql` and `20261028200000_financial_reconciliation.sql` after
the preceding migrations. Financial entries are immutable after posting; record a correction
instead of editing or deleting a posted transaction. Cross-currency transfers and double-entry
journals are available after applying `20261028280000_accounting_ledger_and_payroll_posting.sql`.
Transfers capture source and destination amounts and their documented exchange rates; fees post as
separate expenses, and realized UGX conversion differences are journaled separately. The chart of
accounts is generated from treasury accounts and transaction categories. Opening balances remain
separate by currency. Finance reports include posted payroll and currency-conversion adjustments
without exposing individual payroll transactions to accountants. The generated categories and
accounting treatment require an Ugandan accountant's review before production use.

## Clients and projects

The Projects & partners page stores client/supplier contact and billing records and creates
production projects with a unique project ID, client, service, scope, contract and budget
currencies, responsible person, schedule, and lifecycle status. Records are archived rather than
deleted, and inserts/updates are captured in a business audit log. Apply
`20261028210000_business_parties_projects.sql` after the finance migrations. The administrator-only
Invoices & collections page creates draft invoices with line items, issues them, tracks due dates
and remaining balances, and records partial/final receipts. Quotations are managed separately in
the Quotations page: finance administrators and accountants with MFA can create itemized offers,
record when they were sent, accepted, or rejected with an audit note, and convert accepted,
unexpired offers into linked draft invoices without re-entering the line items or currency. Each
receipt creates a corresponding
immutable income transaction on its selected currency-matched account and preserves the applied
USD exchange rate. Apply `20261028220000_invoicing_and_collections.sql` after the business party
and project migration, then apply `20261028290000_sales_quotations.sql` for quotations. The
Expenses & approvals page supports employee expense requests,
direct-project versus general costs, supplier and receipt references, reviewer approval/rejection,
and administrator settlement to a currency-matched account. The requester cannot review their own
request, rejected requests require a reason, and settlements post immutable expense transactions.
Requests can include an expected payment date for the approved-commitments forecast, and manual
transactions can be assigned to projects with direct/general expense classification. Apply
`20261028230000_expense_requests.sql` after the invoicing migration and then
`20261028240000_budgets_and_financial_reporting.sql`. The administrator/accountant Finance reports page
supports monthly UGX/USD budgets with approval, budget-versus-actual, monthly income and expenses,
project profitability, approved commitments, receivables/payables aging, expected cash flow, and
CSV export. Apply `20261028250000_extended_app_roles.sql`,
`20261028260000_accountant_producer_access.sql`, and
`20261028270000_vendor_payables_and_cashflow.sql` in timestamp order. Administrators can assign
HR, accountant, and producer roles from User access; producers see only assigned projects and their
own expense requests. Private receipt attachments use the `expense-receipts` storage bucket and
short-lived signed links. Admins and accountants must enroll an authenticator from Account settings
and complete MFA verification before accessing finance pages or records. Supplier bills require a
separate manager approval and can be partially paid from a currency-matched account.
The accounting migration creates immutable balanced journal entries for existing and new posted
transactions, maps each treasury account to a ledger asset account, and provides ledger balances and
a journal register. Payroll is posted atomically from a draft run: the administrator selects a UGX
payment account and date, and the system records net cash paid, gross salary expense, and PAYE/NSSF
payables before marking the run paid. A run cannot be marked paid through a direct status update.
Existing payroll runs already marked paid before this migration are not assigned an invented
payment account or date; reconcile those historical runs with the accountant separately. The
foreign-currency clearing accounts should be reviewed and cleared as part of period-end procedures.

## Backend transition

The current React app uses Supabase directly as the development/MVP backend. The agreed direction
is to finish this iteration on Supabase and use Django for the production backend. Before launch,
make Django the only application data API: do not let the production browser call Supabase tables
or RPCs directly. Prefer moving the PostgreSQL data to a Django-controlled PostgreSQL instance at
cutover rather than coupling Django permissions to Supabase `auth.uid()` policies. Export and
reconcile the financial records, users/roles, audit logs, and private files before switching
traffic; keep a read-only, encrypted backup of the source until the cutover is signed off.

### Backup, restore, and cutover checklist

- Enable the Supabase project's managed database backups/PITR plan appropriate to the production
  recovery objective. Limit backup access to designated administrators; encrypt exports at rest and
  keep encryption keys separately. Never put backup files or database URLs in this repository.
- Back up private Storage objects separately from PostgreSQL. Preserve bucket and object paths,
  metadata, and access controls; a SQL dump alone does not contain receipt files.
- Before a release or migration, take a named backup and record its timestamp, schema migration
  version, and storage-object inventory. Keep immutable copies outside the application project.
- Restore the database and private objects into an isolated staging project on a scheduled test.
  Verify that the application can sign in, access private receipts according to role, and reproduce
  financial account balances and reconciliations. Record restore duration and any unrecovered data.
  Do not call a backup tested until the restore and balance checks succeed.
- For Django cutover, first migrate the Django schema and permissions in staging; map every current
  role and workflow; run a repeatable, idempotent data/file import; compare record counts, balances
  by account and currency, open receivables/payables, journal totals, payroll postings, and audit
  history. Resolve differences with the accountant before scheduling the production cutover.
- At cutover, freeze writes in the old application, take the final database and private-file
  backups, run the final import, verify control totals, and switch the production browser to Django.
  Do not dual-write. Keep the Supabase source read-only until acceptance; define an owner-approved
  rollback window and rollback steps before reopening writes.
- Do not migrate Supabase password hashes directly into Django. Use verified invitations/password
  resets or a deliberately selected identity provider, and require finance users to enroll MFA in
  the production identity system before they can approve or post financial transactions.

Implement Django REST Framework endpoints with server-side permission checks and atomic posting
services, then migrate one UI workflow at a time behind a typed API client. Do not dual-write
financial transactions. Plan authentication as a separate cutover: Supabase password hashes are
not a drop-in Django password store, so plan verified account invitations/password resets or a
deliberate identity-provider integration. Move receipt files to private object storage and issue
short-lived signed downloads from Django. Use separate staging/production secrets, HTTPS, MFA for
finance approvers, tested backups/restores, monitoring, and an Ugandan accountant's review before
production financial use. Supabase migrations and RPCs are transitional—not the future Django API
contract.

The Attendance page imports attendance CSV files exported from a compatible Hikvision device or its management software. Files need an employee number and timestamp (or separate date and time) columns. Use `check_in` and `check_out` event types for paired work-hour totals. Device connection depends on the final Hikvision model and available network/API access.

The Employee ID cards page records issued cards and prints a staff card. Employees can view their own payslips and submit leave or overtime requests after an administrator links their account to their staff record. In Staff, enter the employee's Supabase user UUID in **Linked account ID** to enable this access. Signed-in users can update their profile name, email address, and password from Account settings.

On phone-sized screens, navigation is available from the fixed bottom bar; less-used pages and actions are in **More**. Switch between light and dark appearance with the theme toggle; the selection is saved on the current device. Staff, attendance, request, ID-card, payroll report and payslip records can be searched and filtered, and data-heavy views use responsive cards.

Casual employees use a daily rate and their payroll has no PAYE or NSSF deductions. Weekly casual pay uses attendance days multiplied by the daily rate. HR can mark full-day attendance manually from the Attendance page when machine import is unavailable; manual ticks do not create work-hour totals. Casual overtime can be entered as a direct amount, hours multiplied by an hourly rate, or a special-day bonus.

Before running the updated application against a new Supabase project, apply the migrations in `supabase/migrations` in timestamp order. The initial migration creates the core staff, payroll, payslip, role tables and access-control functions. The workforce migration adds weekly payroll periods, attendance, requests, ID cards, monthly compilations and employee access policies. The casual-payroll migration adds daily-rate pay, overtime methods and a staff-only transactional payroll import.

The casual payroll importer accepts Excel workbooks, CSV and tab-separated files. For Excel workbooks, it finds the payroll header row in a worksheet even when a title appears above it. The supplied September 22–30, 2026 casual-worker data is staged locally in `local-imports/bmp-casual-workers-sept-2026.csv`; the directory is ignored by Git because it contains personal contact data. Once all migrations are applied, an authorised user can open Payroll → **Import casual payroll**, choose the file, review the 94-row preview and UGX 9,465,000 total, then import it as a draft. The import assigns CAS-2026-001 through CAS-2026-094 as employee numbers because the sheet's No column contains row numbers, preserves the reported aggregate attendance days, and records no overtime because none was itemised. The server checks staff access and saves the staff records and payslips in one transaction.

After applying the migrations, create the initial account in Supabase Dashboard under Authentication → Users. Use `admin@bmpmedia.ug` for the administrator email and set a temporary password there; do not store the password in source control or migration files. Then grant the administrator role from the Supabase SQL Editor:

```sql
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role
FROM auth.users
WHERE email = 'admin@bmpmedia.ug'
ON CONFLICT (user_id, role) DO NOTHING;
```

The administrator can change their name, login email, and password in Account settings after signing in. Confirm an email change using the message sent to the new address, and replace any temporary password immediately after first login.

Public account creation is disabled in the sign-in screen and in the local Supabase Auth configuration. For the hosted Supabase project, also turn off **Allow new users to sign up** in Authentication → Settings so the restriction is enforced by the hosted Auth service. Administrators should create staff accounts from the Supabase Dashboard.
