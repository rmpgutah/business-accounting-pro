# Collections Letter Templates — Formal Legal-Pleading Style

Date: 2026-07-11

## Problem

The prior pass (see `2026-07-11-collections-letter-visual-redesign-design.md`, already implemented and merged) fixed structural bugs and polished the Equipment Agreement and Employment Agreement PDF generators to a "polished business-letter" standard. The user now wants these documents — especially the Equipment Agreement, which becomes a collections/court exhibit when equipment is stolen or not returned — to read as formal, professionally drafted legal instruments rather than personal correspondence.

Both generators (`employee:generate-equipment-agreement` and `employee:generate-employee-agreement` in `src/main/ipc/index.ts`) currently open with a personal-letter framing: a date, an addressee block, a "RE:" line, and a "Dear Terry," salutation, followed by a sentence starting "This letter constitutes a formal agreement...". That framing is appropriate for correspondence but reads as informal for a signed contract that may be scrutinized by opposing counsel or a court.

## Goals

- Replace the personal-letter opening (date/addressee/RE line/salutation) with a formal caption block: document title, both parties named, effective date — the way an actual contract or pleading identifies itself.
- Replace the letter-style opening sentence with a standard contract recital clause.
- Switch body typography from Georgia to Times New Roman, the conventional legal-document typeface.
- Give every numbered clause a true hanging indent (wrapped lines align under the clause text, not under the number) instead of the current bold run-in number.
- Apply consistently to both documents, keeping each template's `<style>`/markup independently maintained (no shared CSS file), per the established pattern from the prior pass.

## Non-Goals

- No changes to any of the 20 (Equipment Agreement) or 31 (Employment Agreement) numbered operative clauses' actual legal text — dollar amounts, obligations, penalty terms stay byte-identical. Only the letter-opening boilerplate (which is framing text, not a numbered clause) and typography are in scope.
- No changes to the equipment tables, their columns, or color-coding — already redesigned in the prior pass, untouched here.
- No changes to signature-field structure, e-sign metadata, or the footer beyond the font-family cascade change.
- No left-margin line numbers, no double-spacing, no case-style caption ("IN THE MATTER OF...") — this is a contract-formality upgrade, not a simulated court filing (per explicit decision during design).
- No shared/extracted template file between the two generators.

## Design

### 1. Caption block replaces letter framing (both templates)

In each handler, the four existing blocks:

```html
  <!-- Date -->
  <div class="letter-date">...</div>

  <!-- Addressee -->
  <div class="addressee">
    ...
  </div>

  <!-- RE line -->
  <div class="re-line">RE: ...</div>

  <!-- Salutation -->
  <div class="salutation">Dear ${empName.split(' ')[0] || empName},</div>
```

are replaced by a single caption block: a top-and-bottom-bordered, centered section showing the document title, "Between [Employer] and [Employee]", and the effective date — plus the employee's title/address/contact info (previously in the addressee block) folded into the recital paragraph that follows, so no information is lost.

New CSS classes: `.caption-block` (border-top/border-bottom, centered, padding), `.caption-title` (bold, uppercase, the document name), `.caption-parties` and `.caption-date` (smaller, muted, the "Between X and Y" / date lines) — added once per template's own `<style>` block, following the same "each template owns its full independent styling" pattern as the rest of this file.

### 2. Recital paragraph replaces the letter-style opening sentence

The existing opening sentence:
> "This letter constitutes a formal agreement between {Employer} ("Employer") and {Employee} ("Employee"), effective as of {date}, regarding the issuance, use, care, and return of company-owned equipment. By acknowledging this document, the Employee agrees to the terms and conditions set forth herein."

becomes a contract recital that also carries the employee's title/address (moved out of the deleted addressee block):
> "This Agreement is made and entered into as of {date}, by and between {Employer} ("Employer") and {Employee}, {title}, of {address} ("Employee"), regarding the issuance, use, care, and return of company-owned equipment (this "Agreement"). The parties agree as follows:"

The Employment Agreement's opening gets the equivalent treatment, adapted to its own current wording ("This letter constitutes a formal employment agreement..." → "This Agreement is made and entered into as of {date}, by and between {Employer} ("Employer") and {Employee}, {title if any}, of {address} ("Employee") (collectively, the "Parties"). The Parties agree as follows:").

This is boilerplate introductory framing, not one of the numbered operative clauses — in scope to rewrite per the Non-Goals boundary above.

### 3. Typography: Georgia → Times New Roman

In both templates' `<style>` blocks, the `body` rule's `font-family` changes from `'Georgia', 'Times New Roman', serif` to `'Times New Roman', Times, serif` — Georgia dropped entirely, Times New Roman becomes primary with `Times` (the Linux/older-system equivalent) and generic `serif` as fallbacks. This is the single font-family declaration each template's body inherits from, so this one-line change retypesets the whole document.

### 4. Hanging indent for numbered clauses

Every clause is already marked up identically as `<p><strong>N. Title.</strong> body text...</p>` (confirmed — no clause is exempt from this pattern in either template). Rather than touching ~50 individual clause paragraphs, a single new CSS rule targets the pattern structurally:

```css
.terms p { padding-left: 28px; text-indent: -28px; }
```

The Equipment Agreement's clause list is wrapped in `<div class="terms">` (its `.terms p` rule already exists for justification/margin — the hanging-indent properties are added to that same rule). The Employment Agreement's clause list is wrapped in `<div class="section">` instead (a different class, confirmed by inspecting both templates) — its `.section p` rule gets the identical hanging-indent properties added.

This produces a true hanging indent: the clause number sits flush left, and when a clause's text wraps to a second line, that line aligns under the clause's title text (28px in), not under the number — the standard contract-paragraph convention.

### 5. Signature block wording (light touch)

The existing signature-section intro text (if any exists as a static string — verified during implementation) gets minor tightening toward contract-closing phrasing (e.g. "By signing below, the parties acknowledge and agree to the terms of this Agreement." stays functionally identical, wording adjusted only if it reads as letter-style rather than contract-style). This is boilerplate, not a numbered clause, so in scope; if the existing wording already reads as contract-appropriate, no change is needed here — the implementer should not force a change for its own sake.

## Testing

- Regenerate both PDFs (via the app, per the same manual-verification limitation noted in the prior pass — Electron IPC/SQLite can't be driven headlessly) and confirm:
  - No "Dear [Name]," salutation, no bare "RE:" line, no bare date-then-address block remains in either document.
  - A caption block appears with the correct document title, both party names, and effective date.
  - Body text renders in Times New Roman (not Georgia).
  - A clause whose text wraps to 2+ lines shows its continuation lines aligned under the clause title, not under the clause number.
  - All 20 (Equipment Agreement) / 31 (Employment Agreement) numbered clauses are still present with unchanged text (spot-check several clauses' body text against the pre-change version).
  - The equipment tables (from the prior pass) are visually unaffected except for inheriting the new Times New Roman body font on any prose around them.
- `npm run typecheck` must pass.
- No changes to `src/main/database/schema.sql` or IPC channel signatures.
