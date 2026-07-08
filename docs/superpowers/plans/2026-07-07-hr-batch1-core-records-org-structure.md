# HR Batch 1 — Core Records & Org Structure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand the combined Payroll/Employee module as "Human Resources" and add Batch 1 of the 25-function HR roadmap: a `departments` table, `manager_id`/`department_id` on employees, an upgraded Directory with filters, an Org Chart tab, a Departments management tab, and an Analytics tab.

**Architecture:** New `departments` table + 2 new `employees` columns, all CRUD riding on the app's existing generic `db:query`/`db:create`/`db:update`/`db:delete` IPC handlers (just add `'departments'` to the `VALID_TABLES` whitelist); two new read-only dedicated IPC handlers (`hr:orgChart`, `hr:analytics`) for joined/aggregated data the generic CRUD can't produce; three new React tab components plumbed into the existing tab-switching pattern in `src/renderer/modules/payroll/index.tsx`.

**Tech Stack:** Electron 41, React 19, TypeScript, better-sqlite3, recharts (already a dependency), Tailwind + the app's `.block-*` utility classes.

**Batch 1 function coverage:** function 1 (Employee 360 profile — emergency contacts, address, notes) is already fully implemented in the existing `EmployeeForm.tsx`/`employees` table from prior work and needs no new task here. Functions 2-5 (org chart, job/department management, advanced directory, headcount/turnover analytics) are covered by Tasks 1-9 below.

**No automated test framework exists in this project** (no jest/vitest; confirmed via `package.json` — the `test:*` scripts are one-off Node scripts with no assertions/reporter). Every task below is verified manually via the dev server (`npm run dev` / the `preview_*` tools) instead of with a test runner. `npm run typecheck` is used as the automated correctness gate in place of unit tests.

---

### Task 1: `departments` table + `employees.manager_id`/`department_id` columns + `VALID_TABLES`

> **Amendment (discovered during Task 3 review, fixed in commit `5d11dcc`):** A `departments` table already existed in this codebase from an earlier "F228" cost-accounting batch, with columns `id, company_id, code (NOT NULL, UNIQUE with company_id), name, manager_id, parent_id, description, is_active, created_at, updated_at`. The `CREATE TABLE IF NOT EXISTS departments (...)` below was silently a no-op against that real table, and its narrower shape (`head_employee_id`) doesn't reflect what actually exists. The step below is left as originally written for history, but **the actual applied fix removed the CREATE TABLE + its index entirely**, keeping only the two `employees` ALTER TABLEs. Downstream tasks must use the *real* schema: department name is `name`, department head is the existing `manager_id` column (not `head_employee_id`), and creating a department requires a `code` (required, unique per company) in addition to `name`.

**Files:**
- Modify: `src/main/database/index.ts` (append to the `migrations` array, ends at line 9379 with `"ALTER TABLE expenses ADD COLUMN vendor_location_id TEXT DEFAULT NULL",` followed by `];`)
- Modify: `src/main/ipc/index.ts:709` (`VALID_TABLES` Set)

Precedent: the most recent table addition (`vendor_locations`) was added as a multi-line `CREATE TABLE IF NOT EXISTS` string inside this same `migrations` array (not in `schema.sql`), so `departments` follows the same precedent for consistency.

- [ ] **Step 1: Add the `departments` table and the two new `employees` columns to the migrations array**

In `src/main/database/index.ts`, find this exact block near line 9377-9379:

```ts
  "CREATE INDEX IF NOT EXISTS idx_vendor_locations_vendor ON vendor_locations(vendor_id)",
  "ALTER TABLE expenses ADD COLUMN vendor_location_id TEXT DEFAULT NULL",
  ];
```

Replace it with:

```ts
  "CREATE INDEX IF NOT EXISTS idx_vendor_locations_vendor ON vendor_locations(vendor_id)",
  "ALTER TABLE expenses ADD COLUMN vendor_location_id TEXT DEFAULT NULL",
  `CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    name TEXT NOT NULL,
    head_employee_id TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_departments_company ON departments(company_id)",
  "ALTER TABLE employees ADD COLUMN manager_id TEXT DEFAULT ''",
  "ALTER TABLE employees ADD COLUMN department_id TEXT DEFAULT ''",
  ];
```

- [ ] **Step 2: Add `'departments'` to `VALID_TABLES`**

In `src/main/ipc/index.ts`, find (around line 725-728):

```ts
    'payroll_runs', 'pay_stubs', 'federal_payroll_constants',
    'employee_equipment', 'equipment_penalties', 'employee_credentials',
    'employee_checklist_items', 'employee_reviews', 'employee_disciplinary',
    'pto_policies', 'pto_balances', 'pto_transactions',
```

Replace with:

```ts
    'payroll_runs', 'pay_stubs', 'federal_payroll_constants',
    'employee_equipment', 'equipment_penalties', 'employee_credentials',
    'employee_checklist_items', 'employee_reviews', 'employee_disciplinary',
    'pto_policies', 'pto_balances', 'pto_transactions', 'departments',
```

- [ ] **Step 3: Add delete-safety for `departments` in `cleanupReferencesBeforeDelete`**

In `src/main/ipc/index.ts`, find the `case 'accounts':` block inside `cleanupReferencesBeforeDelete` (around line 972-980):

```ts
      case 'accounts':
        // Accounts can't be deleted if they have journal entries — block
        try {
          const lines = dbI.prepare(`SELECT COUNT(*) as c FROM journal_entry_lines WHERE account_id = ?`).get(id) as any;
          if (lines?.c > 0) {
            throw new Error(`Cannot delete account with ${lines.c} journal entry line(s). Use soft delete (mark inactive) instead.`);
          }
        } catch (e: any) { if (e.message?.includes('Cannot delete')) throw e; }
        break;
    }
