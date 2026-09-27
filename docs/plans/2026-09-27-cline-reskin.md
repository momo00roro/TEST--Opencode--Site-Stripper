# UI reskin to cline.bot design language — 2026-09-27 (GMT+8)

The Pages UI was repeatedly judged "AI-generated" (gradient headline, aurora,
glass, card farm, scattered infinite motion). After a de-slop pass, the user
asked to replicate a site stolen with this very tool: `https://cline.bot`,
captured into gitignored `.examples/2026-09-27__cline.bot/`
(design-tokens.md, typography.md, theme.css, home.webp screenshot).

## Stolen DNA

- Light canvas `#F8FAFB`, ink `#151516`, purple `#9F58FA`
  (+ pink `#F53969`, green `#2BCC28`, blue `#5487C8` unused).
- DM Sans display (400–500, tight tracking), Inter 18px body,
  Space Grotesk demoted to mono/code.
- Small-caps eyebrow labels, hairline `rgba(21,21,22,0.08)` borders,
  radii 4–12px + pills, black CTA buttons, lavender secondary buttons
  (`#F5EFFE` fill, `#D9C8F5` border, black text).
- Segmented tab strip: gray inactive tabs with dividers, active tab bold
  black with 2px purple bottom-underline; content panel below a hairline.

## What changed (web/ only, all IDs and JS logic preserved)

1. `327cb51` — full light-theme reskin; shell 1120px, form 720px.
2. `70ce6bc` — segmented tabs; `#screenshot-container` set to
   `display: contents` so the 3-col grid spans the shell (it was nested
   inside the old auto-fill rule, rendering narrow); new layered-pages logo.
3. `eefc4dc` — Cline-exact tabs + lavender viewer buttons; light/dark
   toggle (persisted, `prefers-color-scheme` default).
4. `4c90064` — lavender promoted to primary Analyze/Download CTAs;
   purple monster-face identity (bold shapes for 16px favicon legibility).
5. `4159d4e` — logo inlined as SVG: `currentColor` inside `<img>`-loaded
   SVG always resolves black; inline inherits `--ink` per theme.
6. `ebef205` — active tab carries lavender fill at load (previously only
   the hover state was lavender, so load state looked wrong).

Supporting UX (same period): selection Selected/Not-selected sub-tabs,
screenshot Desktop/Mobile tabs, width-clamped raw-JSON accordion,
runtime environment pill (localhost vs Cloudflare) from `API_BASE`.

## Verification

- `npm run typecheck -w worker` clean; `npm test -w worker` 230/230.
- Impeccable `detect` clean except standing reference-fidelity exceptions
  (eyebrows, DM Sans ubiquity, width-transition on progress meters).
- Localhost end-to-end 2026-09-27 via headless Chromium + playwright-core
  (DevTools bridge was down): `https://example.com` → 1 page, 2 captures,
  Selected tab lavender at load; viewport shot saved to repo-root
  `screenshot-localhost-2026-09-27.png` (untracked).
