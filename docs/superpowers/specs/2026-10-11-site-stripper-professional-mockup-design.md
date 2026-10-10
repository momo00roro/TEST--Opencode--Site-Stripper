# Site Stripper Professional Marketing Mockup

## Goal

Present Site Stripper as a polished SaaS product through a multi-page marketing site, realistic sign-up/sign-in screens, completion views, and a detailed example of the downloadable analysis pack. The site is a presentation mockup: account forms validate in the browser but do not send or save information.

## Shared understanding and constraints

- The user explicitly requests mock account flows with no account storage and no saved information.
- Form values must not be sent to the analysis API or any other endpoint, placed in the URL, or written to local storage, session storage, cookies, or another persistent store.
- The account forms are visual mockups. A valid browser-side submit changes to a generic completion screen; no personal values are echoed and no email-delivery claim is made.
- Do not add a database, Pages Function, authentication provider, payment service, CAPTCHA provider, or new hosted service.
- The public marketing site must not link to, embed, or deploy the analyzer UI. Keep `/app/` available only through the local development server.
- The attached images are visual references only. Do not copy PandaSQUEEZE branding, names, email addresses, CAPTCHA marks, or embedded copy from them.
- Do not mention presentation/mockup intent in public site copy. Remove the “A CHEEE web tool” label, account/payment reassurance copy, the Alpha Access section, and the “Paid plans are being finalized” note.
- Retain the approved palette: purple primary, lavender and gray neutrals, with restrained yellow accents. Keep the footer exactly: `© 2026 Site Stripper. Made with ❤️ by CHEEE.WORK`.
- Keep the source repository URL private in all public files and metadata.
- No price, plan entitlement, testimonial, customer logo, adoption metric, or unsupported product claim may be invented.

## Verified product facts

Site Stripper analyzes public HTTP(S) websites and produces structured material for a rebuild workflow. It does not call an AI model, submit source-site forms, replay arbitrary site JavaScript, solve CAPTCHAs, or bypass bot checks.

Hosted analysis selects up to ten pages and has a 150-second wall limit. The hosted capture profile is lighter than local capture; screenshots can be partial or unavailable. The package generator validates the output and assembles the ZIP in the browser.

The package generator emits Markdown documentation, JSON records, theme CSS, Tailwind configuration, and captures when available. Its verified file families include:

- Root documentation: `README.md`, `REBUILD.md`, `website-overview.md`, `information-architecture.md`, `design-tokens.md`, `typography.md`, `content-style.md`, `imagery-and-video.md`, `motion-and-interactions.md`, `responsive-behavior.md`, `implementation-plan.md`, `components.md`, and `design-system.md`.
- Machine-readable records under `data/`: pages, tokens, components, navigation, selection, interactions, motion, assets, report, layout, and responsive pairs.
- `pages/*.md`, `screenshots/manifest.json`, captured screenshot files when available, `theme.css`, `theme.v2.css`, `tailwind.config.js`, `tailwind.theme.mjs`, `fonts.css`, and downloaded assets when present.

The sample-pack page must present this as a representative, expandable file tree. Screenshot entries must be labeled as conditional; no fabricated capture may be shown as an actual output.

## Public page map

- `/` — marketing homepage: product promise, intended users, verified workflow, feature summary, package preview, FAQ highlights, sign-up CTA, and Site Stripper branding.
- `/features/` — verified analysis and output capabilities with honest limits.
- `/how-it-works/` — URL intake, page discovery, capture/observation, and browser-side ZIP generation.
- `/sample-pack/` — styled file browser showing the actual generated package structure and conditional screenshot files.
- `/faq/` — product behavior and limitations grounded in the code.
- `/sign-up/` — account creation mockup inspired by the first visual reference, using Site Stripper branding and the approved palette.
- `/sign-in/` — matching sign-in mockup.
- `/sign-up/complete/` and `/sign-in/complete/` — generic completion views inspired by the second visual reference, without user data or email-delivery claims.

The site has no pricing page until prices and plan terms are approved. It has no Alpha Access section, analyzer CTA, or public analyzer route.

## Mock account behavior

Sign-up uses labeled full-name, email, optional company, password, and confirm-password fields. Sign-in uses email and password. Native/browser validation and password matching are allowed. On a valid submit, client code prevents network submission, clears form values, and navigates to the matching generic completion route. No form values are persisted, transmitted, included in navigation state, or displayed on the completion screen. Do not add a CAPTCHA, OAuth button, password-reset flow, or remember-me setting.

These mock flows do not authenticate users or create durable accounts. They do not route to the analyzer.

## Architecture and deployment

- Keep the marketing and mock account pages static on the existing Cloudflare Pages project.
- Keep the existing Worker API and analyzer behavior unchanged.
- Add a deterministic public-site build output (for example `dist/site`) containing only the marketing pages and their required assets. Exclude `app/`, analyzer scripts, ZIP libraries, and other app-only assets from the Pages upload.
- Update the CI and manual Pages deployment commands to upload the built public-site directory rather than all of `web/`.
- Keep the source analyzer and local `/app/` route available to developers through the existing local Node server. Remove the local homepage Launch app link from the marketing mockup so a presentation does not expose the analyzer UI.
- Use relative static links with explicit index files where needed so navigation also works in the in-app `file://` preview.
- Do not publish or deploy as part of implementation; deployment remains a separate user action.

## Visual direction

Use a calm, confident SaaS design with deep purple for primary actions and headings, pale lavender and gray for surfaces, charcoal for text, and small yellow highlights. Keep the existing Site Stripper mark. Build the package preview as accessible HTML/CSS so its contents remain real and readable; use existing or captured product imagery only when it is a genuine product output. Generate new raster artwork only if a specific visual need remains after composing the interface.

## Acceptance criteria

1. The public site contains the marketing, features, workflow, sample-pack, FAQ, sign-up, sign-in, and completion pages listed above.
2. No public page uses the removed Alpha Access/account-payment copy or links to the analyzer.
3. The production Pages output excludes the analyzer entry page and app-only assets; local `/app/` remains available.
4. Sign-up and sign-in validate client-side and reach their completion views without network requests or persistence. No entered data appears in URLs, storage, cookies, or completion pages.
5. The sample-pack file tree matches the actual package generator and marks screenshot files as conditional.
6. Product claims reflect the verified ten-page cap, 150-second hosted wall limit, conditional screenshots, and client-side ZIP assembly.
7. The palette follows the approved purple/lavender/gray/yellow direction, and both marketing and mock account pages use the exact requested footer line.
8. The source repository URL remains absent from public content, metadata, and generated screenshots.