```

Replace with (adds a new `case` before the closing `}`):

```ts
      case 'accounts':
        // Accounts can't be deleted if they have journal entries — block
        try {
          const lines = dbI.prepare(`SELECT COUNT(*) as c FROM journal_entry_lines WHERE account_id = ?`).get(id) as any;
          if (lines?.c > 0) {
            throw new Error(`Cannot delete account with ${lines.c} journal entry line(s). Use soft delete (mark inactive) instead.`);
          }
        } catch (e: any) { if (e.message?.includes('Cannot delete')) throw e; }
        break;
      case 'departments':
        // Departments can't be deleted while employees are still assigned — block
        try {
          const assigned = dbI.prepare(`SELECT COUNT(*) as c FROM employees WHERE department_id = ?`).get(id) as any;
          if (assigned?.c > 0) {
            throw new Error(`Cannot delete department with ${assigned.c} employee(s) assigned. Reassign them first.`);
          }
        } catch (e: any) { if (e.message?.includes('Cannot delete')) throw e; }
        break;
    }
```

- [ ] **Step 4: Verify the migration runs cleanly**

Run: `npm run build:main`
Expected: exits 0 with no TypeScript errors.

Then run: `npm run dev`, wait for the Electron window to open, and check the terminal/dev server output for `[migrations] non-idempotent error` warnings.
Expected: no warning mentioning `departments` or `manager_id`/`department_id`.

- [ ] **Step 5: Commit**

```bash
git add src/main/database/index.ts src/main/ipc/index.ts
git commit -m "$(cat <<'EOF'
feat(hr): add departments table and employee manager_id/department_id columns

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `hr:orgChart` and `hr:analytics` IPC handlers

**Files:**
- Modify: `src/main/ipc/index.ts` (insert after the `dashboard:cashflow` handler, which ends at line 4909 right before the `// ─── File Dialog ────────────────────────────────────────` comment)
- Modify: `src/renderer/lib/api.ts` (add wrappers after `dashboardCashflow`, line 92-93)

- [ ] **Step 1: Add the two handlers**

In `src/main/ipc/index.ts`, find (around line 4905-4910):

```ts
    return sorted.map(month => ({
      month,
      income: inflow.find((r: any) => r.month === month)?.total || 0,
      expenses: outflow.find((r: any) => r.month === month)?.total || 0,
    }));
  });

  // ─── File Dialog ────────────────────────────────────────
```

Replace with:

```ts
    return sorted.map(month => ({
      month,
      income: inflow.find((r: any) => r.month === month)?.total || 0,
      expenses: outflow.find((r: any) => r.month === month)?.total || 0,
    }));
  });

  // ─── HR: Org Chart ───────────────────────────────────────
  ipcMain.handle('hr:orgChart', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return [];
    const dbInstance = db.getDb();
    return dbInstance.prepare(
      `SELECT e.id, e.name, e.job_title, e.manager_id, e.department_id,
              mgr.name as manager_name,
              d.name as department_name
       FROM employees e
       LEFT JOIN employees mgr ON mgr.id = e.manager_id
       LEFT JOIN departments d ON d.id = e.department_id
       WHERE e.company_id = ? AND e.status = 'active'
       ORDER BY e.name`
    ).all(companyId);
  });

  // ─── HR: Headcount & Turnover Analytics ──────────────────
  ipcMain.handle('hr:analytics', (_event, { startDate, endDate }: { startDate: string; endDate: string }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    const dbInstance = db.getDb();

    const byDepartment = dbInstance.prepare(
      `SELECT COALESCE(d.name, 'Unassigned') as department_name, COUNT(*) as count
       FROM employees e
       LEFT JOIN departments d ON d.id = e.department_id
       WHERE e.company_id = ? AND e.status = 'active'
       GROUP BY department_name
       ORDER BY count DESC`
    ).all(companyId) as any[];

    const statusCounts = dbInstance.prepare(
      `SELECT status, COUNT(*) as count FROM employees WHERE company_id = ? GROUP BY status`
    ).all(companyId) as any[];
    const active = statusCounts.find(r => r.status === 'active')?.count || 0;
    const inactive = statusCounts.reduce((s, r) => (r.status !== 'active' ? s + r.count : s), 0);

    const newHires = dbInstance.prepare(
      `SELECT COUNT(*) as count FROM employees WHERE company_id = ? AND start_date >= ? AND start_date <= ?`
    ).get(companyId, startDate, endDate) as any;

    const departures = dbInstance.prepare(
      `SELECT COUNT(*) as count FROM employees WHERE company_id = ? AND end_date >= ? AND end_date <= ?`
    ).get(companyId, startDate, endDate) as any;

    const tenureRows = dbInstance.prepare(
      `SELECT start_date, end_date FROM employees WHERE company_id = ? AND start_date IS NOT NULL AND start_date != ''`
    ).all(companyId) as any[];
    const now = Date.now();
    let totalDays = 0;
    let counted = 0;
    for (const r of tenureRows) {
      const start = new Date(r.start_date).getTime();
      const end = r.end_date ? new Date(r.end_date).getTime() : now;
      if (!isNaN(start) && !isNaN(end) && end >= start) {
        totalDays += (end - start) / 86400000;
        counted++;
      }
    }
    const avgTenureDays = counted > 0 ? Math.round(totalDays / counted) : 0;

    return { byDepartment, active, inactive, newHires: newHires?.count || 0, departures: departures?.count || 0, avgTenureDays };
  });

  // ─── File Dialog ────────────────────────────────────────
```

