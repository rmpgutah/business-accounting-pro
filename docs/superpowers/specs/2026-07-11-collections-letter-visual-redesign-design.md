# Collections Letter Templates — Structural Fix & Visual Redesign

Date: 2026-07-11

## Problem

Two legal-document HTML generators in `src/main/ipc/index.ts` produce PDFs used for employee onboarding and — per the user's stated purpose — as exhibits when a departing employee's unreturned/damaged equipment is referred to collections:

- `employee:generate-employee-agreement` (~line 16668) — the Employment Agreement letter.
- The equipment-agreement handler (~line 16380) — the Equipment Agreement letter, which carries the penalty schedule that gives collections a monetary basis to pursue.

Two categories of defect, found by reading the generated PDFs and the source template:

1. **Structural (content-integrity) bugs**, independent of styling:
   - Equipment Agreement: a second batch of clauses was appended without renumbering — sections 14, 15, and 16 each appear **twice** with entirely different content (e.g. one "14. Software Misconduct..." and a separate, later "14. Governing Law..."). Verified via `grep` that nothing in the template cross-references sections 14/15/16 by number, so renumbering is a pure, content-preserving fix.
   - Employment Agreement: otherwise numbered correctly 1–29 straight through, but the final clause is mislabeled "31." instead of "30." (isolated off-by-one; confirmed no cross-reference to "Section 31" elsewhere).
   A document handed to a collections agency or court with duplicate/skipped section numbers reads as sloppy and undermines its credibility as a properly executed agreement.

2. **Visual/layout defects**:
   - The Equipment Agreement's item tables (the summary table and the "Equipment Schedule — Detailed Itemization" table) don't use `table-layout: fixed`, so column widths are browser-negotiated. Long unbreakable tokens (11-digit serial numbers) combined with a combined "Status · Date" cell (e.g. `"Stolen · March 4, 2026"`) create overflow/wrapping risk, especially as more equipment rows are added.
   - **Confirmed by reading the actual generated PDF (page 12):** the "Detailed Itemization" table's `<thead>` declares only 6 columns (`#`, Item Description, Serial Number, Model/SKU, Condition at Issuance, Date Issued), but its `<tbody>` reuses the same 8-column `equipmentRows` string as the summary table (which also includes Value and Status). The result: the "Value" data (`$729.99`) renders under the "Date Issued" header, and the actual date plus Status spill into two unlabeled extra columns — a real, visible column/header mismatch, not just a spacing issue.
   - Letterhead, section-heading spacing, and signature-block rhythm are functional but not polished — loose spacing, a plain single-weight rule under the company name, and status information isn't visually distinguished (a "Stolen" item reads identically to a "Returned" item).

## Goals

- Fix both numbering defects so each document reads as a single, professionally prepared, sequentially numbered legal instrument.
- Redesign the equipment tables so they cannot overflow regardless of content length, with status visually distinguished (color-coded) from date.
- Polish letterhead, heading, and signature-block typography/spacing to a "well-designed business letter" standard (confirmed direction via mockup) — not a court-pleading redesign.
- Keep the two templates independently styled (no shared CSS extraction) per explicit choice — this pass improves each in place.

## Non-Goals

- No changes to any dollar amount, penalty tier, obligation, or other substantive legal wording in either document.
- No restructuring of clause *order* or *content* — only clause *numbers* where they're factually wrong.
- No shared/extracted template file — each generator keeps its own inline `<style>` block.
- No changes to the Employee Agreement's non-numbering content or the Equipment Agreement's Monetary Penalty Schedule table (already well-designed — this becomes the visual reference for the redesigned item tables).

## Design

### 1. Equipment Agreement — clause renumbering

In the template literal (~lines 16610–16626), the second-batch headings get renumbered, content and order otherwise untouched:

| Current heading | New heading |
|---|---|
| `14. Governing Law &amp; Jurisdiction.` | `17. Governing Law &amp; Jurisdiction.` |
| `15. Entire Agreement &amp; Amendments.` | `18. Entire Agreement &amp; Amendments.` |
| `16. Severability &amp; Waiver.` | `19. Severability &amp; Waiver.` |
| `17. Acknowledgment of Penalties.` | `20. Acknowledgment of Penalties.` |

The first-batch `14. Software Misconduct...`, `15. Wage-Law Compliance...`, `16. Acknowledgment of Receipt...` are unchanged (they're the correct, first occurrence of those numbers). Result: clean 1→20 sequence, verified by re-running the grep-for-duplicates check after the edit.

### 2. Employment Agreement — final clause number fix

Single-line change: `31. Governing Law, Venue &amp; Severability.` → `30. Governing Law, Venue &amp; Severability.` (~line 16727 region). No other clause numbers change.

### 3. Equipment table redesign

Both the summary table (Equipment Issued, ~line 16455) and the detailed itemization table (~line 16631) switch from an unconstrained `<table>` to a fixed-layout table matching the existing Monetary Penalty Schedule table's visual language (dark header row, high/medium-severity row tinting) for consistency within the same document:

- Add `table-layout: fixed;` plus an explicit `<colgroup>` sized to each table's actual columns. Both tables become 9 columns: `#`, Item, Serial, Model, Condition, Value, Date Issued, Status, Status Date — Status split from its date, each getting its own column instead of a combined `"Stolen · March 4, 2026"` string. The Detailed Itemization table's `<thead>` gets the two headers (Value, Status/Status Date) it was previously missing, so its columns finally match the data it already renders.
- Serial-number cells get `word-break: break-all;` so an unbroken 11+ digit string can never force the table wider than its container.
- Status cell gets a semantic background/text tint reusing the same red/amber hex values already defined for `.penalty-high`/`.penalty-medium` rows in this same stylesheet (`#fef2f2`/`#dc2626` for Stolen-type dispositions, `#fffbeb`/`#d97706` for Damaged-type, default/no tint for Returned/Active) — this requires the disposition-label helper (`dispositionLabel`, already computing the status string) to also classify severity so the right class gets applied per row; a small helper function maps the existing status vocabulary (stolen/damaged/returned/active/lost — whatever the current `dispositionLabel` produces) to `high`/`medium`/`none`.

### 4. Typography and letterhead polish (both templates)

- Letterhead: increase `letter-spacing` on the company name slightly, tighten the address line's spacing, replace the current single `border-bottom: 2px solid #111` under the letterhead with a two-weight rule (a `1.5px` dark line directly under the text, `0.5px` lighter rule a few pixels below) matching the approved mockup.
- Section headings (`h2`): reduce `margin-top` slightly for tighter, more consistent rhythm between sections.
- Signature block: confirm consistent spacing above the signature line across both templates (currently both already use `margin-top: 36px` — verify visually after other changes don't disturb it, adjust only if the redesigned tables change the page-break flow).
- Footer: match its rule weight to the (revised) letterhead rule for a bookended look.

Both templates' `<style>` blocks are edited independently and in full — no new shared file, so each generator's HTML stays self-contained and copy-paste-portable the way the codebase already treats these large inline generators (consistent with `CLAUDE.md`'s established pattern for this file).

## Testing

- Regenerate both PDFs for a test employee/equipment record (via the existing `employee:generate-employee-agreement` and equipment-agreement IPC handlers, exercised from the running app) and visually confirm:
  - Equipment Agreement section numbers run 1→20 with no duplicates.
  - Employment Agreement's final section reads "30." not "31.".
  - Equipment tables render within page margins with a long (11+ digit) serial number and a long combined item name, at both 1 row and 5+ rows, with no horizontal overflow.
  - Stolen/Damaged/Returned status cells are visually distinct by color.
- `npm run typecheck` must pass (template-literal edits inside an existing `.ts` file, no new types).
- No changes to `src/main/database/schema.sql` or IPC channel signatures — this is a pure content/presentation edit inside two existing handlers.
