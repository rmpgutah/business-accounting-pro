# Advanced System Enhancement Design — 75 Features

**Date**: 2026-04-28
**Scope**: Three foundational layers + 75 distributed features that transform Business Accounting Pro from a data entry tool into an intelligent operations platform.

## Vision

Build infrastructure that compounds. Instead of 75 isolated features, three layered platforms each unlock dozens of capabilities:

```
   ┌────────────────────────────────────────────────┐
   │  LAYER 3: Predictive Intelligence              │
   ├────────────────────────────────────────────────┤
   │  LAYER 2: Reactive Cross-Module Engine         │
   ├────────────────────────────────────────────────┤
   │  LAYER 1: Cognitive Command Layer              │
   └────────────────────────────────────────────────┘
```

---

## Layer 1: Cognitive Command Layer (25 features)

A `Cmd+K` overlay that combines fuzzy search, natural-language entry, and action execution across all 35 modules.

### Architecture
- `CommandRegistry` singleton — modules register commands with metadata (name, params, executor, scope, frequency-tracking)
- `CommandPalette` React component — global overlay with fuzzy search across entities + actions
- `commandParser` — NL parser that converts strings like `"$45 lunch with john abc"` to draft expense entities
- `MacroRecorder` — records action sequences and replays them
- `custom_shortcuts` table — per-user keyboard shortcut customization
- `command_history` table — recent commands for ranking

### Sample commands
| Command | Effect |
|---------|--------|
| `inv 1024` | Open invoice #1024 |
| `pay overdue from acme` | Apply payment to overdue Acme invoices |
| `quote → invoice 1024` | Convert quote 1024 to invoice |
| `mark all draft as sent` | Bulk action |
| `forecast cash 90 days` | Open cash forecast |

### Features 1-25
1. Global Cmd+K command palette
2. Fuzzy entity search (invoices, clients, expenses, etc.)
3. Action registry per module
4. NL parser for quick-create
5. Recent commands list
6. Frequent commands surface first
7. Contextual commands per current view
8. Command parameters with autocomplete
9. Bulk command syntax
10. Multi-step command flows
11. Macro recorder + player
12. Custom keyboard shortcut editor
13. Cheatsheet overlay
14. Voice commands (optional)
15. Copy-as-command (turn any UI action into reusable command)
16. Macro sharing
17. Scheduled commands
18. Conditional commands
19. Batch commands via paste
20. Command palette plugins per module
21. Smart command interpretation
22. Command audit log
23. "Did you mean" suggestions
24. Undo/redo across the palette
25. Shortcut training mode

---

## Layer 2: Reactive Cross-Module Engine (25 features)

Declarative workflows that execute when events occur in any module — no code required.

### Architecture
- `EventBus` (main process) — modules emit semantic events (`invoice.paid`, `debt.escalated`, etc.)
- `WorkflowEngine` — declarative trigger/condition/action engine
- `SagaCoordinator` — multi-step operations with rollback
- `workflow_definitions` table — stored workflow specs (JSON-encoded triggers/conditions/actions)
- `workflow_executions` table — execution log for audit
- `workflow_event_log` table — event firing history

### Visual Workflow Builder
Lives in Automations module. Drag-drop UI for building workflows: pick trigger → add conditions → add actions across modules.

### Sample workflows
| Trigger | Conditions | Actions |
|---------|-----------|---------|
| `invoice.paid` | amount > $1k | log to GL, notify sales rep, update client LTV |
| `debt.created` | client tier = "Enterprise" | assign senior collector, custom dunning, schedule call |
| `expense.created` | category = "Travel" AND project_id present | bump project actuals, alert if over 90% |

### Features 26-50
26. Event bus with 30+ semantic event types
27. WorkflowEngine with trigger/condition/action AST
28. SagaCoordinator with rollback support
29. workflow_definitions table
30. workflow_executions log
31. Visual workflow builder UI
32. Workflow templates library
33. Cross-module entity auto-linking
34. Cascading status updates
35. Real-time UI refresh on related data changes
36. Live presence indicators per entity
37. Multi-step undo across modules
38. Workflow simulation (dry-run)
39. Workflow scheduling (cron triggers)
40. Conditional cascading
41. Workflow versioning
42. Workflow approval gates
43. Webhook triggers from external systems
44. Workflow execution metrics
45. Failure recovery with retry
46. Workflow debugging view
47. Workflow rate limiting
48. A/B test workflow variants
49. Workflow export/import
50. Workflow performance dashboard

---

## Layer 3: Predictive Intelligence Layer (25 features)

System learns from user behavior using local statistical methods (no external AI services). All inference runs on SQLite data using TypeScript implementations of moving averages, linear regression, k-means, Markov chains, and Bayesian classifiers.

### Architecture
- `IntelligenceService` (main process) — runs inference on schedule and on-demand
- `pattern_cache` table — caches learned patterns
- `predictions` table — stores forecasts with confidence intervals
- `anomaly_log` table — flags deviations from norms
- Algorithm modules: `anomalyDetection.ts`, `cashFlowForecast.ts`, `patternDetection.ts`