- [ ] **Step 2: Add `api.ts` wrappers**

In `src/renderer/lib/api.ts`, find (lines 89-93):

```ts
  // Dashboard
  dashboardStats: (startDate: string, endDate: string) =>
    invoke('dashboard:stats', { startDate, endDate }),
  dashboardCashflow: (startDate: string, endDate: string) =>
    invoke('dashboard:cashflow', { startDate, endDate }),
```

Replace with:

```ts
  // Dashboard
  dashboardStats: (startDate: string, endDate: string) =>
    invoke('dashboard:stats', { startDate, endDate }),
  dashboardCashflow: (startDate: string, endDate: string) =>
    invoke('dashboard:cashflow', { startDate, endDate }),

  // Human Resources
  hrOrgChart: () => invoke('hr:orgChart'),
  hrAnalytics: (startDate: string, endDate: string) =>
    invoke('hr:analytics', { startDate, endDate }),
```

- [ ] **Step 3: Verify with typecheck**

Run: `npm run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/index.ts src/renderer/lib/api.ts
git commit -m "$(cat <<'EOF'
feat(hr): add hr:orgChart and hr:analytics IPC handlers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `EmployeeForm.tsx` — Department (Org) select + Manager select

**Files:**
- Modify: `src/renderer/modules/payroll/EmployeeForm.tsx`

The existing `department` (free-text enum via `ClassificationSelect`) and `job_title` fields are left untouched. This task adds two *new* fields: `department_id` (a real FK to the new `departments` table) and `manager_id`.

- [ ] **Step 1: Add `department_id`/`manager_id` to `EmployeeFormData` and `EMPTY_FORM`**

In `src/renderer/modules/payroll/EmployeeForm.tsx`, find (around line 40-43):

```ts
  department: string;
  job_title: string;
  role: string;
  work_location: string;
```

Replace with:

```ts
  department: string;
  department_id: string;
  manager_id: string;
  job_title: string;
  role: string;
  work_location: string;
```

Then find the matching spot in `EMPTY_FORM` (around line 89-91):

```ts
  department: '',
  job_title: '',
  role: '',
```

Replace with:

```ts
  department: '',
  department_id: '',
  manager_id: '',
  job_title: '',
  role: '',
```

- [ ] **Step 2: Add state + load effect for the departments list and active employees list**

In `src/renderer/modules/payroll/EmployeeForm.tsx`, find the top of the component body right after `const isEditing = Boolean(employeeId);` (around line 1594-1595):

```tsx
  const isEditing = Boolean(employeeId);
```

Replace with:

```tsx
  const isEditing = Boolean(employeeId);

  // ─── Departments + managers (for the Org fields) ────
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([]);
  const [managerOptions, setManagerOptions] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [depts, emps] = await Promise.all([
        api.query('departments', {}, { field: 'name', dir: 'asc' }),
        api.query('employees', { status: 'active' }, { field: 'name', dir: 'asc' }),
      ]);
      if (!cancelled) {
        setDepartments(Array.isArray(depts) ? depts : []);
        setManagerOptions(Array.isArray(emps) ? emps.filter((e: any) => e.id !== employeeId) : []);
      }
    })();
    return () => { cancelled = true; };
  }, [employeeId]);
```

(This relies on `useState`/`useEffect`, already imported at the top of the file.)

- [ ] **Step 3: Hydrate the two new fields when editing**

In `src/renderer/modules/payroll/EmployeeForm.tsx`, find (around line 1636-1638):

```tsx
            department: emp.department ?? '',
            job_title: emp.job_title ?? '',
            role: emp.role ?? '',
```

Replace with:

```tsx
            department: emp.department ?? '',
            department_id: emp.department_id ?? '',
            manager_id: emp.manager_id ?? '',
            job_title: emp.job_title ?? '',
            role: emp.role ?? '',
```

- [ ] **Step 4: Include the two fields in the save payload**

In `src/renderer/modules/payroll/EmployeeForm.tsx`, find (around line 1760-1763):

```tsx
        department: form.department.trim(),
        job_title: form.job_title.trim(),
        role: form.role || '',
```

Replace with:

```tsx
        department: form.department.trim(),
        department_id: form.department_id || '',
        manager_id: form.manager_id || '',
        job_title: form.job_title.trim(),
        role: form.role || '',
```

- [ ] **Step 5: Render the two new fields in the form**

In `src/renderer/modules/payroll/EmployeeForm.tsx`, find (around line 2205-2210):

```tsx
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Department</label>
              <ClassificationSelect def={EMPLOYEE_DEPARTMENT} value={form.department} onChange={(v) => setForm(p => ({ ...p, department: v }))} />
            </div>
