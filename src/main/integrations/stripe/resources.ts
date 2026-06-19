// src/main/integrations/stripe/resources.ts
//
// Resource registry — maps logical Stripe resource names to REST paths and
// allowed actions. Keeps the IPC surface small: renderer sends
// { resource, action, id?, params? } and we translate it to an HTTP call.
//
// Only public, documented Stripe endpoints are listed here. Entries that
// Stripe exposes in the developer portal but NOT in the public REST API
// (Health Alerts, Vault, Claimable Sandboxes, Delegated Commerce, Accounts
// v2, Money Movement v2, Stripe Apps Secrets, etc.) are registered but
// marked `requiresPreview: true`. They will route to the same client and
// will work as soon as the account is enrolled in the preview — Stripe's
// server-side path is what gates them, not this client.

export type Action = 'list' | 'retrieve' | 'create' | 'update' | 'delete' | 'search' | 'custom';

export interface ResourceSpec {
  /** Base path, e.g. '/v1/charges'. Retrieve/update/delete append `/:id`. */
  path: string;
  /** Actions the caller may invoke. */
  actions: Action[];
  /** Optional label for UI. */
  label?: string;
  /** Optional group for UI categorization (matches Stripe portal). */
  group?: string;
  /** Stripe API version override (used for previews pinned to a specific date). */
  apiVersion?: string;
  /** Marks resources that require beta/preview enrollment on the account. */
  requiresPreview?: boolean;
  /** Custom sub-actions keyed by name → { method, subPath }. subPath may include `:id`. */
  custom?: Record<string, { method: 'GET' | 'POST' | 'DELETE'; subPath: string }>;
}

/**
 * Registry. Keys are the names requested by the user (normalized to snake_case).
 * The UI/IPC layer exposes exactly these keys.
 */
