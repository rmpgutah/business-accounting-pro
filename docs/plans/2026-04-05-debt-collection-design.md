# Debt Collection Module — Design Document

**Date:** 2026-04-05
**Approach:** Single unified module with tabbed sub-views (Receivables, Payables, Pipeline, Legal Toolkit, Analytics)

## Overview

Full debt collection hub for tracking debts owed to and by the business, with automated escalation pipeline, court-preparation toolkit, and deep integration with existing modules (Invoicing, Bills, Clients, Vendors, Rules Engine, Notifications, Audit Trail).

## Data Model

### `debts`
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| company_id | TEXT FK | Company reference |
| type | TEXT | receivable \| payable |
| status | TEXT | active \| in_collection \| legal \| settled \| written_off \| disputed \| bankruptcy |
| debtor_id | TEXT | FK to clients/vendors/custom entity |
| debtor_type | TEXT | client \| vendor \| custom |
| debtor_name | TEXT | Denormalized name for custom debtors |
| debtor_email | TEXT | Denormalized for custom debtors |
| debtor_phone | TEXT | Denormalized for custom debtors |
| debtor_address | TEXT | Denormalized for custom debtors |
| source_type | TEXT | invoice \| bill \| manual |
| source_id | TEXT | FK to invoices/bills |
| original_amount | REAL | Initial debt amount |
| interest_accrued | REAL | Running interest total |
| fees_accrued | REAL | Late fees total |
| payments_made | REAL | Sum of payments received |
| balance_due | REAL | Computed: original + interest + fees - payments |
| interest_rate | REAL | Annual rate (e.g., 0.12 for 12%) |
| interest_type | TEXT | simple \| compound |
| interest_start_date | TEXT | When interest begins accruing |
| compound_frequency | INTEGER | Times per year for compound (12=monthly, 4=quarterly) |
| due_date | TEXT | Original payment due date |
| delinquent_date | TEXT | Date debt became delinquent |
| statute_of_limitations_date | TEXT | Calculated expiration date |
| statute_years | INTEGER | Statute period in years |
| jurisdiction | TEXT | State/country for legal calculations |
| priority | TEXT | low \| medium \| high \| critical |
| current_stage | TEXT | Current pipeline stage |
| assigned_to | TEXT | User handling this debt |
| hold | INTEGER | 1=automation paused |
| hold_reason | TEXT | Why automation is paused |
| agency_name | TEXT | Collections agency name |
| agency_contact | TEXT | Agency contact info |
| agency_reference | TEXT | Agency case reference |
| agency_commission_rate | REAL | Agency commission percentage |
| settlement_amount | REAL | Agreed settlement amount if settled |
| write_off_reason | TEXT | Reason for write-off |
| notes | TEXT | General notes |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |

### `debt_contacts`
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| debt_id | TEXT FK | Debt reference |
| role | TEXT | debtor \| guarantor \| attorney \| witness \| collections_agent \| judge \| mediator |
| name | TEXT | Full name |
| email | TEXT | Email |
| phone | TEXT | Phone |
| address | TEXT | Mailing address |
| company | TEXT | Organization |
| bar_number | TEXT | Attorney bar number |
| notes | TEXT | Role-specific notes |
| created_at | TEXT | ISO timestamp |

### `debt_communications`
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| debt_id | TEXT FK | Debt reference |
| type | TEXT | email \| phone \| letter \| in_person \| legal_filing \| text \| fax |
| direction | TEXT | inbound \| outbound |
| subject | TEXT | Subject/title |
| body | TEXT | Full content |
| outcome | TEXT | Summary of result |
| contact_id | TEXT FK | Who was communicated with |
| template_used | TEXT | If generated from template |
| attachments_json | TEXT | JSON array of file references |
| logged_by | TEXT | User who logged this |
| logged_at | TEXT | ISO timestamp |

### `debt_payments`
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| debt_id | TEXT FK | Debt reference |
| amount | REAL | Payment amount |
| method | TEXT | cash \| check \| card \| wire \| ach \| garnishment \| settlement \| other |
| reference_number | TEXT | Check number, transaction ID, etc. |
| received_date | TEXT | Date payment received |
| applied_to_principal | REAL | Portion applied to principal |
| applied_to_interest | REAL | Portion applied to interest |
| applied_to_fees | REAL | Portion applied to fees |
| notes | TEXT | Payment notes |
| created_at | TEXT | ISO timestamp |

