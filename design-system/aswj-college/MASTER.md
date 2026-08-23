# ASWJ College interface system

**Branch:** `dev`
**Direction:** Calm institutional welcome and high-clarity operations console
**Style:** Minimal Swiss-inspired layouts, restrained motion, standard information density

This file records the design decisions used by the public registration, Student Portal and administration interfaces. Page-specific files under `pages/` may override it.

## Principles

1. Trust before decoration: deep teal establishes hierarchy; gold is used only for emphasis and selection.
2. Real data stays authoritative: class names, weekdays, times and locations come from class setup.
3. One clear primary action per task.
4. Minimum 44px interactive targets and 16px form text.
5. Visible labels, focus states, errors and status feedback.
6. Responsive from 320px upward, with explicit checks at 375px, 390px and 1440px.
7. The official ASWJ logo stays unaltered on a white clear-space panel.

## Colour tokens

| Role | Value | Usage |
| --- | --- | --- |
| Canvas | `#f4f7f5` | App background |
| Surface | `#ffffff` | Cards, forms, tables |
| Surface soft | `#edf4f1` | Secondary controls |
| Ink | `#16302d` | Primary text |
| Muted ink | `#526862` | Secondary text; passes AA on white |
| Border | `#d5e0dc` | Standard separators |
| Primary teal | `#0b5d56` | Primary buttons and highlights |
| Primary hover | `#084942` | Button hover |
| Deep teal | `#063c38` | Branded panels and admin navigation |
| Gold | `#c8951f` | Progress and selected accents |
| Focus on light | `#9b6a00` | Keyboard focus ring on white/canvas |
| Gold surface | `#fff5d6` | Warm informational callouts |
| Danger | `#922f36` | Destructive actions and errors |
| Success | `#17633d` | Positive status |

Verified core contrast pairs:

- White on primary teal: approximately `7.7:1`.
- Primary ink on white: approximately `14:1`.
- Muted ink on white: approximately `6:1`.
- Dark ink on gold: approximately `5.6:1`.
- Dark focus ring against white: approximately `4.7:1`.
- Form boundary against white: approximately `3.3:1`.

## Typography

- Use the system stack: `ui-sans-serif, "Avenir Next", "Segoe UI", Arial, sans-serif`.
- Do not depend on a network font for critical UI rendering.
- Body: `16px`, line-height `1.55`.
- Supporting copy: never below `12px`; operational body copy is normally `13–15px`.
- Headings use tighter line-height and negative letter-spacing for clear hierarchy.
- Keep paragraph measures near 60–75 characters where practical.

## Spacing and shape

| Token | Value |
| --- | --- |
| Tight | `4px` |
| Small | `8px` |
| Standard | `16px` |
| Large | `24px` |
| Section | `30–48px` |
| Small radius | `10px` |
| Card radius | `16px` |
| Branded panel radius | `24–28px` |

Shadows are subtle on operational cards and stronger only on branded shells and dialogs.

## Components

### Buttons

- Minimum height: `44px`.
- Primary: white on primary teal.
- Secondary: dark teal on a soft teal surface.
- Outline: dark teal with a visible neutral border.
- Hover changes colour and may move at most `1px`; active state returns to rest.
- Disabled controls retain their label and use reduced opacity.

### Forms

- Inputs, selects and textareas are at least `48px` high with `16px` text.
- Labels are persistent and programmatically associated.
- Helper text and inline errors are connected with `aria-describedby`.
- Errors use a focusable summary with links to invalid fields.
- Student DOB uses separate Day, Month and Year controls and is composed server-side.
- Class selection uses one radio-card group; it never duplicates the same choices in a second select.

### Cards and statuses

- Non-interactive cards do not imply clickability.
- Selected cards use a teal border plus a gold inset rail.
- Status badges use tinted surfaces with dark text, not white text on bright fills.

### Tables

- Desktop tables use restrained density and sticky headers.
- Dense mobile tables scroll inside a labelled, keyboard-focusable region.
- The document itself must never overflow horizontally.

### Navigation

- Desktop admin uses a persistent deep-teal sidebar with an active route indicator.
- Mobile admin uses a compact two-row header with a horizontally scrollable navigation strip and visible overflow cue.
- Sign out remains reachable on mobile.
- Every page provides a skip link and `main-content` focus target.

### Dialogs

- Use `role="dialog"`, `aria-modal="true"` and an associated title.
- Fit within the dynamic viewport and scroll internally.
- Mobile dialogs use a bottom-sheet presentation with a sticky action footer.

## Public and Student Portal patterns

- Public registration and authentication use a responsive two-panel composition.
- On mobile, the branded panel stacks above the task content.
- The Student Portal uses a compact deep-teal header, gold detail, readable summary cards and explicit status sections.
- Registration uses numbered sections without introducing a stateful multi-step form.
- Class schedule copy is assembled only from `day_of_week`, `start_time`, `end_time` and `location` returned by the registration options RPC.

## Motion

- Only hover, focus, pressed, navigation and dialog state receive motion.
- Use opacity, colour and transforms only; avoid layout-shifting scale effects.
- All authored motion is neutralised under `prefers-reduced-motion: reduce`.

## Delivery checklist

- [ ] Production build and TypeScript pass.
- [ ] WCAG 2 A/AA automated checks show no violations on public and authentication routes.
- [ ] 375px and 390px have no document overflow.
- [ ] 1440px uses the intended desktop composition.
- [ ] Controls are at least 44px; form fields use 16px text.
- [ ] Keyboard focus is visible; dark surfaces use a light-gold override.
- [ ] DOB remains Day/Month/Year on 375–390px.
- [ ] Class radio cards show the real configured weekday and time when present.
- [ ] Dense admin tables scroll only inside their labelled region.
- [ ] No test preview routes or synthetic fixture data ship.