### What it learns
| Pattern type | Example use |
|-------------|-------------|
| Vendor frequency | "AT&T usually paid on the 5th — invoice not yet entered" |
| Expense categorization | New Office Depot expense → suggest "Office Supplies" |
| Client payment behavior | "Acme typically pays in 18d — invoice 1024 is late vs pattern" |
| Cash flow trajectory | "Based on 6 months, hit $5k cash on day 42" |
| Payroll anomalies | "John's pay is 15% above 6-month average — verify hours" |

### Features 51-75
51. Smart Defaults Everywhere
52. Auto-Categorization for new expenses
53. Anomaly Banner on records >2σ from norm
54. Cash Flow Forecast with 95% confidence interval
55. Predicted Payment Date per outstanding invoice
56. Late Payment Risk Score (0-100)
57. Quote Win Probability auto-suggestion
58. Vendor Spend Forecast
59. Recurring Pattern Detection
60. Duplicate Detection (invoices/expenses)
61. Budget Burn Forecast
62. Client Health Score auto-update
63. Tax Withholding Optimizer
64. Inventory Reorder Predictor
65. Seasonal Adjustment toggle on reports
66. Auto-Match Bank Transactions
67. Smart Search Result Ranking
68. Suggested Follow-Ups
69. Profit Margin Drift Alert
70. Project Budget Risk prediction
71. Collection Likelihood Score per debt
72. Pricing Suggestions on line items
73. Unusual Activity Alerts
74. Period Close Readiness predictor
75. AI Insights Panel on dashboard

### Privacy & Performance
- All inference runs locally — never sends data externally
- Pattern cache refreshes on schedule (nightly default)
- All predictions have confidence scores — never presented as certainty
- Smart defaults are suggestions — always user-overridable
- Anomaly flags alert but never block

---

## Implementation Order

8 phases, each independently shippable:

| # | Phase | Lines (est) | Key Output |
|---|-------|-------------|------------|
| 1 | Foundation: Event Bus + Command Registry | ~600 | EventBus.ts, CommandRegistry.ts |
| 2 | Cognitive Command Layer UI | ~1200 | CommandPalette.tsx + 25 commands |
| 3 | Macro recording + custom shortcuts | ~500 | Settings integration |
| 4 | WorkflowEngine + SagaCoordinator | ~800 | Workflow services |
| 5 | Workflow Builder UI | ~1500 | Automations module enhancement |
| 6 | IntelligenceService + pattern cache | ~800 | Statistical algorithms |
| 7 | Smart Defaults + Anomaly Detection | ~600 | Form integration |
| 8 | Predictive Dashboard Insights | ~600 | Insights panel |

**Total estimate:** ~6,600 new lines, ~30 modified files, 9 new tables, 18 new files.

## Database Migrations

```sql
CREATE TABLE workflow_definitions (...)
CREATE TABLE workflow_executions (...)
CREATE TABLE workflow_event_log (...)
CREATE TABLE pattern_cache (...)
CREATE TABLE predictions (...)
CREATE TABLE anomaly_log (...)
CREATE TABLE custom_shortcuts (...)
CREATE TABLE macros (...)
CREATE TABLE command_history (...)
```

## Files Affected

### New (18)
- `src/main/services/EventBus.ts`
- `src/main/services/CommandRegistry.ts`
- `src/main/services/WorkflowEngine.ts`
- `src/main/services/SagaCoordinator.ts`
- `src/main/services/IntelligenceService.ts`
- `src/main/services/algorithms/anomalyDetection.ts`
- `src/main/services/algorithms/cashFlowForecast.ts`
- `src/main/services/algorithms/patternDetection.ts`
- `src/renderer/components/CommandPalette.tsx`
- `src/renderer/components/CommandPaletteCommands.ts`
- `src/renderer/components/MacroRecorder.tsx`
- `src/renderer/components/AnomalyBanner.tsx`
- `src/renderer/components/SmartDefaultsHook.ts`
- `src/renderer/components/InsightsPanel.tsx`
- `src/renderer/modules/automations/WorkflowBuilder.tsx`
- `src/renderer/modules/automations/WorkflowList.tsx`
- `src/renderer/modules/automations/WorkflowExecutionLog.tsx`
- `src/renderer/lib/commandParser.ts`

### Modified (significant)
- `src/main/database/index.ts` (9 new table migrations)
- `src/main/ipc/index.ts` (~15 new handlers)
- `src/renderer/lib/api.ts` (~15 new API methods)
- `src/renderer/App.tsx` (mount CommandPalette, register Cmd+K)
- `src/renderer/modules/automations/index.tsx` (workflow builder)
- `src/renderer/modules/dashboard/Dashboard.tsx` (insights panel)
- 12+ form/list components for smart defaults

## Risk Mitigations
- In-process event bus — no external message broker
- Pure TypeScript ML/statistical methods — no Python/external services
- Async workflow execution with timeout safeguards
- Smart defaults are suggestions, never auto-apply destructive changes
- Anomaly flags alert but don't block
- Pattern cache invalidates on schema changes
- All features are additive — existing flows continue working

## Result

🧠 Cognitive Command Layer — any action from anywhere, macros, custom shortcuts
⚡ Reactive Engine — events flow between modules; user-built workflows
🔮 Predictive Intelligence — learns patterns, forecasts, suggests defaults, detects anomalies

The app graduates from data entry tool to **intelligent operations platform**.