### `debt_pipeline_stages`
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| debt_id | TEXT FK | Debt reference |
| stage | TEXT | reminder \| warning \| final_notice \| demand_letter \| collections_agency \| legal_action \| judgment \| garnishment |
| entered_at | TEXT | When debt entered this stage |
| exited_at | TEXT | When debt left this stage |
| auto_advanced | INTEGER | 1=automated, 0=manual |
| advanced_by | TEXT | User who advanced (if manual) |
| notes | TEXT | Stage-specific notes |

### `debt_evidence`
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| debt_id | TEXT FK | Debt reference |
| type | TEXT | contract \| invoice \| communication \| payment_record \| delivery_proof \| signed_agreement \| witness_statement \| photo \| other |
| title | TEXT | Evidence title |
| description | TEXT | What this proves |
| file_path | TEXT | Path to stored file |
| file_name | TEXT | Original filename |
| date_of_evidence | TEXT | When this evidence is from |
| court_relevance | TEXT | high \| medium \| low |
| admitted | INTEGER | 1=admitted to court record |
| notes | TEXT | Additional context |
| created_at | TEXT | ISO timestamp |

### `debt_legal_actions`
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| debt_id | TEXT FK | Debt reference |
| action_type | TEXT | demand_letter \| small_claims \| civil_suit \| arbitration \| mediation \| garnishment_order \| lien |
| filing_date | TEXT | Date filed |
| court_name | TEXT | Court/venue name |
| court_address | TEXT | Court address |
| case_number | TEXT | Court case number |
| hearing_date | TEXT | Next hearing date |
| hearing_time | TEXT | Hearing time |
| judge_name | TEXT | Assigned judge |
| status | TEXT | preparing \| filed \| served \| hearing_scheduled \| in_progress \| judgment \| appeal \| closed |
| outcome | TEXT | Outcome description |
| judgment_amount | REAL | Judgment amount if won |
| judgment_date | TEXT | Date of judgment |
| attorney_id | TEXT FK | -> debt_contacts |
| court_costs | REAL | Filing fees and costs |
| checklist_json | TEXT | JSON array of checklist items [{title, completed, completed_date, completed_by, notes}] |
| notes | TEXT | Case notes |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |

### `debt_automation_rules`
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| company_id | TEXT FK | Company reference |
| debt_id | TEXT | NULL=global default, otherwise per-debt override |
| from_stage | TEXT | Source stage |
| to_stage | TEXT | Target stage |
| days_after_entry | INTEGER | Days in from_stage before advancing |
| condition_json | TEXT | Additional conditions (balance threshold, priority, etc.) |
| action | TEXT | advance_stage \| send_template \| create_notification \| flag_review |
| template_name | TEXT | Template to use for send_template action |
| require_review | INTEGER | 1=needs manual confirmation before executing |
| enabled | INTEGER | 1=active |
| created_at | TEXT | ISO timestamp |

### `debt_templates`
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| company_id | TEXT FK | Company reference |
| name | TEXT | Template name |
| type | TEXT | reminder \| warning \| final_notice \| demand_letter \| custom |
| subject | TEXT | Email/letter subject with merge fields |
| body | TEXT | Full template body with merge fields |
| severity | TEXT | friendly \| formal \| final |
| is_default | INTEGER | 1=system default |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |

## UI Structure

### Module Header
- Icon: `Scale` (Lucide)
- SummaryBar stats: Total Outstanding | In Collection | Legal Active | Collected This Month | Write-offs YTD

### Tab 1: Receivables
- List of debts where type=receivable
- Columns: Debtor | Source | Original Amount | Balance Due | Age (days) | Stage | Priority | Actions
- Filters: status, stage, priority, date range, assigned_to
- "New Debt" button + "Import Overdue Invoices" button
- Row click -> Debt Detail view

### Tab 2: Payables
- List of debts where type=payable
- Columns: Creditor | Source | Original Amount | Balance Due | Due Date | Status | Actions
- "New Payable Debt" button

### Tab 3: Pipeline
- Stage columns: Reminder -> Warning -> Final Notice -> Demand Letter -> Collections Agency -> Legal Action -> Judgment -> Garnishment
- Cards show: debtor name, balance, days in stage, priority color
- "Advance" and "Hold" buttons per card
- Stage counts in column headers

### Tab 4: Legal Toolkit
- Sub-sections:
  - **Evidence Builder**: attach files, tag relevance, timeline view sorted by date
  - **Demand Letters**: template selection, merge field preview, generate + auto-log
  - **Court Filings**: case tracking, hearing dates, filing checklists with progress bars
  - **Statute Tracker**: countdown per debt with color-coded urgency
  - **Document Bundle Export**: generate court-ready PDF package

