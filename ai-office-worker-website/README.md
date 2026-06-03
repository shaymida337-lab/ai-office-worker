# AI Office Worker — Production Package

Bilingual (English + Hebrew/RTL) marketing site, production-ready. Static files only — no build step, no server. Deploy the folder as-is.

> New here? Open **`DEPLOYMENT.md`** for the full non-technical, step-by-step deploy guide (local preview → Vercel/Render → Namecheap domain → SEO → Analytics → checklists).

---

## What's in this package

### Pages (14 total)
- **English** (site root): `index.html`, `features.html`, `about.html`, `contact.html`, `security.html`, `privacy.html`, `terms.html`
- **Hebrew / RTL** (in `he/`): same seven pages, fully translated, `dir="rtl"`, with an Assistant-based Hebrew type system.
- **Custom 404**: `404.html` (English) and `he/404.html` (Hebrew), both branded.

### Production layers (applied to every page)
1. **Custom 404 pages** — branded, with helpful links, `noindex`.
2. **Open Graph tags** — title, description, locale, URL, and a 1200×630 share image on all 14 pages.
3. **Twitter/X cards** — `summary_large_image` on all pages.
4. **Google Analytics 4 (consent-gated)** — analytics is centralized in `assets/script.js` via a `GA_MEASUREMENT_ID` constant and loads **only after the visitor accepts** the cookie banner. Set the ID in both `script.js` files to enable; leave blank to stay analytics-free.
5. **SEO** — unique titles/descriptions, `canonical` + `hreflang` (en / he / x-default) linking the two language versions, `robots.txt`, and language-specific `sitemap.xml` files (root sitemap lists both languages).
6. **Structured data (JSON-LD)** — `Organization`, `WebSite`, and `SoftwareApplication` on both home pages; the Hebrew home also includes an `FAQPage` schema.
7. **Performance** — fonts loaded with `preconnect` + non-blocking `preload`/`onload` swap (with `<noscript>` fallback), long-lived cache headers for `/assets` and images via `vercel.json`, and an animation system that respects `prefers-reduced-motion`.
8. **Accessibility** — "skip to content" links, `aria-current` on the active nav item, `aria-expanded`/`aria-controls` on the menu and FAQ toggles, `aria-live` form status regions, visible focus styles, visually-hidden labels (`.sr-only`), and proper `lang`/`dir` attributes.
9. **Cookie consent** — a bilingual, design-matched consent banner that gates analytics (Accept/Decline, remembered 12 months, re-openable via a footer "Cookie settings" link). Auto-shows Hebrew on `/he/`. No setup required.
10. **Spam protection** — every form has an invisible honeypot field plus pre-wired **Google reCAPTCHA v3** (loads only on form pages, badge hidden with the required disclosure shown, verified by Formspree server-side). Add a Site/Secret key pair to switch it on.
11. **Hebrew RTL build** — see `he/` (details below).
12. **Deployment-ready structure** — `vercel.json`, `_redirects`, favicons at root, and this README.

### Hebrew RTL build (`he/`)
- Right-to-left layout driven by `dir="rtl"` plus a dedicated RTL override layer appended to `he/assets/styles.css` (mirrors positions, margins, transforms, alignment).
- All UI strings translated, including the two JS strings (form button + error messages) in `he/assets/script.js`.
- Self-contained: its own favicons, `site.webmanifest`, `sitemap.xml`, and OG images (`og-image.png` cross-compatible + `og-image.svg` with crisp Hebrew).
- Cross-links: English footers link to `עברית`; Hebrew footers link back to `English`.

### Brand kit (`brand/`) — not served to visitors
Logo concept page and all logo variants (SVG), plus the favicon master set and generator. See `brand/logo-concept.html`.

### Build helpers (`_build/`) — not part of the deployed site
The Python scripts used to generate the Hebrew pages, inject head tags, and render the OG image. Kept for transparency/regeneration. Safe to delete; you can also delete `_build/` and `brand/` before deploying if you want the leanest upload.

---

## Folder structure

```
ai-office-worker/
├── index.html  features.html  about.html  contact.html
├── security.html  privacy.html  terms.html
├── 404.html
├── assets/            styles.css · script.js   (English)
├── he/                          ← Hebrew RTL site
│   ├── index.html … terms.html · 404.html
│   ├── assets/        styles.css (+ RTL layer) · script.js
│   ├── og-image.png · og-image.svg · site.webmanifest · sitemap.xml
│   └── favicons (favicon.*, apple-touch-icon, android-chrome-*)
├── robots.txt · sitemap.xml
├── og-image.png                 ← 1200×630 social share image
├── vercel.json · _redirects     ← hosting config (clean URLs, 404, caching)
├── favicon.* · apple-touch-icon.png · android-chrome-*.png · site.webmanifest
├── DEPLOYMENT.md  README.md
├── brand/             logo kit + favicon masters   (not served)
└── _build/            generator scripts            (not served)
```

---

## Go-live in 3 quick edits
1. **Forms (Formspree):** create two free Formspree forms and paste their IDs into `FORMSPREE_WAITLIST_ID` / `FORMSPREE_CONTACT_ID` near the top of the form section in **both** `assets/script.js` and `he/assets/script.js`. Recipients: **Waitlist → info@ai-office-worker.com**, **Contact → hello@ai-office-worker.com**. Until then, forms validate and show success without sending.
2. **Analytics (optional, consent-gated):** set `GA_MEASUREMENT_ID` to your `G-…` ID in both `script.js` files. Google Analytics then loads only after a visitor accepts the cookie banner. Leave blank to stay analytics-free.
3. **Email:** the site uses **hello@** (contact), **info@** (general/legal), and **support@** (future customer support) — all `@ai-office-worker.com`. Make sure those mailboxes exist.

**Full step-by-step launch (forms + GitHub + Vercel + Namecheap domain) is in `GO-LIVE.md`.** Deeper reference (Render, SEO submission) is in `DEPLOYMENT.md`.

---

## Notes
- **OG images:** the English site uses `og-image.png` and the Hebrew site uses `he/og-image.png` — both are real 1200×630 PNGs (maximum crawler compatibility), each with the correct language wordmark. A vector `he/og-image.svg` is also included as a source/bonus.
- **Legal pages** (Privacy, Terms) are solid, Google-API-aware templates — have them reviewed for your jurisdiction before launch.
- **No localStorage / no cookies** are set by the site itself. If you enable analytics, consider a consent banner (see `DEPLOYMENT.md`).
