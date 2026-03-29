# Business Accounting Pro — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a 27-module cross-platform desktop accounting application using Electron + React + SQLite with a blocky dark-theme UI.

**Architecture:** Electron main process handles all data (SQLite, PDF, email, backup) via typed IPC channels. React renderer provides the UI with Zustand state, Tailwind CSS dark theme, and Recharts visualization. An embedded Express server powers the client portal, mobile companion, and REST API.

**Tech Stack:** Electron 28+, React 18, TypeScript, Tailwind CSS, Zustand, better-sqlite3, Recharts, Express.js, Nodemailer, react-pdf/renderer, electron-builder

---

## Phase 1: Foundation (Tasks 1-6)

### Task 1: Project Scaffold and Electron + React Setup
- Initialize npm project, install all dependencies
- Create tsconfig.json, vite.config.ts, tailwind.config.js, postcss.config.js
- Create Electron main process (src/main/main.ts) with BrowserWindow
- Create preload script (src/main/preload.ts) with contextBridge
- Create React entry point (src/renderer/index.tsx, App.tsx)
- Create globals.css with blocky dark theme design system (2px border-radius, sharp corners, block-card/block-btn/block-input component classes)
- Create electron-builder.yml for Mac/Windows packaging
- Verify app launches with dark background and blocky styling

### Task 2: Database Layer — SQLite Schema and Data Access
- Create shared types (src/shared/types.ts) for all 23+ entity types
- Create SQL schema (src/main/database/schema.sql) with 23 tables including accounts, journal entries, clients, invoices, expenses, employees, payroll, time entries, projects, tax categories, budgets, inventory, bank accounts, documents, recurring templates, audit log, notifications, stripe transactions, email log, custom field definitions, saved views, settings
- Create database module (src/main/database/index.ts) with init, switchCompany, generic CRUD (queryAll, getById, create, update, remove), audit logging, and default chart of accounts seeder
- All indexes for performance

### Task 3: IPC Bridge — Connect Renderer to Main Process
- Create IPC handlers (src/main/ipc/index.ts) for generic CRUD, company management, global search, notifications
- Create renderer API client (src/renderer/lib/api.ts)
- Wire up database init and IPC registration in main.ts

### Task 4: Zustand State Management
- Create app store (currentModule, sidebar state, search, notifications)
- Create company store (companies list, active company)

### Task 5: App Shell — Sidebar Navigation + Layout
- Sidebar with 27 module nav items grouped into 6 sections (Main, Operations, Finance, Analytics, Platform, System)
- TopBar with company selector, global search (Cmd+K), notifications bell
- StatusBar with fiscal year and company name
- AppShell layout component combining all three
- Blocky styling throughout (lucide-react icons, 2px radius)

### Task 6: Company Onboarding Flow
- CompanySetup form shown when no companies exist
- Company creation with name, legal name, email, phone, address, tax ID, fiscal year
- Auto-creates default chart of accounts on company creation
- Switches to main app after creation

---

## Phase 2: Core Accounting Modules (Tasks 7-14)

### Task 7: Dashboard Module
- StatCard component (revenue, expenses, net income, outstanding invoices)
- CashFlowChart (Recharts line chart, money in vs out over time)
- UpcomingItems list (overdue invoices, bills due, upcoming payroll)
- QuickActions bar (New Invoice, Record Expense, Start Timer, Run Payroll)
- MTD/QTD/YTD toggle for all metrics
- Data aggregated from invoices, expenses, payroll tables

### Task 8: Chart of Accounts and General Ledger
- AccountsList (hierarchical tree grouped by type: Asset, Liability, Equity, Revenue, Expense)
- AccountForm (create/edit with code, name, type, subtype, parent)
- JournalEntries list (date, number, description, debit/credit totals, posted status)
- JournalEntryForm (multi-line items that must balance debits = credits)
- AccountDetail (transaction list for a single account)

### Task 9: Client Management (CRM)
- ClientList (search, filter by status, sort, grid/table view)
- ClientForm (contact details, billing address, payment terms, custom fields)
- ClientDetail (full history: invoices, payments, projects, time entries, documents)
- Client notes, tags, status management (active/inactive/prospect)

### Task 10: Income and Invoicing
- InvoiceList (status badges: draft/sent/paid/overdue, search, filters)
- InvoiceForm (client picker, line items with qty/rate/amount, auto-calculate totals, tax, discount)
- InvoiceDetail (view with payment history, send actions)
- InvoicePDF (react-pdf/renderer template with company branding)
- PaymentRecorder (record full or partial payments, auto-update invoice status)
- PDF generation service in main process
- Auto-overdue detection on app start

### Task 11: Expenses and Bills
- ExpenseList (category grouping, receipt thumbnails, search/filter)
- ExpenseForm (amount, date, category, vendor, receipt file attachment, billable flag, project link)
- VendorList and VendorForm (vendor management)
- MileageTracker (date, miles, purpose, IRS rate calculation)
- Receipt file storage in app userData directory

### Task 12: Time Tracking
- TimerWidget (start/stop with live counter, client/project selector)
- TimeEntryList (grouped by day, client/project columns, billable indicator)
- TimeEntryForm (manual entry: date, hours, client, project, description, rate)
- WeeklySummary (hours by day bar chart, billable vs non-billable pie chart)
- Convert to Invoice action (select time entries, create invoice with line items)

### Task 13: Projects and Job Costing
- ProjectList (status cards: active/completed/on-hold, budget progress bars)
- ProjectForm (name, client, budget type, hourly rate, dates)
- ProjectDetail (income from invoices, expenses, time entries, profitability calculation)
- ProfitabilityChart (Recharts bar chart comparing projects)
- Budget utilization tracking

