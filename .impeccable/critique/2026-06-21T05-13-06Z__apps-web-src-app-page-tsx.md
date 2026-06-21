---
target: apps/web/src/app/page.tsx
total_score: 24
p0_count: 1
p1_count: 3
timestamp: 2026-06-21T05-13-06Z
slug: apps-web-src-app-page-tsx
---
# 🔍 **Design Critique: FMEA Worksheet (apps/web/src/app/page.tsx)**

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3/4 | Missing loading indicators for long operations |
| 2 | Match System / Real World | 4/4 | Excellent FMEA terminology and domain language |
| 3 | User Control and Freedom | 2/4 | No undo, no clear way back to selection step |
| 4 | Consistency and Standards | 3/4 | Mix of Tailwind classes and inline styles |
| 5 | Error Prevention | 4/4 | Strong validation on export, smart defaults |
| 6 | Recognition Rather Than Recall | 2/4 | Too many columns visible at once, no progressive disclosure |
| 7 | Flexibility and Efficiency | 1/4 | No keyboard shortcuts, no bulk actions, no power user features |
| 8 | Aesthetic and Minimalist Design | 3/4 | Dense table is appropriate for engineering, but row structure is complex |
| 9 | Error Recovery | 2/4 | No undo functionality, save is stub |
| 10 | Help and Documentation | 0/4 | No help system, no contextual guidance, no tooltips |
| **Total** | | **24/40** | **Acceptable (significant improvements needed)**

**Rating bands**: 36–40 Excellent, 28–35 Good, 20–27 Acceptable, 12–19 Poor, 0–11 Critical

---

## Anti-Patterns Verdict

**LLM assessment**: ✅ **PASS - Does not look AI-generated**

