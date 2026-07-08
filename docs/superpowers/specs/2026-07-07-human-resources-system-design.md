# Human Resources System — Design Spec

Date: 2026-07-07
Status: Batch 1 approved for implementation; Batches 2-5 scoped, not yet designed in detail

## Goal

Replace the current "Employee" module (a tab bundled inside Payroll) with a full
Human Resources system, adding 25 advanced HR functions found in elite HR
platforms (Rippling, Gusto, BambooHR, Workday-class feature sets). Work is
split into 5 batches of 5 functions; each batch gets its own implementation
pass. This spec covers the overall roadmap and a full design for Batch 1.

## Roadmap (25 functions, 5 batches)

**Batch 1 — Core Records & Org Structure** (this spec, approved)
1. Employee 360 profile (emergency contacts, address, notes, documents list)
2. Org chart (manager/reports-to hierarchy, visual tree)
3. Job & department management (titles, departments, position history)
4. Advanced employee directory (search/filter by dept, status, tenure, manager)
5. Headcount & turnover analytics dashboard

**Batch 2 — Time Off, Leave & Attendance**
6. PTO policy engine (accrual rules, carryover caps, multiple leave types)
7. Leave request workflow with approval chain
8. Timesheet/attendance tracking
9. Company holiday calendar
10. Overtime & compliance alerts

**Batch 3 — Performance & Development**
11. Performance review cycles (self + manager ratings, templates)
12. Goals/OKR tracking
13. 1-on-1 meeting notes log
14. Training & certification tracker (expiring certs)
15. Skills matrix

**Batch 4 — Compliance, Documents & Onboarding**
16. Onboarding checklist/workflow
17. Offboarding checklist
18. Document management (I-9, W-4, signed doc status, expirations)
19. Compliance tracker (license/cert/visa expirations, audit flags)
20. Disciplinary/incident case log

**Batch 5 — Compensation, Benefits & Engagement**
21. Compensation history & pay bands
22. Benefits enrollment tracking
23. Engagement surveys / eNPS
24. Expanded employee self-service portal (builds on existing `HrPortal`)
25. HR analytics dashboard (turnover %, cost-per-hire, tenure distribution)

Batches 2-5 will each get their own detailed design pass (clarifying
questions, data model, spec) before implementation, following the same
process as Batch 1.

## Current State (context)

- Sidebar has one nav entry: `{ id: 'payroll', label: 'Employee', icon: Users }`
  routing to a single combined module at `src/renderer/modules/payroll/`.
- That module's tabs today: Summary, Employees, Run Payroll, History, PTO,
  HR Portal (`Tab = 'summary' | 'employees' | 'run' | 'history' | 'pto' | 'hr-portal'`).
- `employees` table (schema.sql:230) has: name, email, type, pay_type,
  pay_rate, pay_schedule, filing_status, federal_allowances, state,
  state_allowances, start_date, end_date, ssn_last4, status, custom_fields.
  No manager, department, or job title fields exist yet.
- No dedicated `departments` table exists.

## Batch 1 Design

### Navigation

- Sidebar entry relabeled: `label: 'Employee'` → `label: 'Human Resources'`.
  The routing `id: 'payroll'` stays unchanged to avoid touching
  `MODULE_ORDER`, keyboard shortcuts, and other places keyed on `'payroll'`
  (e.g. the `payroll: 'employees'` personalization mapping in `App.tsx`).
- `MODULE_NAMES['payroll']` updated to `'Human Resources'`.
- Existing tabs unchanged in behavior: Summary, Run Payroll, History,
  Pay Stubs. The `employees` tab is relabeled **Directory** and upgraded
  (see below). PTO and HR Portal tabs are untouched in Batch 1 (they get
  built out in Batch 2 and Batch 5 respectively).
- New tabs added to the module: **Org Chart**, **Departments**, **Analytics**.

### Data model

New table (added to `src/main/database/schema.sql`):

```sql
CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  head_employee_id TEXT REFERENCES employees(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

`employees` table gets 3 new nullable columns via `ALTER TABLE` migration in
`src/main/database/index.ts` (try/catch pattern per existing convention):

- `manager_id TEXT REFERENCES employees(id)` — self-referencing, nullable
- `department_id TEXT REFERENCES departments(id)` — nullable
- `job_title TEXT DEFAULT ''`

No new history/audit table in Batch 1. Turnover and tenure analytics are
computed on the fly from existing `start_date` / `end_date` / `status`
columns. A dedicated headcount-history table is deferred until/unless
trend-over-time reporting is explicitly requested (YAGNI).

`departments` needs no entry in `tablesWithoutCompanyId` (it has
`company_id`) and no entry in `tablesWithoutUpdatedAt` (it has
`updated_at`).

### IPC handlers (new, in `src/main/ipc/index.ts`)

All company-scoped via `db.getCurrentCompanyId()`; all writes call
`scheduleAutoBackup()`.

- `departments:list` / `departments:create` / `departments:update` /
  `departments:delete`
- Employee update path extended to accept `manager_id`, `department_id`,
  `job_title` (existing employee update handler, not a new channel)
- `hr:orgChart` — returns employees joined to department name and manager
  name via `api.rawQuery()` (flat-row convention; no bare `db:query` JOINs)
- `hr:analytics` — headcount by department, active vs. terminated counts,
  average tenure, new hires/departures in a selectable date range

### UI components (`src/renderer/modules/payroll/`)

- `EmployeeList.tsx` (Directory tab): add filter bar (department, status,
  manager) and columns for department / job title / manager
- `EmployeeForm.tsx`: add Job Title (text), Department (select from
  `departments:list`), Manager (select from active employees, excluding
  self to prevent immediate self-reference)
- `OrgChart.tsx` (new): recursive indented tree built from `manager_id`,
  rooted at employees with no manager; clicking a node navigates to that
  employee's Directory record
- `DepartmentsManager.tsx` (new): CRUD list of departments, assign a
  department head
- `HrAnalytics.tsx` (new): recharts-based headcount-by-department chart,
  turnover rate, tenure distribution, using data from `hr:analytics`

### Styling / conventions

Follows existing app conventions: `.block-card` / `.block-table` /
token-driven colors (`var(--accent-primary)` etc.), no hard-coded hex,
`var(--app-radius)` for corners. New modules/tabs use the existing tab
pattern already present in `src/renderer/modules/payroll/index.tsx`.

### Out of scope for Batch 1

- Position/reporting-line history over time (deferred; simple current-state
  `manager_id`/`department_id` only, no history table)
- PTO policy changes, leave workflow, timesheets (Batch 2)
- Performance reviews, goals, training (Batch 3)
- Onboarding/offboarding, document management, compliance tracking (Batch 4)
- Compensation history, benefits, engagement surveys, portal expansion
  (Batch 5)
