// ─── Single source of truth for table exemption sets ───
// These sets are used by db.create(), db.update(), db.queryAll(), and db.remove().
// ALL callers must import from here — DO NOT redefine locally in IPC or database files.

// Tables that do NOT have a `company_id` column.
// db.create() injects company_id automatically unless the table is in this set.
export const TABLES_WITHOUT_COMPANY_ID = new Set([
  // Global/reference tables
  'users',
  'schema_meta',
  'schema_migrations',
  'mileage_rates',
  'federal_tax_brackets',
  'state_tax_brackets',
  'state_tax_rates',
  'exchange_rates',
  'federal_payroll_constants',
  'invoice_settings',
  'invoice_catalog_items',
  'companies',
  // User-scoped tables — no company_id
  'custom_shortcuts',
  'command_history',
  'macros',
  // Child/junction tables (company_id on parent)
  'invoice_line_items',
  'journal_entry_lines',
  'pay_stubs',
  'budget_lines',
  'bank_reconciliation_matches',
  'bill_line_items',
  'bill_payments',
  'po_line_items',
  'quote_line_items',
  'asset_depreciation_entries',
  'credit_note_items',
  'invoice_payment_schedule',
  'client_contacts',
  'debt_promises',
  'debt_payment_plans',
  'debt_plan_installments',
  'debt_settlements',
  'debt_compliance_log',
  'invoice_debt_links',
  'expense_line_items',
  'debt_disputes',
  'debt_notes',
  'debt_audit_log',
  'debt_payment_matches',
  'debt_skip_traces',
  'debt_campaigns',
  'expense_approval_steps',
  'expense_comments',
  'reimbursement_batches',
  'period_locks',
  'period_close_checklist',
  'period_close_log',
  'account_reconciliations',
  'account_reconciliation_items',
  'recon_schedule',
  'recon_imports',
  'sox_controls',
  'sox_control_tests',
  'je_approvals',
  'je_history',
  'je_comments',
  'account_group_members',
  'account_permissions',
  'account_watches',
  'account_aliases',
  'account_comments',
  'account_classify_rules',
  'account_balance_history',
  'tb_elimination_entries',
  'tb_working_adjustments',
  'custom_statuses',
  'status_transitions',
  'entity_status_history',
  'email_template_history',
  'email_schedules',
  'tag_groups',
  'tags',
  'entity_tags',
  'tag_rules',
  'custom_field_definitions',
  'custom_field_values',
  'number_sequences',
  'email_templates',
  'inventory_movements',
  'entity_relations',
  'quote_activity_log',
  'invoice_activity_log',
  'expense_activity_log',
  'command_history',
  'workflow_executions',
  'workflow_event_log',
  'predictions',
  'anomaly_log',
  'pattern_cache',
  'loan_payment_schedule',
  'loan_events',
  'loan_payments',
  'compliance_documents',
  'line_item_snippets',
  'webhook_subscriptions',
  'portal_integration_settings',
  'utah_withholding_config',
  'tax_filing_periods',
  'quote_templates',
  'custom_shortcuts',
  'macros',
  'workflow_definitions',
  'classification_settings',
  'closed_periods',
  'user_companies',
  'sync_queue',
  'invoice_tokens',
  'automation_rules',
  'automation_run_log',
  'financial_anomalies',
  'rules',
  'rule_logs',
  'approval_queue',
  'stripe_cache',
  'stripe_transactions',
  'email_log',
  'notifications',
  'documents',
  'invoice_reminders',
  'state_tax_brackets',
  'pto_transactions',
  'pto_balances',
  'pto_policies',
  'employee_deductions',
  'employee_equipment',
  'esign_signatures',
  'esign_permissions',
  'esign_audit_log',
  'payroll_runs',
  // Batch 6 child tables (parent has company_id)
  'workflow_runs',
  'webhook_deliveries',
  'approval_instances',
  // Batch 7 child tables (parent has company_id)
  'ach_batch_items',
  'cc_statement_lines',
  'lockbox_items',
  'fx_rates',
  'inter_company_transfers',
  // Batch 8 child tables
  'inventory_transfer_items',
  'inventory_adjustment_items',
  'stock_take_counts',
  'timesheet_approvals',
  // Batch 9 child tables
  'lead_form_submissions',
  'promo_code_redemptions',
  'quote_template_lines',
  'quote_signatures',
]);