The interface feels intentional and purpose-built for professional engineering work. Key strengths:
- Dark theme with accent color (#e85634) feels sophisticated, not generic
- TanStack Table implementation with tree structure is genuinely sophisticated
- Two-step flow (selection → table) shows thoughtful UX design
- Domain-specific FMEA terminology throughout
- Evidence-backed approach matches real engineering workflows
- No gradient text, glassmorphism, hero metrics, or identical card grids

**Deterministic scan**: ✅ **Clean** (0 findings)

The automated detector found no anti-patterns or AI slop tells in the markup.

**Visual overlays**: Not available - browser injection not attempted (no browser automation available in this environment).

---

## Overall Impression

This is a competent engineering workspace that clearly understands its domain. The two-step flow (select system → edit worksheet) is smart, and the tree structure grouping rows by component is exactly right for FMEA work. The evidence integration shows the product's core value proposition well.

**The single biggest opportunity**: The table overwhelms. 13 columns with inline editing is too much cognitive load for any human. The interface needs progressive disclosure—show what matters now, reveal the rest on demand. Engineers work in focused mode; don't make them scan 13 columns to find what they're editing.

**What doesn't work**: No way back to the selection step once you're in the table. No help system for new users. No keyboard shortcuts for power users. The save button is a stub.

---

## What's Working

1. **Two-step flow is smart** - Separating system selection from worksheet editing reduces initial cognitive load and lets users understand the scope before diving in.

2. **Tree structure by component** - Grouping FMEA rows by component with section headers is exactly how engineers think about systems. This is domain-appropriate information architecture.

3. **Evidence integration is clear** - The "Evidence" button that opens a dialog showing source-linked claims demonstrates the product's core value proposition: auditable, traceable reliability intelligence.

4. **Export validation is thoughtful** - Preventing export when required fields are incomplete shows respect for data quality and user intent.

5. **Domain terminology is accurate** - Using proper FMEA language (component, function, failure mode, effect, severity, occurrence, detection, RPN) throughout the interface builds trust with reliability engineers.

---

## Priority Issues

### **[P0] No help system or contextual guidance**
- **What**: Complete absence of help documentation, tooltips, or inline guidance
- **Why it matters**: New users (Jordan persona) will struggle to understand FMEA concepts, field meanings, and the relationship between evidence and rows. Engineering tools assume domain knowledge, but even experts benefit from field-level help.
- **Fix**: Add tooltips to column headers explaining FMEA concepts. Add a "?" help button that opens contextual documentation for the current workflow step. Consider inline help for critical fields (S/O/D scoring).
- **Suggested command**: `/impeccable harden apps/web/src/app/page.tsx`

### **[P1] Table has too many columns visible at once**
- **What**: 13 columns displayed simultaneously (checkbox, Function, Requirement, Failure Mode, Effect, S, Cause, O, Controls, D, RPN, Action, Evidence, Status)
- **Why it matters**: Cognitive load violation. Users must scan 13 columns to find what they're editing. This violates the "≤4 visible options at any decision point" rule. Engineers work in focused mode; this forces broad scanning.
- **Fix**: Implement progressive disclosure. Show core columns (Component, Failure Mode, Effect, S/O/D, Controls) by default. Hide Function, Requirement, Action, Evidence, Status behind a "More details" expand/collapse or column visibility toggle. Consider a "focus mode" that highlights only the fields being edited.
- **Suggested command**: `/impeccable layout apps/web/src/app/page.tsx`

### **[P1] No keyboard shortcuts or power user features**
- **What**: Complete absence of keyboard navigation shortcuts, bulk actions, or efficiency features for expert users
- **Why it matters**: Alex persona (power user) will abandon this interface. Engineers doing FMEA work need efficiency: tab to next cell, Ctrl+S to save, keyboard navigation for selects, bulk edit operations on multiple rows.
- **Fix**: Add keyboard shortcuts (Tab/Shift+Tab for cell navigation, Ctrl+S to save, Escape to close dialogs). Consider bulk select/edit operations (select multiple rows, apply same S/O/D scores). Add column-level keyboard navigation.
- **Suggested command**: `/impeccable harden apps/web/src/app/page.tsx`

### **[P1] No way to return to selection step**
- **What**: Once you're in the table view, there's no "back to selection" or "change system" button
- **Why it matters**: Users may realize they chose the wrong system or want to try a different approach. Being trapped in the table forces a page refresh to escape, which is poor UX. Violates "user control and freedom" heuristic.
- **Fix**: Add a "Change system" or "Start new analysis" button in the header that returns to the selection step. Preserve the current worksheet state or offer a warning about unsaved changes.
- **Suggested command**: `/impeccable layout apps/web/src/app/page.tsx`

### **[P2] Save functionality is a stub**
- **What**: Save button shows "FMEA saved successfully!" but doesn't actually persist data (comment says "TODO: Implement save functionality")
- **Why it matters**: Users expect save to work. If they return to the page and their work is lost, this is a critical trust violation. The validation exists but the persistence doesn't.
- **Fix**: Implement actual save to localStorage or Supabase. Add loading state during save. Add "last saved at" timestamp. Consider auto-save with visual indicator.
- **Suggested command**: `/impeccable harden apps/web/src/app/page.tsx`

### **[P2] Mix of Tailwind classes and inline styles**
- **What**: Inconsistent styling approach - some elements use Tailwind classes (`w-4 h-4 rounded border-gray-300`), others use inline styles (`style={{ display: "flex", gap: "12px" }}`), some use custom CSS classes
- **Why it matters**: Violates "consistency and standards" heuristic. Makes maintenance harder. Inline styles in JSX are hard to override and don't benefit from CSS variables for theming.
- **Fix**: Convert inline styles to custom CSS classes. Ensure all styling uses either Tailwind classes or custom CSS consistently. Use CSS variables for all color/spacing values.
- **Suggested command**: `/impeccable typeset apps/web/src/app/page.tsx`

### **[P2] No loading states for long operations**
- **What**: File upload, system loading, and export operations have no visible loading indicators
- **Why it matters**: Users don't know if the system is working or frozen. Export is especially problematic for large datasets. File upload processing is invisible.
- **Fix**: Add loading spinners or skeleton states for async operations. Show "Processing..." text for file uploads. Disable buttons during operations with loading state.
- **Suggested command**: `/impeccable harden apps/web/src/app/page.tsx`

### **[P3] Inline styles on dropdown buttons**
- **What**: Export dropdown buttons use inline styles with onMouseEnter/onMouseLeave handlers
- **Why it matters**: Inline styles are hard to maintain and don't use CSS variables. Event handlers in JSX for hover states are anti-pattern—use CSS :hover instead.
- **Fix**: Move inline styles to CSS classes. Replace onMouseEnter/onMouseLeave with CSS :hover pseudo-classes.
- **Suggested command**: `/impeccable typeset apps/web/src/app/page.tsx`

---

## Persona Red Flags

**Alex (Power User)** - Selected as primary persona for this data-heavy engineering interface:

- **Red Flags**:
  - No keyboard shortcuts for common actions (Tab navigation, Ctrl+S save, Escape to close dialogs)
  - No bulk operations (can't select multiple rows and apply same S/O/D scores)
  - One-item-at-a-time workflow where batch editing would be natural (applying same severity to all bearing rows)
  - No way to customize column visibility or save view preferences
  - Save is a stub—power users will immediately discover this limitation
  - No undo functionality—mistakes require manual correction

**Jordan (First-Timer)** - Selected because FMEA concepts may be unfamiliar even to engineers:

- **Red Flags**:
  - No help system or tooltips explaining FMEA fields
  - No contextual guidance for S/O/D scoring (what does a "7" in severity mean?)
  - No visible "back" or "undo" after making a selection
  - Technical terminology (RPN, FMEA) without inline explanation
  - No confirmation that actions succeeded (save just shows a notice, no persistent indicator)
  - Evidence dialog shows "Extracted FMEA fields" but doesn't explain what that means

---

## Minor Observations

- The component is hidden with `visually-hidden` class but still rendered as a column in the table structure—this is confusing architecturally
- The notice system is good but could be positioned more prominently for critical messages
- Footer links are appropriate (whitepaper, LinkedIn, contact)
- Skip-link is present for accessibility, which is excellent
- Evidence dialog has proper ARIA attributes (`role="dialog"`, `aria-modal="true"`, `aria-label="Close"`)
- Validation error message is clear and specific about what fields are missing
- The three template systems (turbofan, pump-train, wind-drivetrain) provide good on-ramps for different domains
- Dropzone for file upload is well-implemented with drag-and-drop and click-to-upload
- The RPN calculation is real-time, which is excellent—shows immediate feedback as S/O/D scores are entered

---

## Questions to Consider

- What if the table showed only the 6 core columns by default, with a "Show all columns" toggle for detail editing?
- Does every row need all 13 fields visible at once, or could Function, Requirement, and Action be hidden until explicitly requested?
- What would a keyboard-first version of this interface look like for power users who don't touch the mouse?
- Should the evidence dialog include the severity/occurrence/detection scoring reference tables to help users understand what scores to assign?
- Does the two-step flow actually help, or would a unified interface with collapsible sections be more efficient for experienced users?
