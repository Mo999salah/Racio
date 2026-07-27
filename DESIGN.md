# Racio design contract

This is the authoritative design contract for Racio. It follows the
development-time Open Design principle: a design system is a readable contract
that shapes implementation and is reviewed against real tasks before shipping.
Open Design is not a runtime dependency. The interface is a personal-finance
workspace, not a marketing site.

## Visual personality

Racio is calm, precise, trustworthy, and quietly modern. It should feel like a
well-made ledger with humane guidance: serious about numbers, warm enough for
ordinary users, and never theatrical. Financial information gets visual
priority over decoration. Surfaces use a restrained ink-and-paper palette with
one muted mineral accent and a distinct warning tone; no decorative colour
competition.

The visual signature is a **ledger seam**: a small, purposeful alignment system
that connects period, source, and confidence information across summaries and
tables. It is expressed through aligned baselines, subtle ruled grouping, and
source-aware detail rather than cards, glows, or ornament.

## Information hierarchy

1. What changed or needs a decision.
2. The amount, period, and currency that explain it.
3. The source and confidence that make it trustworthy.
4. The next safe action.
5. Raw or technical detail, progressively disclosed.

Every screen names its task in plain language. Large numbers always have a
label, period, currency, and comparison context. Warnings are actionable and
never hidden by easy mode.

## Colour roles

Use semantic roles, not arbitrary component colours:

- **Canvas:** warm-neutral ink-tinted surface, never generic UI grey.
- **Surface:** a close tonal step for work areas and focused regions.
- **Ink:** high-contrast dark text; never low-contrast charcoal on dark surfaces.
- **Muted ink:** secondary metadata that still meets accessible contrast.
- **Accent:** muted mineral teal used for focus, selection, and one meaningful
  positive emphasis, not sprayed on every label.
- **Caution:** amber for uncertainty and review-needed states.
- **Critical:** a deep red-brown for destructive or blocking states.
- **Positive:** blue-green may support success but meaning is never colour-only.

Light and dark themes remap roles rather than invert raw hex values. Red and
green are never the only indicators: pair colour with text, icon shape, or
status wording. No decorative purple/blue gradient, neon, or ambient glow.

## Typography

Use a licensed or self-hosted characterful display face only if a later brand
decision selects one; the foundation uses the system sans stack as a neutral
workhorse instead of cycling through generic Google fonts. Body copy prioritises
legibility and stable numeral widths. Arabic uses a dedicated Arabic-capable
fallback stack and must be rendered and reviewed at real sizes, not assumed to
match Latin metrics. Turkish uses a Latin stack that preserves dotted/dotless I.

Use tabular numerals for aligned financial values, normal numerals for prose,
and monospace only for genuine identifiers, source rows, or diagnostics.
Avoid all-caps as the default voice and never use tracking as decoration.

## RTL behaviour

Arabic sets the document `dir` to `rtl`; English and Turkish set `ltr`. Mirror
directional layout where meaning permits, including navigation order,
chevrons, pagination, and data-entry flow. Do not mirror currency symbols,
source identifiers, code, numeric grouping, or chart axes blindly. Use logical
CSS properties (`margin-inline`, `padding-inline`, `inset-inline`) and test
mixed Arabic/Latin content, negative amounts, dates, and long descriptions.

## Spacing and density

Use a 4px base scale with 8px as the common rhythm: 4, 8, 12, 16, 24, 32, 40,
48, 64. Content has a deliberate gutter from every viewport and container edge.
Easy mode favours 16-24px breathing room, one main decision per view, and
progressive disclosure. Advanced mode may use 8-16px table rhythm and denser
metadata, but never sacrifices scanability, focus visibility, or touch targets.

Avoid making every content unit a card. Group related information through
alignment, surface tone, and spacing first; reserve a contained panel for a
real boundary such as a form, warning, or independent workflow.

## Forms and tables

Forms use visible labels, short help text, clear required state, inline errors,
keyboard order, and a review summary before a consequential action. Do not rely
on placeholder text as a label.

Tables keep dates, descriptions, amounts, and currencies aligned. Raw and
normalised descriptions remain distinguishable. On mobile, preserve the primary
decision columns and expose secondary fields through an accessible detail row;
never force a tiny unreadable table. Sorting and filtering state is announced.

## Charts

Charts answer a named question and show period, currency, units, and source. A
table or text summary accompanies important chart values. Use direct labels,
accessible descriptions, and patterns or annotations in addition to colour.
Do not add a chart merely to fill a panel.

## States

- **Loading:** preserve layout, explain what is loading, and do not hide
  readable content behind an entrance animation.
- **Empty:** explain why the state is empty and offer the one relevant next
  action; do not show fake financial fixtures.
- **Partial data:** identify the missing source or period and what remains
  trustworthy.
- **Error:** state what failed, whether data changed, and the safe recovery.
- **Reconciliation warning:** show the discrepancy, source values, currency,
  tolerance or rule, and the decision required.
- **Multi-currency:** show original values first and conversions separately with
  rate date/source; never collapse currencies silently.

## Responsive priorities

Mobile prioritises the next decision, amount/currency, date, and source warning.
Controls remain reachable with one hand, target size is at least 44px, and
horizontal overflow is deliberate and labelled. Desktop can expose comparison
and advanced metadata without turning every page into a sidebar dashboard.

## Accessibility

Meet WCAG 2.2 AA for contrast, keyboard operation, visible focus, semantics,
labels, error association, reduced motion, and screen-reader announcements.
Respect `prefers-reduced-motion`. Never communicate state by colour alone. Test
Arabic and mixed-script content with keyboard, zoom, and a screen reader.

## Explicitly banned patterns

- Decorative purple or blue gradients, neon, excessive blur, or unnecessary
  glassmorphism.
- Oversized marketing heroes inside the application or generic centred SaaS
  layouts.
- Three identical cards in a row by default, card-everything layouts, and
  excessively rounded components.
- Random icons inside coloured circles, decorative charts, or large numbers
  without context.
- Generic AI-written slogans, floating chatbot buttons used as decoration, or
  a sidebar used only because another SaaS product has one.
- Red and green as the only meaning indicators.
- Fake fixture names such as John Doe or Acme Corp.
- Repeating the same layout on every page, dense technical language in easy
  mode, or treating RTL as only `direction: rtl`.
- Glowy pill buttons, hover boops, animated underlines, floating cards, full-
  page grids, background blobs, hard image seams, and default all-around
  shadows.

## Visual review procedure

Before a UI change is complete, review the real flow at mobile and desktop in
Arabic, English, and Turkish. Check default, loading, empty, partial, error,
warning, and dark-mode states. Operate every control with a pointer and
keyboard. Verify alignment, text contrast, RTL mirroring, focus, zoom, reduced
motion, chart meaning, and that no content is clipped or hidden by animation.
Record the user task, evidence, and any intentional trade-off in the change
description. A clean screenshot is not sufficient without behavioural review.