// Tables that do NOT have an `updated_at` column.
// db.update() appends ", updated_at = datetime('now')" unless the table is in this set.
export const TABLES_WITHOUT_UPDATED_AT = new Set([
  // Child / junction tables
  'invoice_line_items',
  'journal_entry_lines',
  'pay_stubs',
  'budget_lines',
  'bank_reconciliation_matches',
  // Financial record tables (append-only by design)
  'payments',
  'tax_payments',
  'tax_categories',
  // Transaction / log tables (immutable after insert)
  'bank_transactions',
  'audit_log',
  'email_log',
  'stripe_transactions',
  // Metadata / reference tables
  'documents',
  'notifications',
  'custom_field_defs',
  'saved_views',
  'user_companies',
  // Debt collection child tables
  'debt_contacts', 'debt_communications', 'debt_payments',
  'debt_pipeline_stages', 'debt_evidence', 'debt_legal_actions',
  'debt_automation_rules', 'debt_templates',
  'quote_line_items',
  // Invoice reminders
  'invoice_reminders',
  // Invoice payment schedule
  'invoice_payment_schedule',
  // Track 1 child tables
  'client_contacts', 'debt_promises',
  // Track 2 child tables
  'state_tax_brackets', 'pto_transactions',
  // Debt & Invoice Enhancement child tables
  'debt_payment_plans', 'debt_plan_installments', 'debt_settlements',
  'debt_compliance_log', 'invoice_debt_links',
  'expense_line_items', 'debt_disputes', 'debt_notes',
  // DC Immersive Workspace
  'debt_audit_log', 'debt_payment_matches',
  // Advanced debt collection
  'debt_skip_traces', 'debt_campaigns',
  // Expense workflow
  'expense_approval_steps', 'expense_comments', 'reimbursement_batches', 'period_locks',
  // Period close + reconciliation + compliance
  'period_close_checklist', 'period_close_log', 'account_reconciliations',
  'recon_schedule', 'recon_imports',
  'sox_controls', 'sox_control_tests', 'je_approvals',
  // CoA round 2
  'account_group_members', 'account_permissions', 'account_watches',
  'account_aliases', 'account_comments', 'account_classify_rules',
  'account_balance_history',
  // Workflow + email templates child tables
  'custom_statuses', 'status_transitions', 'entity_status_history',
  'email_template_history', 'email_schedules',
  // Round-3 audit tables
  'inventory_movements',
  'entity_relations',
  'tb_elimination_entries',
  'je_history',
  'tag_groups', 'tags', 'entity_tags', 'tag_rules',
  'custom_field_definitions',
  // schema.sql tables that lack updated_at
  'bill_line_items', 'bill_payments', 'po_line_items',
  'asset_depreciation_entries', 'credit_note_items',
  'federal_tax_brackets', 'state_tax_brackets', 'state_tax_rates',
  'exchange_rates', 'sync_queue', 'invoice_tokens',
  'automation_rules', 'automation_run_log', 'financial_anomalies',
  'rules', 'rule_logs', 'approval_queue',
  // Quote system child tables
  'quote_activity_log',
  // Invoice activity log
  'invoice_activity_log',
  // Expense activity log
  'expense_activity_log',
  // Advanced System
  'command_history',
  'workflow_executions',
  'workflow_event_log',
  'predictions',
  'anomaly_log',
  // Loan system child tables
  'loan_payment_schedule',
  'loan_events',
  'loan_payments',
  // IRS mileage rates — global reference table
  'mileage_rates',
  // Stripe cache tables — created_at / synced_at only
  'stripe_cache',
  'stripe_offline_queue',
  'stripe_sync_state',
  // Federal payroll constants — created_at only
  'federal_payroll_constants',
  // Schema tracking
  'schema_meta',
  'schema_migrations',
  // Compliance documents
  'compliance_documents',
  // PTO
  'pto_transactions',
  'pto_balances',
  // Debt
  'debt_promises',
  'debt_payment_plans',
  'debt_plan_installments',
  'debt_settlements',
  'debt_compliance_log',
  'debt_notes',
  'debt_audit_log',
  'debt_payment_matches',
  'debt_skip_traces',
  'debt_campaigns',
  'debt_disputes',
  'debt_contacts',
  'debt_communications',
  'debt_payments',
  'debt_pipeline_stages',
  'debt_evidence',
  'debt_automation_rules',
  'debt_templates',
  'debt_plan_installments',
  'invoice_debt_links',
  // Bank recon
  'bank_reconciliation_matches',
  // Budget
  'budget_lines',
  // JE
  'journal_entry_lines',
  'je_approvals',
  'je_history',
  'je_comments',
  // Payroll
  'pay_stubs',
  // Tax
  'tax_payments',
  'tax_categories',
  // Stripe
  'stripe_transactions',
  // Email
  'email_log',
  'email_template_history',
  'email_schedules',
  // Notifications
  'notifications',
  // Documents
  'documents',
  // Sync
  'sync_queue',
  'invoice_tokens',
  // Automation
  'automation_rules',
  'automation_run_log',
  'financial_anomalies',
  // Rules
  'rules',
  'rule_logs',
  // Approval
  'approval_queue',
  // Reimbursement
  'reimbursement_batches',
  // Period
  'period_locks',
  'period_close_checklist',
  'period_close_log',
  // Recon
  'recon_schedule',
  'recon_imports',
  // SOX
  'sox_controls',
  'sox_control_tests',
  // Account
  'account_group_members',
  'account_permissions',
  'account_watches',
  'account_aliases',
  'account_comments',
  'account_classify_rules',
  'account_balance_history',
  // TB
  'tb_elimination_entries',
  'tb_working_adjustments',
  // Tags
  'tag_groups',
  'tags',
  'entity_tags',
  'tag_rules',
  // Custom fields
  'custom_field_definitions',
  'custom_field_values',
  // Number sequences
  'number_sequences',
  // Email templates
  'email_templates',
  // Status
  'custom_statuses',
  'status_transitions',
  'entity_status_history',
  // Workflow
  'workflow_executions',
  'workflow_event_log',
  // Predictions
  'predictions',
  'anomaly_log',
  'pattern_cache',
  // Loan
  'loan_payment_schedule',
  'loan_events',
  'loan_payments',
  // Mileage
  'mileage_rates',
  // Webhook
  'webhook_subscriptions',
  // Portal
  'portal_integration_settings',
  // Utah withholding
  'utah_withholding_config',
  // Tax filing
  'tax_filing_periods',
  // Quote
  'quote_activity_log',
  'quote_templates',
  'quote_line_items',
  // Invoice
  'invoice_activity_log',
  'invoice_line_items',
  'invoice_payment_schedule',
  'invoice_reminders',
  'invoice_debt_links',
  'invoice_tokens',
  // Expense
  'expense_activity_log',
  'expense_line_items',
  'expense_approval_steps',
  'expense_comments',
  // Bill
  'bill_line_items',
  'bill_payments',
  // PO
  'po_line_items',
  // Asset
  'asset_depreciation_entries',
  // Credit note
  'credit_note_items',
  // Inventory
  'inventory_movements',
  // Entity relations
  'entity_relations',
  // Command
  'command_history',
  // Macro
  'macros',
  'custom_shortcuts',
  // Classification
  'classification_settings',
  // Closed periods
  'closed_periods',
  // User companies
  'user_companies',
  // Compliance
  'compliance_documents',
  // Line item snippets
  'line_item_snippets',
  // PTO
  'pto_policies',
  'pto_balances',
  'pto_transactions',
  // Employee
  'employee_deductions',
  'employee_equipment',
  // E-Sign
  'esign_signatures',
  'esign_audit_log',
  'esign_permissions',
  // Payroll
  'payroll_runs',
  // Bank
  'bank_transactions',
  // Audit
  'audit_log',
  // Schema
  'schema_meta',
  'schema_migrations',
  // Federal/state tax
  'federal_tax_brackets',
  'state_tax_brackets',
  'state_tax_rates',
  // Exchange rates
  'exchange_rates',
  // Stripe cache
  'stripe_cache',
  // Batch 6: Automation log/audit tables (no updated_at)
  'workflow_runs',
  'webhook_deliveries',
  'triggered_actions_log',
  'bulk_operations_log',
  'auto_categorize_learnings',
  'quick_actions',
  'cash_position_snapshots',
  'cash_forecast_lines',
  // Batch 7: append-only or no-updated_at
  'fx_rates',
  'fx_revaluation_runs',
  'ach_batch_items',
  'cc_statement_lines',
  'lockbox_items',
  'pending_deposits',
  'petty_cash_log',
  'positive_pay_files',
  'bank_match_attempts',
  'bank_fee_categories',
  'stop_payments',
  'sweep_rules',
  'loan_covenants',
  'letters_of_credit',
  'treasury_investments',
  'inter_company_transfers',
  'credit_card_statements',
  'lockbox_imports',
  'ach_batches',
  // Batch 8: log/audit and child tables (no updated_at)
  'inventory_transfer_items',
  'inventory_adjustment_items',
  'inventory_adjustments',
  'stock_take_sessions',
  'stock_take_counts',
  'low_stock_alerts',
  'inventory_value_history',
  'billable_time_summary',
  'project_profitability',
  'inventory_lots',
  'inventory_serial_numbers',
  'inventory_locations',
  'timesheet_periods',
  'timesheet_approvals',
  // Batch 9 log/child tables
  'deal_activities',
  'sales_targets',
  'sales_performance_snapshots',
  'commission_calculations',
  'lead_form_submissions',
  'promo_code_redemptions',
  'loyalty_transactions',
  'customer_referrals',
  'quote_template_lines',
  'quote_conversion_log',
  'quote_signatures',
  'win_loss_analysis',
]);

// Tables with a `deleted_at` column for soft-delete support.
// queryAll() auto-filters these to exclude soft-deleted rows.
export const TABLES_WITH_DELETED_AT = new Set([
  'accounts',
  'tags',
  'custom_field_definitions',
  'invoices',
  'bills',
  'expenses',
  'journal_entries',
  'loans',
  'clients',
  'vendors',
  'employees',
  'projects',
  'quotes',
  'inventory_items',
]);

// Tables that support soft-delete via remove().
// remove() sets deleted_at instead of physically deleting.
export const SOFT_DELETE_TABLES = new Set([
  'invoices',
  'bills',
  'expenses',
  'journal_entries',
  'loans',
  'clients',
  'vendors',
  'employees',
  'projects',
  'quotes',
]);
