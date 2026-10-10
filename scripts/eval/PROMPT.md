# Pack → clone prompt contract (1–3 prompts)

The product promise: a fresh agent, given ONLY an extraction pack and these
prompts, produces a homepage clone that scores ≥92 on `score.mjs` — with no
human hand-tuning and no peeking at any reference rebuild.

`<PACK>` = absolute path to the pack dir. `<OUT>` = absolute path to an empty
output dir. The agent must not read any directory other than `<PACK>`/`<OUT>`.

## Prompt 1 — build

> Rebuild the homepage from the extraction pack at `<PACK>` into `<OUT>`.
>
> The pack is the ONLY source: captured screenshots, `data/*.json`, `theme.css`,
> `REBUILD.md`, and `assets/`. Do NOT fetch the live site. Do NOT read any other
> directory. Do NOT ask questions.
>
> Deliverable: `<OUT>/index.html`, `<OUT>/style.css`, and any needed files under
> `<OUT>/assets/` copied from the pack.
>
> Hard rules:
> - Zero `<script>`, zero external URLs/hotlinks. All references local.
> - The pack's `screenshots/` are REFERENCE ONLY. Never embed a screenshot or use
>   one as page imagery. Rebuild with HTML/CSS. (Do use the pack's downloaded
>   `assets/` logos/images directly.)
> - Screenshot sanity: if a section shot clearly shows different content than its
>   REBUILD heading/copy (wrong clip), trust the verbatim copy + `layout.json`
>   geometry and build that section from them — note the mismatch, never reproduce
>   the wrong content. A pack warning about layout shift means the same.
> - Fonts: self-host the faces under `assets/fonts/` via `@font-face`. If a face
>   is absent, use the closest provided face - never a system-only stack. Obey
>   the pack's Display-face directive for headlines/hero/buttons/nav/tabs.
> - Match the 1440px desktop layout. Ground truth = `screenshots/desktop/home.webp`.
> - Follow `REBUILD.md` section-by-section for order, geometry, verbatim copy,
>   and tokens. Use `data/layout.json` for y/height/columns AND gap/justify, and
>   `data/tokens.json` for colors. Apply every REBUILD directive verbatim:
>   display-face, image treatment (filter/tiles), CTA fills, inline-icon redraw,
>   component x/y placement, canvas verbatim + position, fixed overlays,
>   header chrome (brand mark, dropdowns, action fills/borders), scroll strips,
>   prose-link idiom, placeholder-rotation note.
> - Pack recency: check the pack README's Captured date. Older than ~14 days —
>   re-capture before rebuilding; live marketing sites drift (nav, CTAs, panels)
>   within days, and a stale pack will mismatch the live site no matter how
>   exact the rebuild.
> - Heading line-breaks: reproduce the wraps marked (⏎) in
>   `information-architecture.md` and `data/pages.json` `headings[].breaks`.
>   Otherwise let headings wrap naturally - never force extra breaks.
> - Interactions (zero-JS): tabs, menus, and buttons are real `<a href="#">`
>   with hover/focus/active styles (visibly clickable, keyboard-focusable).
>   If REBUILD carries per-tab panel copy ("Tab panels"), rebuild tabsets as
>   radio-input + `<label>` CSS-only switches (`:checked` shows the matching
>   panel) using that copy verbatim, defaulting to the screenshotted tab.
>   If no per-tab copy exists, keep the default panel static — do NOT switch
>   panels or invent inactive-panel copy. Never add JS, never fake playback
>   on video (poster + placement only).
> - Overlays dismiss: cookie/consent bars MUST dismiss via hidden checkbox +
>   `<label for>` (Accept/Decline hide the bar; Manage toggles a prefs note).
>   No JS, no persistence claims.
> - Hover micro-interactions: every link/button/tab/card gets a CSS `:hover`
>   (and `:focus-visible`) state using the pack's motion easings/durations
>   (subtle: color, lift, underline — never layout-shifting). If REBUILD
>   carries an "Observed hover effects" section, those measured values WIN:
>   replay each listed after-state verbatim on the matching element (plus
>   `:focus-visible`), including descendant rules (e.g. links inside a
>   hovered card). No hover-only content.
> - Mobile (≤1000px, verify at 390px vs `screenshots/mobile/home.webp`): stack
>   columns AND — fluid media (`max-width:100%;height:auto`, never fixed px wider
>   than the viewport: canvas, posters, frames); headings wrap naturally with NO
>   desktop constraints leaking through (no forced `<br>`, no `max-width` wider
>   than 350px, no fixed heights — an H1 constrained for desktop WILL clip on
>   mobile); collapse hero top padding and canvas offset (desktop 99px+134px of
>   air becomes ~24px on mobile); tab rows reflow to 2 columns (never 4-across
>   squeeze); grids collapse (providers 6→3, logos 5→2, features 2→1); nav links
>   collapse (logo + actions remain). Render at 390px and compare; no horizontal
>   overflow, no clipped text, height within ~15% of the pack mobile shot.
> - Video tabs (e.g. Understand/Refactor/Automate — labels, not panels): rebuild
>   as real `<a href="#side-item-id">` anchors pointing at each corresponding side
>   content block (give side blocks ids), with hover/active styles plus a `:target`
>   highlight: `.side h3:target { background-color: rgba(159,88,250,0.12);
>   border-radius: 8px; }` (background-color ONLY — never padding/margin shifts
>   that move layout). All tab content stays visible; tabs navigate + spotlight
>   it (zero-JS, verified by clicking). Never fake-switch video or hide content.