export const STRIPE_RESOURCES: Record<string, ResourceSpec> = {
  // ─── Core ──────────────────────────────────────────────────────────
  account_evaluations:     { path: '/v1/account_evaluations', actions: ['list', 'retrieve'], group: 'Core', requiresPreview: true, label: 'Account Evaluations' },
  apple_pay_domains:       { path: '/v1/apple_pay/domains', actions: ['list', 'retrieve', 'create', 'delete'], group: 'Core', label: 'Apple Pay Domains' },
  balance:                 { path: '/v1/balance', actions: ['retrieve'], group: 'Core', label: 'Balance' },
  balance_transactions:    { path: '/v1/balance_transactions', actions: ['list', 'retrieve'], group: 'Core', label: 'Balance Transactions' },
  charges:                 { path: '/v1/charges', actions: ['list', 'retrieve', 'create', 'update', 'search'], group: 'Core', label: 'Charges' },
  refunds:                 { path: '/v1/refunds', actions: ['list', 'retrieve', 'create', 'update'], group: 'Core', label: 'Refunds' },
  confirmation_tokens:     { path: '/v1/confirmation_tokens', actions: ['retrieve'], group: 'Core', label: 'Confirmation Token' },
  customer_sessions:       { path: '/v1/customer_sessions', actions: ['create'], group: 'Core', label: 'Customer Session' },
  customers:               {
    path: '/v1/customers', actions: ['list', 'retrieve', 'create', 'update', 'delete', 'search'], group: 'Core', label: 'Customers',
    custom: {
      fundingInstructions: { method: 'POST', subPath: '/v1/customers/:id/funding_instructions' },
      listSources:         { method: 'GET',  subPath: '/v1/customers/:id/sources' },
      listCards:           { method: 'GET',  subPath: '/v1/customers/:id/cards' },
      listBankAccounts:    { method: 'GET',  subPath: '/v1/customers/:id/bank_accounts' },
      listPaymentMethods:  { method: 'GET',  subPath: '/v1/customers/:id/payment_methods' },
    },
  },
  product_search:          { path: '/v1/products/search', actions: ['custom'], group: 'Core', label: 'Product Search' },
  disputes:                { path: '/v1/disputes', actions: ['list', 'retrieve', 'update'], group: 'Core', label: 'Disputes' },
  ephemeral_keys:          { path: '/v1/ephemeral_keys', actions: ['create', 'delete'], group: 'Core', label: 'Ephemeral Keys' },
  events:                  { path: '/v1/events', actions: ['list', 'retrieve'], group: 'Core', label: 'Events' },
  files:                   { path: '/v1/files', actions: ['list', 'retrieve'], group: 'Core', label: 'Files' },
  file_links:              { path: '/v1/file_links', actions: ['list', 'retrieve', 'create', 'update'], group: 'Core', label: 'File Links' },
  health_alerts:           { path: '/v1/health_alerts', actions: ['list', 'retrieve'], group: 'Core', label: 'Health Alerts', requiresPreview: true },
  payment_intents:         {
    path: '/v1/payment_intents', actions: ['list', 'retrieve', 'create', 'update', 'search'], group: 'Core', label: 'Payment Intents',
    custom: {
      confirm:       { method: 'POST', subPath: '/v1/payment_intents/:id/confirm' },
      capture:       { method: 'POST', subPath: '/v1/payment_intents/:id/capture' },
      cancel:        { method: 'POST', subPath: '/v1/payment_intents/:id/cancel' },
      incrementAuth: { method: 'POST', subPath: '/v1/payment_intents/:id/increment_authorization' },
      applyCustomerBalance: { method: 'POST', subPath: '/v1/payment_intents/:id/apply_customer_balance' },
    },
  },
  payment_method_domains:  { path: '/v1/payment_method_domains', actions: ['list', 'retrieve', 'create', 'update'], group: 'Core', label: 'Payment Method Domains' },
  payment_methods:         {
    path: '/v1/payment_methods', actions: ['list', 'retrieve', 'create', 'update'], group: 'Core', label: 'Payment Methods',
    custom: {
      attach: { method: 'POST', subPath: '/v1/payment_methods/:id/attach' },
      detach: { method: 'POST', subPath: '/v1/payment_methods/:id/detach' },
    },
  },
  payouts:                 {
    path: '/v1/payouts', actions: ['list', 'retrieve', 'create', 'update'], group: 'Core', label: 'Payouts',
    custom: {
      cancel:  { method: 'POST', subPath: '/v1/payouts/:id/cancel' },
      reverse: { method: 'POST', subPath: '/v1/payouts/:id/reverse' },
    },
  },
  products:                { path: '/v1/products', actions: ['list', 'retrieve', 'create', 'update', 'delete', 'search'], group: 'Core', label: 'Products' },
  setup_intents:           {
    path: '/v1/setup_intents', actions: ['list', 'retrieve', 'create', 'update'], group: 'Core', label: 'Setup Intents',
    custom: {
      confirm:    { method: 'POST', subPath: '/v1/setup_intents/:id/confirm' },
      cancel:     { method: 'POST', subPath: '/v1/setup_intents/:id/cancel' },
      verify:     { method: 'POST', subPath: '/v1/setup_intents/:id/verify_microdeposits' },
    },
  },
  shipping_rates:          { path: '/v1/shipping_rates', actions: ['list', 'retrieve', 'create', 'update'], group: 'Core', label: 'Shipping Rates' },
  sources:                 { path: '/v1/sources', actions: ['retrieve', 'create', 'update'], group: 'Core', label: 'Sources' },
  test_clocks:             { path: '/v1/test_helpers/test_clocks', actions: ['list', 'retrieve', 'create', 'delete'], group: 'Core', label: 'Test Clocks' },
  tokens:                  { path: '/v1/tokens', actions: ['retrieve', 'create'], group: 'Core', label: 'Tokens' },
  vault_gb_bank_account:   { path: '/v1/vault/gb_bank_accounts', actions: ['retrieve', 'create'], group: 'Core', label: 'Vault GB Bank Account', requiresPreview: true },
  vault_us_bank_account:   { path: '/v1/vault/us_bank_accounts', actions: ['retrieve', 'create'], group: 'Core', label: 'Vault US Bank Account', requiresPreview: true },

  // ─── Accounts v2 ────────────────────────────────────────────────────
  accounts_v2:             { path: '/v2/core/accounts', actions: ['list', 'retrieve', 'create', 'update'], group: 'Accounts v2', label: 'Accounts v2', requiresPreview: true },

  // ─── Batches ────────────────────────────────────────────────────────
  batch_jobs:              { path: '/v2/core/batch_jobs', actions: ['list', 'retrieve', 'create'], group: 'Batches', label: 'Batch Jobs', requiresPreview: true },
  batch_job_runs:          { path: '/v2/core/batch_job_runs', actions: ['list', 'retrieve'], group: 'Batches', label: 'Batch Job Runs', requiresPreview: true },

  // ─── Billing ────────────────────────────────────────────────────────
  billing_alerts:          { path: '/v1/billing/alerts', actions: ['list', 'retrieve', 'create'], group: 'Billing', label: 'Billing Alerts' },
  billable_items:          { path: '/v1/billing/billable_items', actions: ['list', 'retrieve', 'create'], group: 'Billing', label: 'Billable Items', requiresPreview: true },
  coupons:                 { path: '/v1/coupons', actions: ['list', 'retrieve', 'create', 'update', 'delete'], group: 'Billing', label: 'Coupons' },
  credit_balance_summary:  { path: '/v1/billing/credit_balance_summary', actions: ['retrieve'], group: 'Billing', label: 'Credit Balances' },
  credit_balance_transactions: { path: '/v1/billing/credit_balance_transactions', actions: ['list', 'retrieve'], group: 'Billing', label: 'Credit Balance Transactions' },
  credit_grants:           {
    path: '/v1/billing/credit_grants', actions: ['list', 'retrieve', 'create', 'update'], group: 'Billing', label: 'Credit Grants',
    custom: {
      expire: { method: 'POST', subPath: '/v1/billing/credit_grants/:id/expire' },
      voidGrant: { method: 'POST', subPath: '/v1/billing/credit_grants/:id/void' },
    },
  },
  credit_notes:            {
    path: '/v1/credit_notes', actions: ['list', 'retrieve', 'create', 'update'], group: 'Billing', label: 'Credit Notes',
    custom: {
      voidNote: { method: 'POST', subPath: '/v1/credit_notes/:id/void' },
      preview:  { method: 'GET',  subPath: '/v1/credit_notes/preview' },
    },
  },
  customer_portal:         { path: '/v1/billing_portal/sessions', actions: ['create'], group: 'Billing', label: 'Customer Portal' },
  customer_portal_configs: { path: '/v1/billing_portal/configurations', actions: ['list', 'retrieve', 'create', 'update'], group: 'Billing', label: 'Customer Portal Configurations' },
  entitlements_active:     { path: '/v1/entitlements/active_entitlements', actions: ['list', 'retrieve'], group: 'Billing', label: 'Entitlements' },
  entitlements_features:   { path: '/v1/entitlements/features', actions: ['list', 'retrieve', 'create', 'update'], group: 'Billing', label: 'Features' },
  invoices:                {
    path: '/v1/invoices', actions: ['list', 'retrieve', 'create', 'update', 'delete', 'search'], group: 'Billing', label: 'Invoices',
    custom: {
      finalize:    { method: 'POST', subPath: '/v1/invoices/:id/finalize' },
      pay:         { method: 'POST', subPath: '/v1/invoices/:id/pay' },
      send:        { method: 'POST', subPath: '/v1/invoices/:id/send' },
      voidInvoice: { method: 'POST', subPath: '/v1/invoices/:id/void' },
      markUncollectible: { method: 'POST', subPath: '/v1/invoices/:id/mark_uncollectible' },
      upcoming:    { method: 'GET',  subPath: '/v1/invoices/upcoming' },
      upcomingLines: { method: 'GET', subPath: '/v1/invoices/upcoming/lines' },
      lines:       { method: 'GET',  subPath: '/v1/invoices/:id/lines' },
    },
  },
  invoice_items:           { path: '/v1/invoiceitems', actions: ['list', 'retrieve', 'create', 'update', 'delete'], group: 'Billing', label: 'Invoice Items' },
  meter_event_adjustments: { path: '/v1/billing/meter_event_adjustments', actions: ['create'], group: 'Billing', label: 'Meter Event Adjustments' },
  meter_events:            { path: '/v1/billing/meter_events', actions: ['create'], group: 'Billing', label: 'Meter Events' },
  meters:                  {
    path: '/v1/billing/meters', actions: ['list', 'retrieve', 'create', 'update'], group: 'Billing', label: 'Meters',
    custom: {
      deactivate: { method: 'POST', subPath: '/v1/billing/meters/:id/deactivate' },
      reactivate: { method: 'POST', subPath: '/v1/billing/meters/:id/reactivate' },
    },
  },
  prices:                  { path: '/v1/prices', actions: ['list', 'retrieve', 'create', 'update', 'search'], group: 'Billing', label: 'Prices' },
  promotion_codes:         { path: '/v1/promotion_codes', actions: ['list', 'retrieve', 'create', 'update'], group: 'Billing', label: 'Promotion Codes' },
  quotes:                  {
    path: '/v1/quotes', actions: ['list', 'retrieve', 'create', 'update'], group: 'Billing', label: 'Quotes',
    custom: {
      accept:    { method: 'POST', subPath: '/v1/quotes/:id/accept' },
      cancel:    { method: 'POST', subPath: '/v1/quotes/:id/cancel' },
      finalize:  { method: 'POST', subPath: '/v1/quotes/:id/finalize_quote' },
      pdf:       { method: 'GET',  subPath: '/v1/quotes/:id/pdf' },
      lineItems: { method: 'GET',  subPath: '/v1/quotes/:id/line_items' },
    },
  },
  subscriptions:           {
    path: '/v1/subscriptions', actions: ['list', 'retrieve', 'create', 'update', 'delete', 'search'], group: 'Billing', label: 'Subscriptions',
    custom: {
      cancel:    { method: 'DELETE', subPath: '/v1/subscriptions/:id' },
      resume:    { method: 'POST',   subPath: '/v1/subscriptions/:id/resume' },
      search:    { method: 'GET',    subPath: '/v1/subscriptions/search' },
    },
  },
  subscription_items:      {
    path: '/v1/subscription_items', actions: ['list', 'retrieve', 'create', 'update', 'delete'], group: 'Billing', label: 'Subscription Items',
    custom: {
      usageRecords: { method: 'POST', subPath: '/v1/subscription_items/:id/usage_records' },
      usageRecordSummaries: { method: 'GET', subPath: '/v1/subscription_items/:id/usage_record_summaries' },
    },
  },
  subscription_schedules:  {
    path: '/v1/subscription_schedules', actions: ['list', 'retrieve', 'create', 'update'], group: 'Billing', label: 'Subscription Schedules',
    custom: {
      cancel:  { method: 'POST', subPath: '/v1/subscription_schedules/:id/cancel' },
      release: { method: 'POST', subPath: '/v1/subscription_schedules/:id/release' },
    },
  },
  tax_ids:                 { path: '/v1/tax_ids', actions: ['list', 'retrieve', 'create', 'delete'], group: 'Billing', label: 'Tax IDs' },
  tax_rates:               { path: '/v1/tax_rates', actions: ['list', 'retrieve', 'create', 'update'], group: 'Billing', label: 'Tax Rates' },

  // ─── Checkout ───────────────────────────────────────────────────────
  checkout_sessions:       {
    path: '/v1/checkout/sessions', actions: ['list', 'retrieve', 'create'], group: 'Checkout', label: 'Checkout Sessions',
    custom: {
      expire:    { method: 'POST', subPath: '/v1/checkout/sessions/:id/expire' },
      lineItems: { method: 'GET',  subPath: '/v1/checkout/sessions/:id/line_items' },
    },
  },

  // ─── Claimable Sandboxes (preview) ──────────────────────────────────
  claimable_sandboxes:     { path: '/v2/sandboxes/claimable_sandboxes', actions: ['list', 'retrieve', 'create'], group: 'Claimable Sandboxes', requiresPreview: true, label: 'Claimable Sandboxes' },

  // ─── Climate ────────────────────────────────────────────────────────
  climate_orders:          {
    path: '/v1/climate/orders', actions: ['list', 'retrieve', 'create', 'update'], group: 'Climate', label: 'Climate Orders',
    custom: { cancel: { method: 'POST', subPath: '/v1/climate/orders/:id/cancel' } },
  },
  climate_products:        { path: '/v1/climate/products', actions: ['list', 'retrieve'], group: 'Climate', label: 'Climate Products' },
  climate_suppliers:       { path: '/v1/climate/suppliers', actions: ['list', 'retrieve'], group: 'Climate', label: 'Climate Suppliers' },

  // ─── Commerce ───────────────────────────────────────────────────────
  product_catalog_imports: { path: '/v2/commerce/product_catalog_imports', actions: ['list', 'retrieve', 'create'], group: 'Commerce', requiresPreview: true, label: 'Product Catalog Imports' },

  // ─── Connect ────────────────────────────────────────────────────────
  account_links:           { path: '/v1/account_links', actions: ['create'], group: 'Connect', label: 'Account Links' },
  accounts:                {
    path: '/v1/accounts', actions: ['list', 'retrieve', 'create', 'update', 'delete'], group: 'Connect', label: 'Accounts',
    custom: {
      reject:  { method: 'POST', subPath: '/v1/accounts/:id/reject' },
      persons: { method: 'GET',  subPath: '/v1/accounts/:id/persons' },
      capabilities: { method: 'GET', subPath: '/v1/accounts/:id/capabilities' },
    },
  },
  application_fees:        {
    path: '/v1/application_fees', actions: ['list', 'retrieve'], group: 'Connect', label: 'Application Fees',
    custom: { refunds: { method: 'GET', subPath: '/v1/application_fees/:id/refunds' } },
  },
  login_links:             { path: '/v1/accounts/:id/login_links', actions: ['create'], group: 'Connect', label: 'Login Links' },
  topups:                  {
    path: '/v1/topups', actions: ['list', 'retrieve', 'create', 'update'], group: 'Connect', label: 'Top-ups',
    custom: { cancel: { method: 'POST', subPath: '/v1/topups/:id/cancel' } },
  },
  transfers:               {
    path: '/v1/transfers', actions: ['list', 'retrieve', 'create', 'update'], group: 'Connect', label: 'Transfers',
    custom: { reversals: { method: 'GET', subPath: '/v1/transfers/:id/reversals' } },
  },

  // ─── Financial Connections ──────────────────────────────────────────
  fc_accounts:             {
    path: '/v1/financial_connections/accounts', actions: ['list', 'retrieve'], group: 'Financial Connections', label: 'Accounts',
    custom: {
      disconnect: { method: 'POST', subPath: '/v1/financial_connections/accounts/:id/disconnect' },
      refresh:    { method: 'POST', subPath: '/v1/financial_connections/accounts/:id/refresh' },
      owners:     { method: 'GET',  subPath: '/v1/financial_connections/accounts/:id/owners' },
      subscribe:  { method: 'POST', subPath: '/v1/financial_connections/accounts/:id/subscribe' },
      unsubscribe:{ method: 'POST', subPath: '/v1/financial_connections/accounts/:id/unsubscribe' },
    },
  },
  fc_sessions:             { path: '/v1/financial_connections/sessions', actions: ['retrieve', 'create'], group: 'Financial Connections', label: 'Sessions' },
  fc_transactions:         { path: '/v1/financial_connections/transactions', actions: ['list', 'retrieve'], group: 'Financial Connections', label: 'Transactions' },

  // ─── Identity ───────────────────────────────────────────────────────
  identity_verification_sessions: {
    path: '/v1/identity/verification_sessions', actions: ['list', 'retrieve', 'create', 'update'], group: 'Identity', label: 'Verification Sessions',
    custom: {
      cancel:  { method: 'POST', subPath: '/v1/identity/verification_sessions/:id/cancel' },
      redact:  { method: 'POST', subPath: '/v1/identity/verification_sessions/:id/redact' },
    },
  },
  identity_verification_reports: { path: '/v1/identity/verification_reports', actions: ['list', 'retrieve'], group: 'Identity', label: 'Verification Reports' },

  // ─── Issuing ────────────────────────────────────────────────────────
  issuing_authorizations:  {
    path: '/v1/issuing/authorizations', actions: ['list', 'retrieve', 'update'], group: 'Issuing', label: 'Authorizations',
    custom: {
      approve: { method: 'POST', subPath: '/v1/issuing/authorizations/:id/approve' },
      decline: { method: 'POST', subPath: '/v1/issuing/authorizations/:id/decline' },
    },
  },
  issuing_cardholders:     { path: '/v1/issuing/cardholders', actions: ['list', 'retrieve', 'create', 'update'], group: 'Issuing', label: 'Cardholders' },
  issuing_cards:           { path: '/v1/issuing/cards', actions: ['list', 'retrieve', 'create', 'update'], group: 'Issuing', label: 'Cards' },
  issuing_credit_ledger:   { path: '/v1/issuing/credit_ledger', actions: ['list', 'retrieve'], group: 'Issuing', label: 'Credit Ledger', requiresPreview: true },
  issuing_disputes:        {
    path: '/v1/issuing/disputes', actions: ['list', 'retrieve', 'create', 'update'], group: 'Issuing', label: 'Disputes',
    custom: { submit: { method: 'POST', subPath: '/v1/issuing/disputes/:id/submit' } },
  },
  issuing_settlements:     { path: '/v1/issuing/settlements', actions: ['list', 'retrieve', 'update'], group: 'Issuing', label: 'Settlements' },
  issuing_tokens:          { path: '/v1/issuing/tokens', actions: ['list', 'retrieve', 'update'], group: 'Issuing', label: 'Tokens' },
  issuing_transactions:    { path: '/v1/issuing/transactions', actions: ['list', 'retrieve', 'update'], group: 'Issuing', label: 'Transactions' },

  // ─── Money Management (v2 preview) ──────────────────────────────────
  financial_accounts:      { path: '/v2/money_management/financial_accounts', actions: ['list', 'retrieve', 'create', 'update'], group: 'Money Management', requiresPreview: true, label: 'Financial Accounts' },
  outbound_payments:       { path: '/v2/money_management/outbound_payments', actions: ['list', 'retrieve', 'create'], group: 'Money Management', requiresPreview: true, label: 'Outbound Payments' },
  outbound_transfers:      { path: '/v2/money_management/outbound_transfers', actions: ['list', 'retrieve', 'create'], group: 'Money Management', requiresPreview: true, label: 'Outbound Transfers' },
  payout_methods:          { path: '/v2/money_management/payout_methods', actions: ['list', 'retrieve', 'create'], group: 'Money Management', requiresPreview: true, label: 'Payout Methods' },
  recipient_verifications: { path: '/v2/money_management/recipient_verifications', actions: ['list', 'retrieve', 'create'], group: 'Money Management', requiresPreview: true, label: 'Recipient Verifications' },

  // ─── Orchestrated Commerce ──────────────────────────────────────────
  orchestrated_commerce_agreements: { path: '/v2/orchestrated_commerce/agreements', actions: ['list', 'retrieve', 'create'], group: 'Orchestrated Commerce', requiresPreview: true, label: 'Agreements' },

  // ─── Orders ─────────────────────────────────────────────────────────
  orders:                  { path: '/v1/orders', actions: ['list', 'retrieve', 'create', 'update'], group: 'Orders', label: 'Orders', requiresPreview: true },
  skus:                    { path: '/v1/skus', actions: ['list', 'retrieve', 'create', 'update', 'delete'], group: 'Orders', label: 'SKUs', requiresPreview: true },

  // ─── Paper Checks ───────────────────────────────────────────────────
  paper_checks:            { path: '/v2/paper_checks', actions: ['list', 'retrieve', 'create'], group: 'Paper Checks', requiresPreview: true, label: 'Paper Checks' },

  // ─── Payment Links ──────────────────────────────────────────────────
  payment_links:           {
    path: '/v1/payment_links', actions: ['list', 'retrieve', 'create', 'update'], group: 'Payment Links', label: 'Payment Links',
    custom: { lineItems: { method: 'GET', subPath: '/v1/payment_links/:id/line_items' } },
  },

  // ─── Payment Records ────────────────────────────────────────────────
  payment_records:         { path: '/v1/payment_records', actions: ['list', 'retrieve', 'create', 'update'], group: 'Payment Records', label: 'Payment Records', requiresPreview: true },

  // ─── Radar ──────────────────────────────────────────────────────────
  radar_reviews:           {
    path: '/v1/reviews', actions: ['list', 'retrieve'], group: 'Radar', label: 'Reviews',
    custom: { approve: { method: 'POST', subPath: '/v1/reviews/:id/approve' } },
  },
  radar_value_lists:       { path: '/v1/radar/value_lists', actions: ['list', 'retrieve', 'create', 'update', 'delete'], group: 'Radar', label: 'Value Lists' },
  radar_value_list_items:  { path: '/v1/radar/value_list_items', actions: ['list', 'retrieve', 'create', 'delete'], group: 'Radar', label: 'Value List Items' },

  // ─── Reporting ──────────────────────────────────────────────────────
  report_runs:             { path: '/v1/reporting/report_runs', actions: ['list', 'retrieve', 'create'], group: 'Reporting', label: 'Report Runs' },
  report_types:            { path: '/v1/reporting/report_types', actions: ['list', 'retrieve'], group: 'Reporting', label: 'Report Types' },

  // ─── Sigma ──────────────────────────────────────────────────────────
  sigma_scheduled_queries: { path: '/v1/sigma/scheduled_query_runs', actions: ['list', 'retrieve'], group: 'Sigma', label: 'Sigma Scheduled Queries' },

  // ─── Stripe Apps ────────────────────────────────────────────────────
  apps_secrets:            {
    path: '/v1/apps/secrets', actions: ['list', 'retrieve', 'create'], group: 'Stripe Apps', label: 'Secrets',
    custom: {
      find:        { method: 'GET',  subPath: '/v1/apps/secrets/find' },
      deleteWhere: { method: 'POST', subPath: '/v1/apps/secrets/delete_where' },
    },
  },

  // ─── Tax ────────────────────────────────────────────────────────────
  tax_calculations:        {
    path: '/v1/tax/calculations', actions: ['retrieve', 'create'], group: 'Tax', label: 'Tax Calculations',
    custom: { lineItems: { method: 'GET', subPath: '/v1/tax/calculations/:id/line_items' } },
  },
  tax_transactions:        {
    path: '/v1/tax/transactions', actions: ['retrieve', 'create'], group: 'Tax', label: 'Tax Transactions',
    custom: {
      createFromCalc: { method: 'POST', subPath: '/v1/tax/transactions/create_from_calculation' },
      createReversal: { method: 'POST', subPath: '/v1/tax/transactions/create_reversal' },
      lineItems:      { method: 'GET',  subPath: '/v1/tax/transactions/:id/line_items' },
    },
  },
  tax_registrations:       { path: '/v1/tax/registrations', actions: ['list', 'retrieve', 'create', 'update'], group: 'Tax', label: 'Tax Registrations' },
  tax_settings:            { path: '/v1/tax/settings', actions: ['retrieve', 'update'], group: 'Tax', label: 'Tax Settings' },

  // ─── Terminal ───────────────────────────────────────────────────────
  terminal_configurations: { path: '/v1/terminal/configurations', actions: ['list', 'retrieve', 'create', 'update', 'delete'], group: 'Terminal', label: 'Configurations' },
  terminal_connection_tokens: { path: '/v1/terminal/connection_tokens', actions: ['create'], group: 'Terminal', label: 'Connection Tokens' },
  terminal_locations:      { path: '/v1/terminal/locations', actions: ['list', 'retrieve', 'create', 'update', 'delete'], group: 'Terminal', label: 'Locations' },
  terminal_onboarding_links: { path: '/v1/terminal/onboarding_links', actions: ['create'], group: 'Terminal', label: 'Onboarding Links', requiresPreview: true },
  terminal_readers:        {
    path: '/v1/terminal/readers', actions: ['list', 'retrieve', 'create', 'update', 'delete'], group: 'Terminal', label: 'Readers',
    custom: {
      cancelAction:         { method: 'POST', subPath: '/v1/terminal/readers/:id/cancel_action' },
      processPaymentIntent: { method: 'POST', subPath: '/v1/terminal/readers/:id/process_payment_intent' },
      processSetupIntent:   { method: 'POST', subPath: '/v1/terminal/readers/:id/process_setup_intent' },
      refundPayment:        { method: 'POST', subPath: '/v1/terminal/readers/:id/refund_payment' },
      collectInputs:        { method: 'POST', subPath: '/v1/terminal/readers/:id/collect_inputs' },
    },
  },

  // ─── Third-Party Gift Cards ─────────────────────────────────────────
  gift_cards:              { path: '/v1/gift_cards/cards', actions: ['list', 'retrieve', 'create', 'update'], group: 'Third-Party Gift Cards', label: 'Gift Cards', requiresPreview: true },
  gift_card_transactions:  { path: '/v1/gift_cards/transactions', actions: ['list', 'retrieve', 'create'], group: 'Third-Party Gift Cards', label: 'Gift Card Transactions', requiresPreview: true },

  // ─── Webhook ────────────────────────────────────────────────────────
  webhook_endpoints:       { path: '/v1/webhook_endpoints', actions: ['list', 'retrieve', 'create', 'update', 'delete'], group: 'Webhook', label: 'Webhook Endpoints' },

  // ─── Workflows ──────────────────────────────────────────────────────
  workflow_definitions:    { path: '/v2/workflows/definitions', actions: ['list', 'retrieve', 'create', 'update'], group: 'Workflows', requiresPreview: true, label: 'Workflow Definitions' },
  workflow_executions:     { path: '/v2/workflows/executions', actions: ['list', 'retrieve', 'create'], group: 'Workflows', requiresPreview: true, label: 'Workflow Executions' },
};