```

Replace with:

```tsx
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Department</label>
              <ClassificationSelect def={EMPLOYEE_DEPARTMENT} value={form.department} onChange={(v) => setForm(p => ({ ...p, department: v }))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Department (Org Chart)</label>
              <select className="block-select w-full" value={form.department_id} onChange={(e) => setForm(p => ({ ...p, department_id: e.target.value }))}>
                <option value="">No department</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Manager</label>
              <select className="block-select w-full" value={form.manager_id} onChange={(e) => setForm(p => ({ ...p, manager_id: e.target.value }))}>
                <option value="">No manager</option>
                {managerOptions.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
```

- [ ] **Step 6: Verify with typecheck**

Run: `npm run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 7: Manual verification**

Run: `npm run dev`. Open Human Resources → Directory (still labeled "Employees" tab-wise until Task 8) → open an existing employee. Confirm the two new selects render, "No department"/"No manager" are the defaults, and saving persists the choice (reopen the same employee and confirm the selection stuck). Confirm the employee's own name is excluded from the Manager dropdown.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/modules/payroll/EmployeeForm.tsx
git commit -m "$(cat <<'EOF'
feat(hr): add department_id and manager_id fields to employee form

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `EmployeeList.tsx` (Directory) — department/manager filters + columns

**Files:**
- Modify: `src/renderer/modules/payroll/EmployeeList.tsx`

- [ ] **Step 1: Extend the `Employee` interface and add filter state**

In `src/renderer/modules/payroll/EmployeeList.tsx`, find (lines 14-26):

```ts
interface Employee {
  id: string;
  name: string;
  email: string;
  type: 'employee' | 'contractor';
  pay_type: 'salary' | 'hourly';
  pay_rate: number;
  pay_schedule: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
  status: string;
  role?: string;
  department?: string;
  work_location?: string;
  cost_class?: string;
}
```

Replace with:

```ts
interface Employee {
  id: string;
  name: string;
  email: string;
  type: 'employee' | 'contractor';
  pay_type: 'salary' | 'hourly';
  pay_rate: number;
  pay_schedule: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
  status: string;
  role?: string;
  department?: string;
  department_id?: string;
  manager_id?: string;
  work_location?: string;
  cost_class?: string;
}
```

- [ ] **Step 2: Add department/manager filter state and load department + manager-name lookups**

In `src/renderer/modules/payroll/EmployeeList.tsx`, find (lines 91-96):

```ts
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
```

Replace with:

```ts
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  const [managerFilter, setManagerFilter] = useState<string>('all');
  const [departmentOptions, setDepartmentOptions] = useState<Array<{ id: string; name: string }>>([]);
```

Then find the load effect's department-independent data fetch — right after the `const load = async () => {` block that queries `employees` (around line 105-108):

```ts
        const rows = await api.query('employees', { company_id: activeCompany.id }, { field: 'name', dir: 'asc' });
        if (!cancelled) {
          setEmployees(Array.isArray(rows) ? rows : []);
        }
```

Replace with:

```ts
        const rows = await api.query('employees', { company_id: activeCompany.id }, { field: 'name', dir: 'asc' });
        if (!cancelled) {
          setEmployees(Array.isArray(rows) ? rows : []);
        }
        api.query('departments', { company_id: activeCompany.id }, { field: 'name', dir: 'asc' }).then((depts) => {
          if (!cancelled) setDepartmentOptions(Array.isArray(depts) ? depts : []);
        }).catch(() => {});
```

- [ ] **Step 3: Apply the new filters in `filtered`**

In `src/renderer/modules/payroll/EmployeeList.tsx`, find (lines 161-163):

```ts
    if (statusFilter !== 'all') {
      list = list.filter((e) => e.status === statusFilter);
    }
```

Replace with:

```ts
    if (statusFilter !== 'all') {
      list = list.filter((e) => e.status === statusFilter);
    }

    if (departmentFilter !== 'all') {
      list = list.filter((e) => (e.department_id || '') === departmentFilter);
    }

    if (managerFilter !== 'all') {
      list = list.filter((e) => (e.manager_id || '') === managerFilter);
    }
```

And update the `useMemo` dependency array at line 183:

```ts
  }, [employees, typeFilter, statusFilter, searchQuery, sortField, sortDir]);
```

Replace with:

```ts
  }, [employees, typeFilter, statusFilter, departmentFilter, managerFilter, searchQuery, sortField, sortDir]);
```

- [ ] **Step 4: Add the two new filter dropdowns to the toolbar**

In `src/renderer/modules/payroll/EmployeeList.tsx`, find (lines 417-427):

```tsx
        <div className="relative inline-flex items-center gap-1.5">
          <select
            className="block-select"
            style={{ width: 'auto', minWidth: '120px' }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
```

Replace with:

```tsx
        <div className="relative inline-flex items-center gap-1.5">
          <select
            className="block-select"
            style={{ width: 'auto', minWidth: '120px' }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div className="relative inline-flex items-center gap-1.5">
          <select
            className="block-select"
            style={{ width: 'auto', minWidth: '140px' }}
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
          >
            <option value="all">All Departments</option>
            {departmentOptions.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div className="relative inline-flex items-center gap-1.5">
          <select
            className="block-select"
            style={{ width: 'auto', minWidth: '140px' }}
            value={managerFilter}
            onChange={(e) => setManagerFilter(e.target.value)}
          >
            <option value="all">All Managers</option>
            {employees.filter((e) => employees.some((sub) => sub.manager_id === e.id)).map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
```

- [ ] **Step 5: Add a Manager column to the table**

In `src/renderer/modules/payroll/EmployeeList.tsx`, find the header row (around line 516-519):

```tsx
                {cEmpCol('payroll-col-job-title') && <th>Role</th>}
                {cEmpCol('payroll-col-department') && <th>Dept.</th>}
                {cEmpCol('payroll-col-location') && <th>Location</th>}
                <th>Cost Class</th>
```

Replace with:

```tsx
                {cEmpCol('payroll-col-job-title') && <th>Role</th>}
                {cEmpCol('payroll-col-department') && <th>Dept.</th>}
                <th>Manager</th>
                {cEmpCol('payroll-col-location') && <th>Location</th>}
                <th>Cost Class</th>
```

Then find the matching row-rendering (around line 566-569):

```tsx
                  {cEmpCol('payroll-col-job-title') && <td><ClassificationBadge def={EMPLOYEE_ROLE} value={emp.role} /></td>}
                  {cEmpCol('payroll-col-department') && <td><ClassificationBadge def={EMPLOYEE_DEPARTMENT} value={emp.department} /></td>}
                  {cEmpCol('payroll-col-location') && <td><ClassificationBadge def={EMPLOYEE_WORK_LOCATION} value={emp.work_location} /></td>}
```

Replace with:

```tsx
                  {cEmpCol('payroll-col-job-title') && <td><ClassificationBadge def={EMPLOYEE_ROLE} value={emp.role} /></td>}
                  {cEmpCol('payroll-col-department') && <td><ClassificationBadge def={EMPLOYEE_DEPARTMENT} value={emp.department} /></td>}
                  <td className="text-text-secondary text-xs">{employees.find((m) => m.id === emp.manager_id)?.name ?? '--'}</td>
                  {cEmpCol('payroll-col-location') && <td><ClassificationBadge def={EMPLOYEE_WORK_LOCATION} value={emp.work_location} /></td>}
```

- [ ] **Step 6: Verify with typecheck**

Run: `npm run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 7: Manual verification**

Run: `npm run dev`. In the Directory tab, assign a couple of employees a department and a manager (via Task 3's form fields), then confirm: the Department and Manager filter dropdowns populate, filtering by each narrows the list correctly, and the Manager column shows the correct name.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/modules/payroll/EmployeeList.tsx
git commit -m "$(cat <<'EOF'
feat(hr): add department/manager filters and manager column to directory

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `OrgChart.tsx` — new component

**Files:**
- Create: `src/renderer/modules/payroll/OrgChart.tsx`

- [ ] **Step 1: Write the component**

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { Network, Users } from 'lucide-react';
import api from '../../lib/api';

interface OrgEmployee {
  id: string;
  name: string;
  job_title: string;
  manager_id: string | null;
  manager_name: string | null;
  department_id: string | null;
  department_name: string | null;
}

interface OrgNode extends OrgEmployee {
  children: OrgNode[];
}

function buildTree(employees: OrgEmployee[]): OrgNode[] {
  const byId = new Map<string, OrgNode>();
  for (const e of employees) byId.set(e.id, { ...e, children: [] });

  const roots: OrgNode[] = [];
  for (const e of employees) {
    const node = byId.get(e.id)!;
    if (e.manager_id && byId.has(e.manager_id)) {
      byId.get(e.manager_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

const OrgChartNode: React.FC<{ node: OrgNode; onSelect: (id: string) => void; depth: number }> = ({ node, onSelect, depth }) => (
  <div style={{ marginLeft: depth === 0 ? 0 : 20 }}>
    <button
      className="block-card p-2.5 flex items-center gap-2 w-full text-left hover:border-accent-blue transition-colors"
      style={{ borderRadius: '6px' }}
      onClick={() => onSelect(node.id)}
    >
      <Users size={14} className="text-accent-blue shrink-0" />
      <div className="min-w-0">
        <div className="text-xs font-semibold text-text-primary truncate">{node.name}</div>
        <div className="text-[10px] text-text-muted truncate">
          {node.job_title || 'No title'}{node.department_name ? ` · ${node.department_name}` : ''}
        </div>
      </div>
    </button>
    {node.children.length > 0 && (
      <div className="mt-2 space-y-2 border-l border-border-secondary pl-3">
        {node.children.map((child) => (
          <OrgChartNode key={child.id} node={child} onSelect={onSelect} depth={depth + 1} />
        ))}
      </div>
    )}
  </div>
);

interface OrgChartProps {
  onSelectEmployee: (id: string) => void;
}

const OrgChart: React.FC<OrgChartProps> = ({ onSelectEmployee }) => {
  const [employees, setEmployees] = useState<OrgEmployee[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.hrOrgChart().then((rows: any) => {
      if (!cancelled) setEmployees(Array.isArray(rows) ? rows : []);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const tree = useMemo(() => buildTree(employees), [employees]);

  if (loading) {
    return <div className="p-6 text-xs font-mono text-text-muted">Loading org chart...</div>;
  }

  if (employees.length === 0) {
    return (
      <div className="p-6 flex flex-col items-center gap-2 text-text-muted">
        <Network size={24} />
        <span className="text-xs">No active employees to display.</span>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-3 overflow-auto">
      {tree.map((root) => (
        <OrgChartNode key={root.id} node={root} onSelect={onSelectEmployee} depth={0} />
      ))}
    </div>
  );
};

export default OrgChart;
```

- [ ] **Step 2: Verify with typecheck**

Run: `npm run typecheck`
Expected: exits 0, no errors (this file isn't wired into the module yet — Task 8 wires it up — so this just confirms the file compiles standalone).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/payroll/OrgChart.tsx
git commit -m "$(cat <<'EOF'
feat(hr): add OrgChart component (recursive manager-hierarchy tree)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `DepartmentsManager.tsx` — new component

> **Amendment:** the original version of this task assumed `departments` was a brand-new table with a `head_employee_id` column. Task 1's review turned up a pre-existing `departments` table (from an earlier "F228" cost-accounting batch) with a different real schema: `id, company_id, code (NOT NULL, UNIQUE per company), name, manager_id (the department head), parent_id, description, is_active, created_at, updated_at`. The code below is corrected to match that real schema — it collects a required, unique `code` on create and reads/writes `manager_id` (not `head_employee_id`) for the department head.

**Files:**
- Create: `src/renderer/modules/payroll/DepartmentsManager.tsx`

- [ ] **Step 1: Write the component**

```tsx
import React, { useEffect, useState } from 'react';
import { Building2, Plus, Trash2, Pencil, X, Check } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import ErrorBanner from '../../components/ErrorBanner';

interface Department {
  id: string;
  code: string;
  name: string;
  manager_id: string;
}

interface EmployeeOption {
  id: string;
  name: string;
}

const DepartmentsManager: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState('');
  const [editName, setEditName] = useState('');
  const [editManager, setEditManager] = useState('');

  const load = async () => {
    if (!activeCompany) return;
    setLoading(true);
    setError('');
    try {
      const [depts, emps] = await Promise.all([
        api.query('departments', { company_id: activeCompany.id }, { field: 'name', dir: 'asc' }),
        api.query('employees', { company_id: activeCompany.id, status: 'active' }, { field: 'name', dir: 'asc' }),
      ]);
      setDepartments(Array.isArray(depts) ? depts : []);
      setEmployees(Array.isArray(emps) ? emps : []);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [activeCompany?.id]);

  const handleCreate = async () => {
    if (!newCode.trim() || !newName.trim()) return;
    try {
      const result = await api.create('departments', { code: newCode.trim(), name: newName.trim(), manager_id: '' });
      if (result && (result as any).error) {
        setError((result as any).error);
        return;
      }
      setNewCode('');
      setNewName('');
      await load();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    }
  };

  const startEdit = (d: Department) => {
    setEditingId(d.id);
    setEditCode(d.code);
    setEditName(d.name);
    setEditManager(d.manager_id || '');
  };

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      const result = await api.update('departments', editingId, { code: editCode.trim(), name: editName.trim(), manager_id: editManager });
      if (result && (result as any).error) {
        setError((result as any).error);
        return;
      }
      setEditingId(null);
      await load();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const result = await api.remove('departments', id);
      if (result && (result as any).error) {
        setError((result as any).error);
        return;
      }
      await load();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    }
  };

  if (loading) {
    return <div className="p-6 text-xs font-mono text-text-muted">Loading departments...</div>;
  }

  return (
    <div className="p-6 space-y-4">
      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}

      <div className="flex items-center gap-2">
        <input
          className="block-input"
          style={{ width: '140px' }}
          placeholder="Code (e.g. ENG)"
          value={newCode}
          onChange={(e) => setNewCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
        />
        <input
          className="block-input flex-1"
          placeholder="New department name..."
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
        />
        <button className="block-btn block-btn-primary inline-flex items-center gap-1.5" onClick={handleCreate}>
          <Plus size={14} /> Add Department
        </button>
      </div>

      <div className="block-table-wrap">
        <table className="block-table w-full">
          <thead>
            <tr>
              <th>Code</th>
              <th>Department</th>
              <th>Head</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {departments.map((d) => (
              <tr key={d.id}>
                {editingId === d.id ? (
                  <>
                    <td>
                      <input className="block-input w-full" value={editCode} onChange={(e) => setEditCode(e.target.value)} />
                    </td>
                    <td>
                      <input className="block-input w-full" value={editName} onChange={(e) => setEditName(e.target.value)} />
                    </td>
                    <td>
                      <select className="block-select w-full" value={editManager} onChange={(e) => setEditManager(e.target.value)}>
                        <option value="">No head assigned</option>
                        {employees.map((e) => (
                          <option key={e.id} value={e.id}>{e.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="text-right">
                      <button className="text-accent-income mr-2" onClick={saveEdit}><Check size={14} /></button>
                      <button className="text-text-muted" onClick={() => setEditingId(null)}><X size={14} /></button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="text-text-secondary text-xs font-mono">{d.code}</td>
                    <td className="flex items-center gap-2">
                      <Building2 size={14} className="text-accent-blue shrink-0" />
                      <span className="text-text-primary font-medium">{d.name}</span>
                    </td>
                    <td className="text-text-secondary text-xs">
                      {employees.find((e) => e.id === d.manager_id)?.name ?? '--'}
                    </td>
                    <td className="text-right">
                      <button className="text-text-muted hover:text-text-primary mr-2" onClick={() => startEdit(d)}><Pencil size={14} /></button>
                      <button className="text-text-muted hover:text-accent-expense" onClick={() => handleDelete(d.id)}><Trash2 size={14} /></button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {departments.length === 0 && (
        <div className="text-xs text-text-muted">No departments yet. Add one above.</div>
      )}
    </div>
  );
};

export default DepartmentsManager;
```

- [ ] **Step 2: Verify with typecheck**

Run: `npm run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/payroll/DepartmentsManager.tsx
git commit -m "$(cat <<'EOF'
feat(hr): add DepartmentsManager component (CRUD list + head assignment)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `HrAnalytics.tsx` — new component

**Files:**
- Create: `src/renderer/modules/payroll/HrAnalytics.tsx`

- [ ] **Step 1: Write the component**

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';
import api from '../../lib/api';

interface HrAnalyticsData {
  byDepartment: Array<{ department_name: string; count: number }>;
  active: number;
  inactive: number;
  newHires: number;
  departures: number;
  avgTenureDays: number;
}

function startOfYear(): string {
  return `${new Date().getFullYear()}-01-01`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const StatTile: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="block-card p-4" style={{ borderRadius: 'var(--app-radius)' }}>
    <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1">{label}</div>
    <div className="text-lg font-bold text-text-primary">{value}</div>
  </div>
);

const HrAnalytics: React.FC = () => {
  const [data, setData] = useState<HrAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState(startOfYear());
  const [endDate, setEndDate] = useState(today());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.hrAnalytics(startDate, endDate).then((result: any) => {
      if (!cancelled) setData(result);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [startDate, endDate]);

  const turnoverRate = useMemo(() => {
    if (!data) return 0;
    const total = data.active + data.inactive;
    return total > 0 ? Math.round((data.departures / total) * 1000) / 10 : 0;
  }, [data]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <label className="text-xs text-text-muted">From</label>
        <input type="date" className="block-input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <label className="text-xs text-text-muted">To</label>
        <input type="date" className="block-input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </div>

      {loading || !data ? (
        <div className="text-xs font-mono text-text-muted">Loading analytics...</div>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-3">
            <StatTile label="Active Employees" value={String(data.active)} />
            <StatTile label="New Hires (range)" value={String(data.newHires)} />
            <StatTile label="Departures (range)" value={String(data.departures)} />
            <StatTile label="Avg. Tenure" value={`${Math.round(data.avgTenureDays / 30.44)} mo`} />
          </div>

          <div className="block-card p-4" style={{ borderRadius: 'var(--app-radius)' }}>
            <div className="text-xs font-semibold text-text-primary mb-3">Headcount by Department</div>
            <div style={{ width: '100%', height: 240 }}>
              <ResponsiveContainer>
                <BarChart data={data.byDepartment}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="department_name" stroke="var(--color-text-muted)" fontSize={11} />
                  <YAxis stroke="var(--color-text-muted)" fontSize={11} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--color-bg-elevated)',
                      border: '1px solid var(--color-border-primary)',
                      borderRadius: '6px',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="count" fill="var(--color-accent-blue)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="text-xs text-text-muted">
            Turnover rate (departures ÷ total employees, selected range): <span className="text-text-primary font-semibold">{turnoverRate}%</span>
          </div>
        </>
      )}
    </div>
  );
};

export default HrAnalytics;
```

- [ ] **Step 2: Verify with typecheck**

Run: `npm run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/payroll/HrAnalytics.tsx
git commit -m "$(cat <<'EOF'
feat(hr): add HrAnalytics component (headcount + turnover dashboard)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Wire the three new tabs into `payroll/index.tsx`

**Files:**
- Modify: `src/renderer/modules/payroll/index.tsx`

- [ ] **Step 1: Import the new components and extend the `Tab` type**

Find (lines 1-19):

```tsx
import React, { useEffect, useState, useCallback } from 'react';
import {
  Users, DollarSign, FileText, Calculator, Plus, Trash2, Printer,
  LayoutDashboard, ChevronDown, ChevronRight, Download, TrendingUp, Clock, ArrowRight, Eye, Edit,
} from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { useAppStore } from '../../stores/appStore';
import EmployeeList from './EmployeeList';
import EmployeeForm from './EmployeeForm';
import PayrollRunner from './PayrollRunner';
import PayStubView from './PayStubView';
import PtoDashboard from './PtoDashboard';
import HrPortal from './HrPortal';
import ErrorBanner from '../../components/ErrorBanner';
import { formatDate } from '../../lib/format';

// ─── Types ──────────────────────────────────────────────
type Tab = 'summary' | 'employees' | 'run' | 'history' | 'pto' | 'hr-portal';
```

Replace with:

```tsx
import React, { useEffect, useState, useCallback } from 'react';
import {
  Users, DollarSign, FileText, Calculator, Plus, Trash2, Printer,
  LayoutDashboard, ChevronDown, ChevronRight, Download, TrendingUp, Clock, ArrowRight, Eye, Edit,
  Network, Building2, BarChart3,
} from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { useAppStore } from '../../stores/appStore';
import EmployeeList from './EmployeeList';
import EmployeeForm from './EmployeeForm';
import PayrollRunner from './PayrollRunner';
import PayStubView from './PayStubView';
import PtoDashboard from './PtoDashboard';
import HrPortal from './HrPortal';
import OrgChart from './OrgChart';
import DepartmentsManager from './DepartmentsManager';
import HrAnalytics from './HrAnalytics';
import ErrorBanner from '../../components/ErrorBanner';
import { formatDate } from '../../lib/format';

// ─── Types ──────────────────────────────────────────────
type Tab = 'summary' | 'employees' | 'run' | 'history' | 'pto' | 'hr-portal' | 'org-chart' | 'departments' | 'analytics';
```

- [ ] **Step 2: Add the three tabs to the `tabs` array and relabel the Employees tab**

Find (lines 547-554):

```tsx
  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'summary', label: 'Dashboard', icon: <LayoutDashboard size={14} /> },
    { key: 'employees', label: 'Employees', icon: <Users size={14} /> },
    { key: 'run', label: 'Run Payroll', icon: <Calculator size={14} /> },
    { key: 'history', label: 'History', icon: <FileText size={14} /> },
    { key: 'pto', label: 'PTO', icon: <DollarSign size={14} /> },
    { key: 'hr-portal', label: 'HR Portal', icon: <Users size={14} /> },
  ];
```

Replace with:

```tsx
  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'summary', label: 'Dashboard', icon: <LayoutDashboard size={14} /> },
    { key: 'employees', label: 'Directory', icon: <Users size={14} /> },
    { key: 'org-chart', label: 'Org Chart', icon: <Network size={14} /> },
    { key: 'departments', label: 'Departments', icon: <Building2 size={14} /> },
    { key: 'analytics', label: 'Analytics', icon: <BarChart3 size={14} /> },
    { key: 'run', label: 'Run Payroll', icon: <Calculator size={14} /> },
    { key: 'history', label: 'History', icon: <FileText size={14} /> },
    { key: 'pto', label: 'PTO', icon: <DollarSign size={14} /> },
    { key: 'hr-portal', label: 'HR Portal', icon: <Users size={14} /> },
  ];
