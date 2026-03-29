# Business Accounting Pro — Design Document

**Date:** 2026-03-28
**Status:** Approved
**Platform:** Electron + React + SQLite (Mac & Windows)

## Overview

A comprehensive, cross-platform desktop accounting application for a service-based business (1-5 people). All data stored locally in encrypted SQLite with optional cloud backup. Modern dark theme UI with rich data visualization.

## Technology Stack

| Component | Technology |
|-----------|-----------|
| Shell | Electron (cross-platform desktop) |
| Frontend | React 18 + TypeScript |
| Styling | Tailwind CSS (dark theme) |
| Charts | Recharts |
| State | Zustand |
| Backend | Node.js (Electron main process) |
| Database | SQLite via better-sqlite3 |
| PDF | @react-pdf/renderer |
| Email | Nodemailer (SMTP) |
| Packaging | electron-builder (Mac .dmg, Windows .exe) |
| API | Express.js (embedded, for client portal + mobile + REST API) |

## Architecture

```
Electron Shell
├── Main Process (Node.js)
│   ├── SQLite Database (encrypted)
│   ├── IPC Handlers (typed channels)
│   ├── PDF Generator
│   ├── Email Service (SMTP)
│   ├── Cloud Backup Service
│   ├── Embedded Express Server
│   │   ├── REST API endpoints
│   │   ├── Client Portal routes
│   │   └── Mobile Companion routes
│   └── Notification Service (native OS)
└── Renderer Process (React)
    ├── Sidebar Navigation
    ├── 27 Module Views
    ├── Global Search
    ├── Notification Center
    └── Data Visualization (Recharts)
```

## Modules (27)

### Core Modules
1. **Dashboard** — Financial snapshot (revenue, expenses, net income MTD/QTD/YTD), cash flow chart, upcoming items, quick actions
2. **Chart of Accounts & General Ledger** — Pre-loaded service business accounts, double-entry bookkeeping, journal entries, reconciliation
3. **Income & Invoicing** — Create/send invoices (PDF), track status (draft/sent/paid/overdue), recurring templates, payment recording
4. **Expenses & Bills (AP)** — Record expenses by category, receipt attachments, vendor management, bill tracking, mileage tracking
5. **Payroll** — Employee/contractor profiles, pay schedules, gross-to-net calculation (federal/state/FICA/Medicare), pay stubs, 1099/W-2 tracking
6. **Time Tracking** — Start/stop timer + manual entry, client/project assignment, billable vs non-billable, auto-convert to invoices
7. **Projects / Job Costing** — Projects linked to clients, per-project income/expense tracking, profitability analysis, status dashboard
8. **Tax Management** — Quarterly estimated tax calculator, tax category mapping, liability tracking, CPA export, Schedule C support
9. **Reports** — P&L, Balance Sheet, Cash Flow, AR Aging, Expense by Category, Tax Summary — all exportable to PDF/CSV
10. **Budget Management** — Monthly/quarterly/annual budgets by category, budget vs actual charts, threshold alerts, forecasting
11. **Document Management** — Attach files to any record, organized file browser, full-text search, in-app preview
12. **Audit Trail** — Every CRUD operation logged with timestamp, change history per record, filterable log, exportable
13. **Client Management (CRM)** — Client directory, contact/billing details, full client history, notes/tags, custom fields, status tracking
14. **Bank Reconciliation** — Import statements (CSV/OFX/QFX), auto-match transactions, manual match interface, reconciliation reports
15. **Inventory Tracking** — Supplies/equipment tracking, purchase orders, stock levels, reorder alerts, asset depreciation
16. **Settings & Backup** — Company profile, fiscal year, tax rates, encrypted cloud backup (Google Drive/Dropbox/S3), CSV import

### Analytics Modules
17. **Financial Forecasting** — Revenue/expense projections, cash flow forecasting, scenario modeling (best/worst/expected)
18. **Advanced KPI Dashboard** — Profit margins by client/service, revenue per hour, utilization rate, client concentration, MRR
19. **Advanced Reporting Engine** — Custom report builder (drag-and-drop), templates, scheduled reports, comparative reports, drill-down

### Platform Modules
20. **Multi-Company Support** — Company switcher, separate databases per company, per-company settings, consolidated reporting
21. **Client Portal** — Web-based portal for clients to view invoices, download PDFs, upload documents (secured with unique links)
22. **Integration & API** — REST API, webhook support, CSV/Excel import/export, IIF/QBO export, plugin architecture
23. **Mobile Companion** — Responsive web interface for quick expense entry, time tracking, approvals, dashboard viewing

### Automation Modules
24. **Recurring Transactions** — Templates for recurring income/expenses, configurable frequency, auto-generation, skip/pause
25. **Email Integration** — Send invoices via email, configurable templates, automatic overdue reminders, email log, SMTP config
26. **Notifications & Alerts** — Native OS desktop notifications, overdue/payroll/budget/tax/inventory alerts, notification center, configurable

### Integration Modules
27. **Stripe Data Sync** — Pull transaction data from Stripe, auto-categorize, map to clients, reconcile payouts, fee tracking

## Cross-Cutting Features

- **Custom Fields** — User-definable fields on any record type
- **Customizable Views** — Sort, filter, group, save custom views per module
- **Flexible Categories/Tags** — User-defined taxonomies across all modules
- **Configurable Workflows** — Required fields, defaults, validation rules
- **Bulk Operations** — Multi-select, batch edit/delete/export
- **Global Search** — Search across all modules from anywhere
- **Rich Data Visualization** — Interactive charts (line, area, bar, donut, gauge, waterfall, sparkline) across all modules, exportable as images
- **Keyboard Shortcuts** — Power user navigation and actions

## UI Design

- **Theme:** Modern dark with accent colors (green=income, red=expense, blue=neutral)
- **Layout:** Fixed sidebar navigation (collapsible to icons) + main content area + status bar
- **Navigation:** Sidebar for modules, breadcrumbs within modules
- **Responsive:** Electron window is resizable, content adapts

## Data Model Highlights

- Double-entry bookkeeping (every transaction has debit + credit entries)
- Relational model: Clients → Projects → Time Entries → Invoices
- Multi-company via separate SQLite database files
- Audit trail via trigger-based logging
- Custom fields stored as JSON columns

## Security

- SQLite database encrypted at rest
- Cloud backups encrypted before upload
- Client portal secured with unique, time-limited access tokens
- No sensitive data in renderer process (all DB access via IPC)
- Audit trail is append-only

## Distribution

- Mac: .dmg installer via electron-builder
- Windows: .exe installer (NSIS) via electron-builder
- Auto-update support via electron-updater (optional)
