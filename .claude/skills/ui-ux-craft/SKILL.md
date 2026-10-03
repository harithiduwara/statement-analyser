---
name: ui-ux-craft
description: >-
  Use when building, changing, or reviewing ANY UI/UX in the Statement Analyser
  — a view, component, primitive, stylesheet, design token, animation, chart,
  icon, empty/loading state, or page layout, light or dark. Holds the work to
  this project's award-standard design system (bundled Inter, elevation /
  radius / motion token scales, token-only colour, accessible dark-mode parity,
  privacy-safe self-hosted assets) and to the standing mandate that every
  implementation ship as optimised as it reasonably can. Read it before the
  first line of UI code or CSS, and extend it whenever the system grows.
---

# UI/UX craft — the house standard

This is a privacy-first, local-only financial tool. "Award-winning" here is not
decoration; it is **calm, dense, trustworthy, and fast** — the fintech-serious
end of the spectrum, not the splashy end. Elevate the existing language; never
reinvent it on a whim. Every change inherits these rules and, where it teaches
something new, **adds to this file** so the standard keeps rising.

## Non-negotiables (break one and the change is wrong)

1. **Privacy beats polish, always.** The page makes *no* third-party request —
   no CDN, font host, analytics, or tag. Any asset (font, icon set, image) is
   **vendored and self-hosted** so it bundles to a relative `/assets/…` path.
   `index.html` stays free of external `<link>`/`<script>`; `tests/privacy.test.ts`
   enforces it. A prettier UI that phones home is a regression, not an upgrade.
2. **Colour comes only from tokens** in `src/index.css` (`--ink*`, `--surface*`,
   `--line*`, `--series-*`, status `--good/--warning/--serious/--critical`,
   `--accent*`). No hex in components, no Tailwind colour utilities. A theme
   change must repaint by swapping variables alone.
3. **The data-viz palette is validated — do not touch series/surface hues.**
   `--series-1..4` and the surfaces cleared the dataviz skill's CVD, contrast and
   lightness gates in *both* themes. Re-run `scripts/validate_palette.js` (dataviz
   skill) before changing any of them. Dark is a *selected* set of steps, never
   an auto-inversion.
4. **Identity is never colour alone.** Status always ships colour **+ label +
   dot/icon** (see `Chip`, `Stat`). Charts always carry a legend (≥2 series) and
   direct labels. This is an accessibility floor, not a preference.
5. **Charts do not animate.** `STATIC_MARK` in `src/ui/charts.tsx` is deliberate:
   a dense analytic view is read, not watched, and animation makes the render
   non-deterministic. Keep it.
6. **Honour `prefers-reduced-motion`.** Entrance/hover motion lives inside
   `@media (prefers-reduced-motion: no-preference)` so a reduced-motion reader
   never sees an element start invisible; the global `reduce` block neutralises
   anything third-party. Never animate a reader into a stuck state.
7. **Numbers are set deliberately.** Column figures use `.num` (tabular). Hero
   figures use `.figure` (lining, tight tracking). Never a proportional number in
   a column, never a tabular hero.
8. **Every UI change still passes `npm run build` + `npm test`** (privacy guards
   included) and is **looked at**, not just compiled — see "Definition of done".

## The token system (`src/index.css`)

One vocabulary, consumed by primitives and arbitrary Tailwind values
(`bg-[var(--accent-wash)]`, `shadow-[var(--shadow-md)]`):

| Scale | Tokens | Use for |
|---|---|---|
| Elevation | `--shadow-sm / -md / -lg` | panel rest / hover-lift & dropdowns / tooltips & popovers. Two stacked casts, deeper in dark. |
| Radius | `--radius-sm/md/lg` (6/10/14) | chips & controls / panels / large surfaces |
| Motion | `--ease-out`, `--ease-in-out`, `--dur-1/2/3` (140/240/420ms) | all transitions & keyframes |
| Accent wash | `--accent-wash`, `--accent-wash-strong` | resting active fills (nav), `::selection` |

Entrance utilities (motion-scoped): `.fade` (opacity, whole-view on route change),
`.rise` (opacity+translateY, one element), `.stagger > *` (cascade children, capped
~7). `.lift` (+`:hover`) gives an interactive surface a 1px shadowed rise —
**transform/shadow only, never properties that reflow**.

## Typography

- One face: **Inter Variable**, self-hosted latin-only weight-axis woff2 (~48 KB,
  `src/assets/fonts/`), `@font-face` with `font-display: swap` + `unicode-range`.
  System stack is the graceful fallback. Don't add a second font/subset without a
  real need — weigh the bytes.
- Headings: `tracking-tight`. Body: Inter defaults (`cv05`/`ss03` on). Micro-labels:
  `uppercase tracking-[0.06–0.07em]`, `--ink-muted`.

## Primitives first (`src/ui/primitives.tsx`)

Change the **primitive or the token**, not twelve call sites — that is how a
restyle stays consistent and cheap. `Panel`, `PanelHeader`, `Stat` (hero figure +
hover-lift + tone dot), `Button` (press + per-variant hover), `Chip` (pill + dot),
`EmptyState`, `SectionLabel`. Keep their prop APIs **additive** so no caller breaks.
Dense tables use `.grid-table` (sticky hairline head, hover row, no zebra).

## Charts

Load the **dataviz skill** before any chart work. Then follow the house rules
already codified at the top of `src/ui/charts.tsx` (titled axes, stated unit, one
y-axis ever, legend+direct labels, 2px surface gaps, token colours, `STATIC_MARK`).
Reuse `ChartFrame`, `makeTooltip`, `SERIES`, `compactLkr` — don't re-derive them.

## The optimisation mandate (standing, every change)

"Optimise every implementation as much as possible" — concretely:

- **Propagate, don't repeat.** A visual change belongs in a token or a primitive.
  Touching many views to restyle is a smell.
- **Earn every byte and every dependency.** Prefer vendoring one subset file over
  a package; prefer CSS/`color-mix`/variable fonts over JS and extra assets. After
  touching deps or styles, check the `vite build` asset table — know what you added.
- **CSS over JS for motion and state** the browser can do itself (`:hover`,
  `:focus-visible`, `prefers-*`, keyed remount for entrances). Ship no runtime where
  a declaration suffices.
- **No dead code or unused tokens/utilities.** If you add a utility, use it.
- **Keep the main thread free.** All parsing/OCR stays off the UI path; never block
  paint on data work.
- **Measure, then state it.** Report the real asset-size delta, not a vibe.

## Definition of done for a UI change

1. `npm run build` green (it runs `tsc -b`) and `npm test` green — privacy guards included.
2. **Rendered and looked at.** Serve `dist` (`npm run preview`) and screenshot with
   the bundled Chromium (`/opt/pw-browsers/chromium-1194/chrome-linux/chrome
   --headless=new --no-sandbox --force-device-scale-factor=2 --window-size=1440,900
   --screenshot=out.png http://localhost:4173/`). Check both themes where feasible,
   and a phone width. The validator checks colour, not layout — eyeball collisions,
   overflow, focus rings, contrast.
3. Asset-size delta known and reported.
4. This file updated if the change added or changed a rule, token, or pattern.
