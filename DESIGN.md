# Racio design contract

This is the authoritative design contract for Racio. It follows the
development-time Open Design principle: a design system is a readable contract
that shapes implementation and is reviewed against real tasks before shipping.
Open Design is not a runtime dependency. The interface is a personal-finance
workspace, not a marketing site.

Visual language is **shadcn/ui** (`radix-nova`, `baseColor: neutral`, CSS
variables, RTL enabled). Primitives live in `apps/web/components/ui` and are
added with the shadcn CLI. Domain layouts (ledger, import, planning) may keep
product class names, but those classes bind to the same shadcn tokens. Do not
invent a second palette, radius scale, or button language beside shadcn.

## Visual personality

Racio reads as a dense, quiet application: Geist sans on a neutral canvas,
hairline borders, modest radius, and filled primary actions that look like
standard shadcn buttons. There is no marketing serif, no peach editorial card,
and no pill chrome. Colour is functional (primary, muted, destructive, caution)
rather than decorative.

Financial information still gets visual priority over decoration. Debit and
credit are distinguished by sign, wording, and position, not by hue.

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

Map product meaning onto shadcn CSS variables (`--background`, `--foreground`,
`--card`, `--primary`, `--muted`, `--muted-foreground`, `--destructive`,
`--border`, `--input`, `--ring`). Do not introduce a parallel hex palette.

- **Background:** page canvas.
- **Foreground:** primary text.
- **Card:** grouped surfaces; ring/border, not drop-shadow theatre.
- **Muted / secondary:** nested panels, helper bands, inactive chrome.
- **Muted foreground:** helper text, eyebrows, captions. Never use `--muted`
  (a background) as a text colour.
- **Primary / primary foreground:** filled actions and selected emphasis.
- **Destructive:** blocking or irreversible states, always paired with wording
  or shape.
- **Caution:** uncertainty and review-needed states, always paired with wording
  or shape.
- **Border / input / ring:** hairlines and focus.

Light and dark themes remap the same roles (`html.dark` and `data-theme`).
Do not invert raw hex values ad hoc.

## Typography

UI and titles use Geist (`--font-geist`) with Noto Sans Arabic
(`--font-noto-sans-arabic`) for Arabic. There is no display serif. Hierarchy is
size and weight 400 / 500 / 600, not oversized editorial headlines.

Arabic uses a dedicated Arabic-capable stack and must be rendered and reviewed
at real sizes. Turkish uses a Latin stack that preserves dotted/dotless I.

Use tabular numerals for aligned financial values, normal numerals for prose,
and monospace only for genuine identifiers, source rows, or diagnostics.
Avoid all-caps as the default voice.

## RTL behaviour

Arabic sets the document `dir` to `rtl`; English and Turkish set `ltr`. Wrap
interactive Radix trees with shadcn `DirectionProvider`. Mirror directional
layout where meaning permits, including navigation order, chevrons, pagination,
and data-entry flow. Do not mirror currency symbols, source identifiers, code,
numeric grouping, or chart axes blindly. Use logical CSS properties
(`margin-inline`, `padding-inline`, `inset-inline`) and test mixed Arabic/Latin
content, negative amounts, dates, and long descriptions.

## Spacing and density

Use a 4px base: 4, 8, 12, 16, 20, 24, 32, 40. Page max-width is 1200px.
Easy mode favours breathing room, one main decision per view, and progressive
disclosure. Advanced mode may use a tighter table rhythm and denser metadata,
but never sacrifices scanability, focus visibility, or touch targets.

Cards use `--radius` (10px). Nested controls use the smaller radius tokens
from shadcn (`--radius-sm` / `--radius-md`). Shadows are optional and quiet
(`0 1px 2px`); do not elevate every panel.

## Shape and controls

Use shadcn primitives for new interactive UI: `Button`, `Card`, `Input`,
`Label`, `Badge`, `Separator`, `Dialog`. Keep adding from the same style
(`radix-nova`) rather than hand-rolling parallel controls.

Default controls are **at least 44px** tall (`min-h-11`), even when upstream
shadcn defaults to `h-8`. Pair a filled primary button with an outline or ghost
button when two actions share a row. Text links may underline on hover; do not
add trailing marketing arrows as a brand tic.

Navigation is a wrapping top bar: brand, links, sign-out as an outline button.
Unread counts use `Badge`, not a custom pill language.

## Forms and tables

Forms use visible labels, short help text, clear required state, inline errors,
keyboard order, and a review summary before a consequential action. Do not rely
on placeholder text as a label. Inputs use shadcn `Input`/`Label` tokens
(`--input`, `--border`) when added; existing product fields must match those
tokens.

Tables keep dates, descriptions, amounts, and currencies aligned. Raw and
normalised descriptions remain distinguishable. On mobile, preserve the primary
decision columns and expose secondary fields through an accessible detail row;
never force a tiny unreadable table. Sorting and filtering state is announced.

## Charts

Charts answer a named question and show period, currency, units, and source. A
table or text summary accompanies important chart values. Use direct labels,
accessible descriptions, and patterns or annotations in addition to colour.
Strokes use foreground on background. No axes theatre, no decorative fills. Do
not add a chart merely to fill a panel.

## States

- **Loading:** preserve layout, explain what is loading, and do not hide
  readable content behind an entrance animation.
- **Empty:** explain why the state is empty and offer the one relevant next
  action on a bordered card. Do not show fake financial fixtures.
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
Focus is a 2px ring using `--ring` with 2px offset.

## Explicitly banned patterns

- Decorative purple, teal, or blue gradients, neon, excessive blur, or
  glassmorphism.
- Marketing serif headlines, peach/sienna editorial cards, or 9999px pill
  buttons.
- A second colour system beside shadcn CSS variables.
- Using `--muted` or `--accent` as text colours.
- Generic AI-written slogans or a floating chatbot button used as decoration.
- Red and green as the only meaning indicators.
- Fake fixture names such as John Doe or Acme Corp.
- Treating RTL as only `direction: rtl`.
- Background blobs, full-page grids, and hard image seams.
- Interactive controls shorter than 44px on product flows.

## Visual review procedure

Before a UI change is complete, review the real flow at mobile and desktop in
Arabic, English, and Turkish. Check default, loading, empty, partial, error,
warning, and dark-mode states. Operate every control with a pointer and
keyboard. Verify alignment, text contrast, RTL mirroring, focus, zoom, reduced
motion, chart meaning, and that no content is clipped or hidden by animation.
Record the user task, evidence, and any intentional trade-off in the change
description. A clean screenshot is not sufficient without behavioural review.