```

- [ ] **Step 3: Relabel the module header from "Payroll" to "Human Resources"**

Find (lines 562-564):

```tsx
          <Users size={20} className="text-accent-blue" />
          <h1 className="text-base font-bold text-text-primary">Payroll</h1>
        </div>
```

Replace with:

```tsx
          <Users size={20} className="text-accent-blue" />
          <h1 className="text-base font-bold text-text-primary">Human Resources</h1>
        </div>
```

- [ ] **Step 4: Render the three new tabs' content**

Find (lines 746-757):

```tsx
        {/* Employees Tab */}
        {activeTab === 'employees' && (
          <EmployeeList
            key={employeeListKey}
            onSelectEmployee={handleSelectEmployee}
            onNewEmployee={handleNewEmployee}
          />
        )}

        {/* PTO Tab */}
        {activeTab === 'pto' && <PtoDashboard />}
        {activeTab === 'hr-portal' && <HrPortal />}
```

Replace with:

```tsx
        {/* Employees Tab */}
        {activeTab === 'employees' && (
          <EmployeeList
            key={employeeListKey}
            onSelectEmployee={handleSelectEmployee}
            onNewEmployee={handleNewEmployee}
          />
        )}

        {/* Org Chart Tab */}
        {activeTab === 'org-chart' && <OrgChart onSelectEmployee={handleSelectEmployee} />}

        {/* Departments Tab */}
        {activeTab === 'departments' && <DepartmentsManager />}

        {/* Analytics Tab */}
        {activeTab === 'analytics' && <HrAnalytics />}

        {/* PTO Tab */}
        {activeTab === 'pto' && <PtoDashboard />}
        {activeTab === 'hr-portal' && <HrPortal />}
