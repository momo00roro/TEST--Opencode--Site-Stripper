# Site Stripper Alpha Experience Design

## Goal

Give Site Stripper a polished, CHEEE-branded SaaS-style website for alpha users while keeping the existing analyzer usable. The experience is a static product site with a direct path into the current app; it does not create accounts, authenticate users, take payments, or collect card details.

## Shared understanding

- Site Stripper is a CHEEE product for designers, developers, and AI-assisted rebuild workflows.
- The analysis itself does not call an AI model. It gathers website observations and produces a structured reference pack.
- The site should feel like a real product and should not mention that it is being used for a presentation.
- The current alpha can be accessed without an account. No fake registration, payment, or entitlement-success state will be shown.
- The previous Clerk, Stripe, D1, and Pages Functions proposal is withdrawn. This design adds no external provider, database, Pages Function, or new hosted service.

## Product facts to use in copy

The current Worker validates a public HTTP(S) site, discovers likely same-origin pages, analyzes up to ten pages, and streams bounded observations to the browser. The browser renders documentation and builds a downloadable ZIP containing Markdown, JSON, theme files, and captures when available.

A one-page check of the live hosted API returned a desktop WebP binary in the response. Hosted capture uses a lighter profile than local capture, and captures may be partial or unavailable for a given site. The analyzer has a 150-second wall limit per run and a 10 MB aggregate screenshot-byte cap. It does not submit source-site forms, click controls, solve CAPTCHAs, or bypass bot-verification pages.

Do not describe the product as AI-powered. “AI-ready” or “for AI-assisted rebuilds” is accurate when it refers to the package’s downstream use. Do not describe screenshots as guaranteed for every page or run.

## Experience and routes

### Public homepage

`/` becomes the Site Stripper product page, with CHEEE attribution, a clear value statement, who it helps, how the analyzer works, verified output examples in text, FAQs, and clear paths into alpha access. The page may use the existing Site Stripper mascot and illustrated identity with the orange and blue accents specified for CHEEE.

The page will not invent customer logos, testimonials, usage metrics, prices, trials, quotas, or plan benefits. It will not include fake product screenshots. The pricing area will state that paid plans are not available yet and that alpha access does not require payment. Numeric paid pricing can be added after founder approval.

### Alpha access and account affordances

“Sign in,” “Create account,” and plan actions must not collect email addresses, passwords, or payment information. They route to a static alpha-access state that explains that this alpha opens the existing analyzer without an account and provides a “Continue to app” action. The flow does not claim an account was created, that a user signed in, or that payment succeeded.

There is no fake checkout form, fake account store, authentication token, entitlement check, or front-end-only success state. The existing analyzer is directly reachable at `/app`.

### Existing analyzer

The current application moves under `/app`, including its client assets. Its analysis request and output behavior remain the existing behavior. The hosted page continues to call the existing Worker API; no new backend endpoints are required for the alpha experience.

### Local development

The local root page shows a prominent “Launch app” button at the top and links to `/app`. The local Node server inserts this link when serving the localhost homepage. Production static HTML does not contain the development shortcut, and CSS hiding is not used to separate local and hosted behavior.

The local server maps `/app` and its assets to the relocated application. Its existing local Chromium backend and `/api/analyze` route remain available.

## Architecture

- Keep Cloudflare Pages as the static host and the existing Worker as the analysis API.
- Keep the client-side documentation generation and ZIP assembly in the browser.
- Move the current app HTML, styles, scripts, and vendor assets into the `/app` path.
- Serve the public product page from `web/index.html`.
- Add the localhost-only launch link in `worker/local/server.ts` during local HTML serving.
- Keep existing API request validation and analysis routes. No database or external service is introduced.
- Correct the public-facing capture notice so it matches the verified hosted behavior. Production deployment metadata must not identify the live service as `development`.

## Visual and content rules

- Preserve the existing monster mark and connect the page clearly to CHEEE.
- Use the requested orange and blue accents with legible typography and a coherent SaaS page structure.
- Do not use fake testimonials, customer logos, adoption numbers, or synthetic product screenshots.
- Avoid the terms “demo,” “MVP,” and “experiment” in public copy.
- Do not mention that the site is for a presentation.
- Do not include the source repository URL in the website, metadata, screenshots, or public documentation.
- Make no claims of real accounts, paid access, checkout, payment processing, or account-level usage controls.

## Pricing and launch decisions

No paid price, billing interval, free trial, per-user usage allowance, overage policy, or plan benefit has been approved. Therefore, the alpha page will show no numeric paid prices or fabricated plan entitlements. Before paid launch, the founder must choose the paid plan structure, approved currency and price, included usage, trial policy, and handling of usage that exceeds the included amount.

The current Workers Free Browser Run allowance is shared across the Cloudflare account, rather than assigned to a Site Stripper user. It is not a customer plan limit and must not be presented as one. This static alpha design does not promise account-level usage enforcement.

## Security and privacy

- No email, password, or card form is added.
- No user identity or account data is stored.
- No account or payment claims are generated by browser-only state.
- The existing URL validation, redirect checks, and source-site restrictions remain unchanged.
- The source repository URL remains private.

## Acceptance criteria

1. The public homepage presents Site Stripper as a CHEEE product using only verified capabilities and outputs.
2. The hosted product page explains that alpha access proceeds directly to the current analyzer without account creation or payment.
3. `/app` serves the current analyzer and its assets on the hosted site and on localhost.
4. The localhost homepage visibly includes “Launch app” at the top; the production homepage does not include that local shortcut.
5. Screenshot copy matches the live hosted behavior: captured binaries can be included, subject to capture availability and limits.
6. The current Worker analysis endpoint, validation, and ZIP assembly flow remain intact.
7. No third-party auth or payment integration, database, Pages Function, card input, fake account creation, or fake payment-success behavior is added.
8. Public copy, metadata, and documentation contain no source repository URL, fake social proof, numeric paid prices, or unapproved plan claims.