## Prompt 2 — self-check (same session)

> Render your `<OUT>/index.html` at 1440px width, full-page. Verify in this order:
> 1. Heights: total page height within 1% of the pack screenshot height, and each
>    section's end-y within ~30px of `data/layout.json` (measure, don't eyeball;
>    adjust padding/gaps, never content).
> 2. Type: H1 family/size/line-breaks vs the section screenshot and the pack's
>    Display-face directive; hero canvas position vs its REBUILD x/y.
> 3. Treatments: image filters/tiles, CTA fills (background AND border —
>    borderless stays borderless), and inline icons vs REBUILD.
> 4. Chrome + strips: logo mark redrawn (not text), dropdown chevrons present,
>    display weight (800 vs 700 matters), scroll strips as single-row
>    `overflow-x:auto` (never wrapped grids), prose-link underlines kept.
> Fix the three largest remaining visual mismatches (layout, type, color/spacing).
> Keep everything local and zero-JS. Report the changes with before/after scores.

## Prompt 3 — expand (same session or later; new content in the same UI system)

> Using ONLY the pack (`design-system.md` + `theme.css` + `assets/`, plus the
> REBUILD §2 shell chrome), add the following to the clone in `<OUT>`:
> `<NEW>` (a new section appended to `index.html`, and/or a new page reusing
> the shell chrome verbatim).
>
> The pack is the ONLY source. Do NOT fetch the live site. Do NOT read any
> other directory. Do NOT ask questions. New copy follows the pack's voice
> (`content-style.md` register) — concise, never lorem, never a paraphrase of
> existing sections.
>
> Hard rules:
> - Follow `design-system.md` §8–§9 recipes and Constraints verbatim: font
>   families ⊆ shipped `assets/fonts/`; colors ⊆ §1 roles/aliases; radii and
>   shadows ⊆ §3 scales; compose only §4 component recipes + shipped assets
>   (grayscale + tile wash per §7).
> - New pages reuse the REBUILD §2 nav/footer chrome verbatim (same links,
>   same order); one H1 per page, section H2s in the Display face at an
>   existing scale step; same body canvas.
> - Zero `<script>`, zero external URLs/hotlinks, all references local.
> - Zero-JS interactions only (radio-tab switches, checkbox dismiss,
>   `:target` background-color highlight, hover/focus micro-states).
> - Mobile per §6 house rule (stack, fluid media, natural heading wraps,
>   collapsed grids/nav, no horizontal overflow). Render every new/changed
>   page at 1440px AND 390px and compare against the nearest pack pattern
>   before calling it done.
>
> ### Expansion scoring
>
> `node scripts/eval/expand-check.mjs --pack <PACK> --rebuild <OUT> [--base <CLEAN-CLONE-DIR>] --label <name>`
>
> - Adherence: every font family ⊆ shipped faces; every color within tolerance
>   of an observed palette color (aliases + token colors + role/CTA/tile
>   colors); every radius an observed scale step or pill/circle shape token;
>   anti-cheat (no `<script>`, no external URLs).
> - Rendering: every HTML page loads error-free at 1440px and shows no
>   horizontal overflow at 390px.
> - With `--base`, only NEW violations vs the clean clone count (the base's
>   own approximations are grandfathered, never hidden).
> - Advisory (never failing): `typeScale.advisoryUnobserved` lists font sizes
>   outside the observed scale — prefer an existing scale step for new type.
>
> Pass = clean cheat + zero new font/color/radius violations + renders ok.

## Scoring (clone runs)

`node scripts/eval/score.mjs --pack <PACK> --rebuild <OUT> --label <name>`

- Pixels primary: per-section + full-page SSIM/pixel-match vs the pack's own
  screenshots, plus a height-ratio layout term. Each pixel comparison is the mean
  of an exact-pixel pass and a multi-scale (16/32/64px grid) perceptual pass, so
  sub-glyph anti-aliasing and 1-3px text offsets do not dominate the score.
- Rubric secondary: tokens (palette/canvas), copy recall (visible blocks), motion
  (poster/placeholder present, plus a zero-JS interactions checklist: functional
  tab controls, dismissable overlay via checkbox+label, hover micro-interactions
  — capped so static motion tops at 94).
- Anti-cheat fails the run if the rebuild embeds a pack screenshot, references an
  external URL, or ships a `<script>`.

Pass = composite ≥92 (pixels primary). Gaps must appear in the pack's
`REPORT`/limitations, never be hidden by hand-editing the clone.