```

`handleSelectEmployee` already exists in this file (it's passed to `EmployeeList` above) and switches the view to the employee detail/edit screen, so passing it into `OrgChart` reuses the exact same navigation.

- [ ] **Step 5: Verify with typecheck**

Run: `npm run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`. Navigate to the module (sidebar entry still says "Employee" until Task 9). Confirm all 8 tabs render in the tab bar in order (Dashboard, Directory, Org Chart, Departments, Analytics, Run Payroll, History, PTO, HR Portal), the header now reads "Human Resources", clicking Org Chart shows the tree (create a manager relationship first via Task 3 if the list is flat), clicking Departments shows the CRUD list from Task 6, and clicking Analytics shows the stat tiles + bar chart from Task 7.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/modules/payroll/index.tsx
git commit -m "$(cat <<'EOF'
feat(hr): wire Org Chart, Departments, Analytics tabs into HR module

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Rebrand navigation — Sidebar label + `MODULE_NAMES`

**Files:**
- Modify: `src/renderer/components/layout/Sidebar.tsx:77`
- Modify: `src/renderer/App.tsx:63`

- [ ] **Step 1: Relabel the sidebar entry**

In `src/renderer/components/layout/Sidebar.tsx`, find (line 77):

```tsx
      { id: 'payroll', label: 'Employee', icon: Users },