### Tab 5: Analytics
- Collection rate over time (area chart)
- Aging breakdown (bar chart: 30/60/90/120/180+ days)
- Recovery by stage (where debts resolve)
- Top debtors by balance
- Interest accrued vs collected
- Pipeline velocity (avg days per stage)

### Debt Detail View
- Header: debtor name, balance, stage badge, priority
- Left: debt info, interest calculator, payment history table
- Right: communication log (timeline), evidence list, legal status
- Action bar: Log Communication | Record Payment | Advance Stage | Generate Demand Letter | Add Evidence | Write Off

## Automations

### Default Escalation Pipeline
| Stage | Trigger | Auto-Action |
|-------|---------|-------------|
| Reminder | Invoice 7 days past due | Auto-create debt, send reminder |
| Warning | 14 days in Reminder | Send warning with interest notice |
| Final Notice | 14 days in Warning | Send final notice with deadline |
| Demand Letter | 7 days in Final Notice | Generate formal demand letter |
| Collections Agency | 14 days in Demand Letter | Flag for manual review |
| Legal Action | Manual only | Create filing checklist |
| Judgment | Manual only | Record judgment |
| Garnishment | Manual only | Track garnishment payments |

- All timelines configurable per-company and per-debt
- "Hold" flag pauses automation
- "Flag for Review" stages require manual confirmation

### Interest Calculations
- Simple: `principal * rate * (days / 365)`
- Compound: `principal * (1 + rate/n)^(n*t) - principal`
- Late fees: flat or percentage, configurable
- Auto-recalculate on payment
- Jurisdiction max rate caps (user-editable)

## Integrations

| Module | Integration |
|--------|-------------|
| Invoicing | "Send to Collections" action on overdue invoices. Auto-import overdue invoices. Payment sync. |
| Bills/AP | Payable debts link to bills. Settlement payments reflect in AP. |
| Clients | Debt status badge on client detail. Collection history in context panel. Optional block on new invoices. |
| Vendors | Payable debts link to vendor records. |
| Rules Engine | New triggers: debt.stage_changed, debt.payment_received, debt.overdue_threshold. New actions: create_debt, advance_stage, send_template. |
| Notifications | Auto-notify: stage advances, payments, statute expiring (90/60/30 days), hearing dates. |
| Audit Trail | All debt actions logged. |
| Documents | Evidence files via existing document system. |
| Reports | Aging Report, Collection Effectiveness, Write-off Summary, Legal Action Summary. |

## Edge Cases
- **Partial settlements**: Record agreement, adjust balance, close as "settled"
- **Disputed debts**: "Disputed" flag pauses automation, logs reason
- **Multiple debts per debtor**: Aggregated debtor summary view
- **Collections agency transfer**: Track agency info, commission, reference number
- **Bankruptcy**: Special status freezing all collection activity
- **Write-offs**: Confirmation required, logs reason, suggests bad debt accounting entry
- **Statute expiration**: Warning banner, cannot auto-advance to legal after expiry

## Demand Letter Templates

### Merge Fields
`{{debtor_name}}`, `{{debtor_address}}`, `{{original_amount}}`, `{{interest_accrued}}`, `{{fees_accrued}}`, `{{total_due}}`, `{{due_date}}`, `{{demand_deadline}}`, `{{days_overdue}}`, `{{company_name}}`, `{{company_address}}`, `{{company_phone}}`, `{{company_email}}`

### Built-in Templates
1. **Friendly Reminder** — conversational tone, payment link emphasis
2. **Formal Warning** — professional tone, interest accrual notice, deadline
3. **Final Demand** — legal language, consequences stated, pre-litigation deadline

## Court Filing Checklists

### Small Claims (default)
1. Verify statute of limitations not expired
2. Calculate total claim (principal + interest + fees + court costs)
3. Prepare demand letter proof (sent date, delivery confirmation)
4. Compile evidence package
5. Complete court filing form
6. Pay filing fee
7. Serve defendant (record method)
8. File proof of service
9. Prepare court presentation summary

### Civil Suit / Arbitration / Mediation — extended checklists, user-customizable

## Document Bundle Export
Court-ready PDF containing:
1. Debt Summary Sheet
2. Payment History Table
3. Communication Log (chronological)
4. Evidence Timeline with descriptions
5. Demand Letter copies
6. Interest calculation breakdown
7. Table of contents with page numbers