/**
 * Resolve a (resource, action, id?) triple into an HTTP method + path.
 * Throws if the resource is unknown or the action isn't registered.
 */
export function resolveRoute(
  resource: string,
  action: Action | string,
  id?: string,
): { method: 'GET' | 'POST' | 'DELETE'; path: string; requiresPreview: boolean; apiVersion?: string } {
  const spec = STRIPE_RESOURCES[resource];
  if (!spec) throw new Error(`Unknown Stripe resource: ${resource}`);

  // Custom sub-action?
  if (spec.custom && spec.custom[action]) {
    const c = spec.custom[action];
    const path = c.subPath.replace(':id', id ?? '').replace(/\/+$/, '');
    if (c.subPath.includes(':id') && !id) throw new Error(`Action ${action} on ${resource} requires an id`);
    return { method: c.method, path, requiresPreview: !!spec.requiresPreview, apiVersion: spec.apiVersion };
  }

  if (!spec.actions.includes(action as Action)) {
    throw new Error(`Action "${action}" not supported on "${resource}". Allowed: ${spec.actions.join(', ')}`);
  }

  switch (action) {
    case 'list':
      return { method: 'GET', path: spec.path, requiresPreview: !!spec.requiresPreview, apiVersion: spec.apiVersion };
    case 'retrieve':
      if (!id) throw new Error(`retrieve on ${resource} requires an id`);
      return { method: 'GET', path: `${spec.path}/${id}`, requiresPreview: !!spec.requiresPreview, apiVersion: spec.apiVersion };
    case 'create':
      return { method: 'POST', path: spec.path, requiresPreview: !!spec.requiresPreview, apiVersion: spec.apiVersion };
    case 'update':
      if (!id) throw new Error(`update on ${resource} requires an id`);
      return { method: 'POST', path: `${spec.path}/${id}`, requiresPreview: !!spec.requiresPreview, apiVersion: spec.apiVersion };
    case 'delete':
      if (!id) throw new Error(`delete on ${resource} requires an id`);
      return { method: 'DELETE', path: `${spec.path}/${id}`, requiresPreview: !!spec.requiresPreview, apiVersion: spec.apiVersion };
    case 'search':
      return { method: 'GET', path: `${spec.path}/search`, requiresPreview: !!spec.requiresPreview, apiVersion: spec.apiVersion };
    default:
      throw new Error(`Unhandled action: ${action}`);
  }
}

/** Convenient list for UI: group → resources */
export function resourcesByGroup(): Record<string, Array<{ key: string; label: string; preview: boolean }>> {
  const groups: Record<string, Array<{ key: string; label: string; preview: boolean }>> = {};
  for (const [key, spec] of Object.entries(STRIPE_RESOURCES)) {
    const g = spec.group ?? 'Other';
    (groups[g] ??= []).push({ key, label: spec.label ?? key, preview: !!spec.requiresPreview });
  }
  for (const g of Object.keys(groups)) groups[g].sort((a, b) => a.label.localeCompare(b.label));
  return groups;
}