### Task 14: Payroll
- EmployeeList (employees and contractors, pay type, status)
- EmployeeForm (name, type, pay rate, schedule, tax filing status, allowances)
- PayrollRunner (select pay period, calculate for each employee, review, process)
- PayrollCalculator service (federal tax brackets, FICA 6.2%, Medicare 1.45%, state approximation)
- PayStubView and PayStubPDF (gross, taxes, deductions, net, YTD totals)
- 1099/W-2 data summary export

---

## Phase 3: Financial Modules (Tasks 15-19)

### Task 15: Tax Management
- Quarterly estimated tax calculator (based on YTD income)
- Tax category list (mapped to Schedule C lines)
- Tax payment tracking (federal/state estimated, annual)
- Tax liability dashboard
- CPA export (CSV with categorized income/expenses)

### Task 16: Budget Management
- Budget creation (name, period, date range)
- Budget line items (linked to accounts/categories, monthly amounts)
- Budget vs Actual comparison chart (Recharts grouped bar)
- Threshold alerts (75%, 90%, 100% of budget)
- Budget forecasting based on spending trends

### Task 17: Bank Reconciliation
- Bank account management (name, institution, linked GL account)
- File import parser (CSV, OFX format support)
- Auto-matching algorithm (match by amount + date proximity)
- Manual match/unmatch interface (side-by-side view)
- Reconciliation report (matched, unmatched, discrepancies)

### Task 18: Reports Engine
- Pre-built reports: Profit and Loss, Balance Sheet, Cash Flow Statement, AR Aging, Expense by Category, Tax Summary
- Date range selection with period presets (MTD, QTD, YTD, custom)
- Comparative reports (current vs prior period)
- Drill-down (click any amount to see underlying transactions)
- Export to PDF and CSV with company branding

### Task 19: Inventory Tracking
- Item list with stock levels and reorder indicators
- Item form (name, SKU, category, quantity, unit cost, reorder point)
- Asset depreciation calculator (straight-line, declining balance)
- Purchase order tracking
- Low stock alerts

---

## Phase 4: Analytics and Advanced (Tasks 20-23)

### Task 20: KPI Dashboard
- Revenue per billable hour (gauge chart)
- Utilization rate (billable/total hours, donut chart)
- Profit margin by client and service type (bar chart)
- Client concentration risk (top clients % of revenue)
- Monthly recurring revenue tracking (area chart)
- Custom KPI builder

### Task 21: Financial Forecasting
- Revenue projection (linear regression on historical data)
- Expense forecasting (trend analysis)
- Cash flow forecast (inflows vs outflows projection)
- 3-scenario modeling (best/worst/expected with confidence bands)

### Task 22: Advanced Report Builder
- Drag-and-drop field selection
- Filter builder (conditions, operators, values)
- Grouping and aggregation options
- Save report templates
- Scheduled auto-generation

### Task 23: Audit Trail
- Full audit log viewer
- Filter by entity type, date range, action type
- Change diff viewer (old value vs new value)
- Export audit log to CSV

---

## Phase 5: Platform and Automation (Tasks 24-29)

### Task 24: Document Management
- File attachment to any entity (client, invoice, expense, project)
- Document browser with tags and search
- In-app preview (PDF, images)
- File storage in app userData/documents directory

### Task 25: Recurring Transactions
- Template creation (invoice or expense templates)
- Frequency configuration (weekly through annually)
- Auto-generation engine (runs on app start and via setInterval)
- Skip/pause individual occurrences
- Next occurrence preview

### Task 26: Email Integration
- SMTP configuration (Gmail, Outlook, custom server)
- Email template editor (invoice sent, payment received, overdue reminder)
- Send invoices via email with PDF attachment
- Automatic overdue reminders (configurable intervals)
- Email log with send status

### Task 27: Notifications and Alerts
- Native OS notifications via Electron Notification API
- Invoice overdue alerts (1, 3, 7, 14, 30 days)
- Payroll date reminders
- Budget threshold warnings
- Notification center (in-app, read/unread)
- Configurable preferences per alert type

### Task 28: Stripe Data Sync
- Stripe API key configuration in settings
- Pull transactions (payments, refunds, fees, payouts)
- Auto-categorize as income/expense entries
- Map Stripe customers to local clients
- Payout reconciliation against bank deposits

### Task 29: Multi-Company Support
- Company switcher dropdown in top bar
- Separate SQLite database files per company
- Per-company settings (chart of accounts, tax rates, fiscal year)
- Company management view (create, edit, switch)
- Consolidated cross-company summary view

---

## Phase 6: Integration and Distribution (Tasks 30-34)

### Task 30: REST API (Embedded Express)
- Express server in Electron main process
- RESTful endpoints for all major entities
- API key authentication
- Webhook dispatch on create/update/delete events
- API documentation page

### Task 31: Client Portal
- Express routes serving lightweight client-facing pages
- Unique access token per client (time-limited)
- Invoice list and detail views
- PDF download
- Document upload

### Task 32: Mobile Companion
- Responsive web interface served by Express
- Quick expense entry with receipt capture
- Time tracking start/stop
- Dashboard summary view
- Accessible via local network

### Task 33: Packaging and Distribution
- electron-builder config for Mac (.dmg) and Windows (.exe NSIS)
- App icons for both platforms
- Auto-updater setup (electron-updater)
- Code signing configuration notes

### Task 34: Final Integration and Polish
- Keyboard shortcuts (Cmd+N new, Cmd+S save, Cmd+K search, etc.)
- Custom fields UI on all entity forms
- Saved views per module (sort, filter, columns)
- Bulk operations (multi-select, batch edit/delete/export)
- CSV import/export across all modules
- Encrypted cloud backup (AES-256 before upload to Google Drive or S3)
- Global settings page (company profile, tax rates, SMTP, Stripe, backup)