```

Replace with:

```tsx
      { id: 'payroll', label: 'Human Resources', icon: Users },
```

- [ ] **Step 2: Update `MODULE_NAMES`**

In `src/renderer/App.tsx`, find (line 63):

```ts
  payroll: 'Payroll',
```

Replace with:

```ts
  payroll: 'Human Resources',
```

The routing `id: 'payroll'` and the `payroll: 'employees'` CSV-export table mapping (`App.tsx` around line 259) are both left unchanged — they're internal keys, not user-facing labels, and changing them isn't required for this batch (per the approved design's decision to keep `id: 'payroll'` stable).

- [ ] **Step 3: Verify with typecheck**

Run: `npm run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`. Confirm the sidebar's OPERATIONS section now shows "Human Resources" instead of "Employee", clicking it opens the same module as before, and the top-of-page module title (wherever `MODULE_NAMES` is rendered, e.g. breadcrumb/header) now reads "Human Resources".

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/layout/Sidebar.tsx src/renderer/App.tsx
git commit -m "$(cat <<'EOF'
feat(hr): rebrand Employee module as Human Resources in nav

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Full manual regression pass

**Files:** none (verification only)

- [ ] **Step 1: Full click-through**

Run: `npm run dev`. Perform, in order:
1. Open Human Resources → Directory. Create a new employee with a Department (Org Chart), Manager, and Job Title set.
2. Edit an existing employee to report to the one just created.
3. Open Org Chart — confirm the new hierarchy renders with the correct parent/child nesting, and clicking a node navigates to that employee's edit form.
4. Open Departments — create a department, assign a head, edit its name, then attempt to delete a department that still has an employee assigned to it (via `department_id`) and confirm the error message appears and the delete is blocked. Reassign the employee to "No department" and confirm the delete now succeeds.
5. Open Analytics — confirm the stat tiles and bar chart render with real numbers matching what you just created (e.g. "Active Employees" count, one bar per department used above), and that changing the date range updates New Hires/Departures.
6. Confirm the existing Run Payroll / History / PTO / HR Portal tabs still work unmodified (open each, confirm no console errors).

- [ ] **Step 2: Run typecheck one final time**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Run the UI leak-check script**

Run: `bash scripts/ui-leak-check.sh`
Expected: no new hard-coded hex / blocky-radius / white-leak hits introduced by the files touched in this plan (`OrgChart.tsx`, `DepartmentsManager.tsx`, `HrAnalytics.tsx`, `EmployeeForm.tsx`, `EmployeeList.tsx`, `payroll/index.tsx`).

No commit for this task — it's a verification-only pass. If any issue is found, fix it in the relevant task's files and re-run this task's steps.
